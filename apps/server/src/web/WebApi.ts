import { HardCriteria, Money, type ListingView, type MatchDecision } from "@slabwatch/domain"
import { cards, sets, toUsdCents } from "@slabwatch/seed"
import { address, isAddress } from "@solana/kit"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql/SqlClient"
import { Agent } from "../agent/Agent.ts"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { AppConfig } from "../config.ts"
import { Embedder } from "../embeddings/Embedder.ts"
import { evaluateWithFallback } from "../jobs/watcher.ts"
import { spentTodayMicros } from "../llm/Llm.ts"
import { Matcher, pipelineV2 } from "../matcher/Matcher.ts"
import { redFlagsFor } from "../matcher/redFlags.ts"
import { Payments } from "../purchases/Payments.ts"
import { Purchases } from "../purchases/Purchases.ts"
import { RuleParser } from "../rules/RuleParser.ts"
import { RuleRepo } from "../rules/RuleRepo.ts"
import { Treasury } from "../solana/Treasury.ts"
import { WalletAuth } from "../wallet/WalletAuth.ts"
import { RateLimits } from "./RateLimits.ts"

/** A refusal with the HTTP status it answers with. */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.Number
}) {}

const MAX_ACTIVE_RULES = 5
const MAX_ALLOWANCE_USD = 100_000

/** JSON with bigints as strings: token amounts are u64 on chain. */
const toJson = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)))

const errorBody = (e: { readonly _tag?: string; readonly message?: string } & Record<string, unknown>) => {
  switch (e._tag) {
    case "ApiError":
    case "WalletError":
      return { status: e["status"] as number, message: String(e.message) }
    case "RateLimited":
      return { status: 429, message: String(e.message), retryAfter: e["retryAfterSeconds"] as number }
    case "ChainError":
      return { status: 502, message: `devnet: ${String(e.message)}` }
    case "SpendCapReached":
      return {
        status: 429,
        message: `the demo's daily model budget ($${String(e["capUsd"])}) is used up; it resets at midnight UTC`
      }
    case "LlmNotConfigured":
      return { status: 503, message: "no model API key is configured on this server" }
    case "LlmError":
      return { status: 502, message: `the model call failed: ${String(e.message)}` }
    case "SchemaError":
    case "HttpServerError":
      return { status: 400, message: `invalid request: ${String(e.message).split("\n")[0]}` }
    default:
      return null
  }
}

/** Runs a handler and turns its value or its error into a JSON response. */
const respond = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.map((body) => HttpServerResponse.jsonUnsafe(toJson(body))),
    Effect.catch((e) =>
      Effect.gen(function* () {
        const known = errorBody(e as never)
        if (known === null) {
          yield* Effect.logError("web api request failed", e)
          return HttpServerResponse.jsonUnsafe({ error: "something went wrong on the server" }, { status: 500 })
        }
        return HttpServerResponse.jsonUnsafe(
          { error: known.message },
          {
            status: known.status,
            headers: "retryAfter" in known && known.retryAfter !== undefined ? { "retry-after": String(known.retryAfter) } : {}
          }
        )
      })
    ),
    Effect.catchDefect((d) =>
      Effect.logError("web api defect", d).pipe(
        Effect.as(HttpServerResponse.jsonUnsafe({ error: "something went wrong on the server" }, { status: 500 }))
      )
    )
  )

const body = <S extends Schema.Top>(schema: S) =>
  HttpServerRequest.schemaBodyJson(schema as never) as Effect.Effect<S["Type"], Schema.SchemaError | never, HttpServerRequest.HttpServerRequest>

const param = (name: string) =>
  Effect.flatMap(HttpRouter.params, (p) => {
    const v = p[name]
    return v === undefined || v.length > 64 ? Effect.fail(new ApiError({ message: `missing ${name}`, status: 400 })) : Effect.succeed(v)
  })

/**
 * The caller's IP. Railway's proxy sets X-Real-IP; the last X-Forwarded-For
 * entry is the one its edge added, so a client cannot pick its own.
 */
const clientIp = Effect.gen(function* () {
  const r = yield* HttpServerRequest.HttpServerRequest
  const real = r.headers["x-real-ip"]
  if (real !== undefined && real.length > 0) return real
  const forwarded = r.headers["x-forwarded-for"]?.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  const last = forwarded?.[forwarded.length - 1]
  return last ?? Option.getOrElse(r.remoteAddress, () => "unknown")
})

const cardName = (id: string | null) => (id === null ? null : (cards.find((c) => c.id === id)?.name ?? id))
const setName = (id: string | null) => (id === null ? null : (sets.find((s) => s.id === id)?.name ?? id))

const NewRule = Schema.Struct({
  rawWant: Schema.String,
  hard: HardCriteria,
  softDescription: Schema.NullOr(Schema.String),
  budget: Money
})

const Signed = Schema.Struct({ nonce: Schema.String, signature: Schema.String })

/** The last thing the agent said in a run, from the stored transcript. */
const lastAgentText = (transcript: unknown): string => {
  if (!Array.isArray(transcript)) return ""
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i] as { role?: string; content?: unknown }
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue
    const text = m.content
      .filter((b: { type?: string }) => b.type === "text")
      .map((b: { text?: string }) => b.text ?? "")
      .join("\n")
      .trim()
    if (text.length > 0) return text
  }
  return ""
}

/**
 * The JSON API the wallet page calls. A session comes from a wallet
 * signature; everything a collector does after that is checked against the
 * session's wallet. Endpoints that cost a model call or a devnet transaction
 * are rate limited per IP and per wallet, and the read-only demo mode turns
 * off every one that moves tokens.
 */
export const WebApiRoutes = HttpRouter.addAll(
  Effect.gen(function* () {
    const config = yield* AppConfig
    const sql = yield* SqlClient
    const auth = yield* WalletAuth
    const limits = yield* RateLimits
    const treasury = yield* Treasury
    const payments = yield* Payments
    const catalog = yield* CatalogRepo
    const rules = yield* RuleRepo
    const parser = yield* RuleParser
    const matcher = yield* Matcher
    const embedder = yield* Embedder
    const purchases = yield* Purchases
    const agent = yield* Agent

    const general = Effect.flatMap(clientIp, (ip) => limits.hit(`all:ip:${ip}`, 600, 600))

    const limited = (kind: "costly" | "chain", wallet: string | null) =>
      Effect.gen(function* () {
        const perHour = kind === "costly" ? config.costlyRequestsPerHour : 20
        const ip = yield* clientIp
        yield* limits.hit(`${kind}:ip:${ip}`, perHour, 3600)
        if (wallet !== null) yield* limits.hit(`${kind}:wallet:${wallet}`, perHour, 3600)
      })

    const writable = config.readOnly
      ? Effect.fail(
          new ApiError({ message: "this demo is read-only: purchases, the faucet and allowances are turned off", status: 403 })
        )
      : Effect.void

    const devnetOnly =
      payments.kind === "devnet"
        ? Effect.void
        : Effect.fail(new ApiError({ message: "this server pays through a simulated ledger, not devnet", status: 409 }))

    const session = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const header = request.headers["authorization"] ?? ""
      const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : ""
      const wallet = token === "" ? null : yield* auth.walletFor(token)
      if (wallet === null) return yield* new ApiError({ message: "sign in with your wallet first", status: 401 })
      return wallet
    })

    const ownedRule = (wallet: string, ruleId: string) =>
      Effect.gen(function* () {
        const stored = yield* rules.get(ruleId)
        if (stored === null || stored.rule.ownerWallet !== wallet) {
          return yield* new ApiError({ message: "no such rule for this wallet", status: 404 })
        }
        return stored
      })

    const route = <A, E, R>(method: "GET" | "POST", path: `/${string}`, handler: Effect.Effect<A, E, R>) =>
      HttpRouter.route(method, path, respond(Effect.andThen(general, handler)))

    const ruleSummary = (stored: { readonly rule: import("@slabwatch/domain").WatchRule }) => ({
      ...stored.rule,
      setName: setName(stored.rule.hard.setId),
      cardName: cardName(stored.rule.hard.cardId)
    })

    const latestDecisions = (ruleId: string) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          readonly listingId: string
          readonly verdict: MatchDecision["verdict"]
          readonly decidedAt: string
          readonly reasons: ReadonlyArray<string>
          readonly redFlags: ReadonlyArray<string>
          readonly judge: unknown
          readonly similarity: number | null
          readonly createdAt: Date
        }>`
          SELECT DISTINCT ON (listing_id) listing_id, verdict, decided_at, reasons, red_flags, judge, similarity, created_at
          FROM match_decisions WHERE rule_id = ${ruleId}
          ORDER BY listing_id, created_at DESC`
        const order = { match: 0, needs_review: 1, reject: 2 } as const
        const sorted = [...rows].sort((a, b) => order[a.verdict] - order[b.verdict] || +b.createdAt - +a.createdAt).slice(0, 60)
        const out: Array<(typeof sorted)[number] & { readonly listing: ListingView | null }> = []
        for (const r of sorted) out.push({ ...r, listing: yield* catalog.getListing(r.listingId) })
        return out
      })

    const status = route(
      "GET",
      "/status",
      Effect.gen(function* () {
        const spent = yield* spentTodayMicros(sql)
        return {
          network: "Solana devnet (test tokens with no real value)",
          payments: payments.kind,
          readOnly: config.readOnly,
          agentEnabled: config.agentEnabled,
          modelConfigured: config.anthropicApiKey !== null,
          llm: { model: config.llmModel, dailyCapUsd: config.llmDailyCapUsd, spentTodayUsd: spent / 1_000_000 },
          purchaseDailyCapUsd: config.purchaseDailyCapUsd,
          faucetUsd: config.faucetUsd,
          devnet: payments.kind === "devnet" ? treasury.addresses : null
        }
      })
    )

    const listings = route(
      "GET",
      "/listings",
      Effect.gen(function* () {
        const ls = yield* catalog.listActive(40)
        const facts = new Map((yield* catalog.marketFacts(ls.map((l) => l.listingId))).map((f) => [f.listingId, f]))
        // payUnits is what the listing costs in dUSD units (cents): what checkout funds, approves and pays.
        // redFlags are the same code checks the purchase policy runs; a flagged listing cannot be bought directly.
        return {
          listings: ls.map((l) => ({
            ...l,
            payUnits: toUsdCents(l.price.amountMinor, l.price.currency),
            redFlags: redFlagsFor(l, facts.get(l.listingId))
          }))
        }
      })
    )

    const catalogRoute = route(
      "GET",
      "/catalog",
      Effect.succeed({
        sets,
        cards: cards.map((c) => ({ id: c.id, setId: c.setId, number: c.number, name: c.name, rarity: c.rarity, kinds: c.kinds }))
      })
    )

    const authStart = route(
      "POST",
      "/auth/start",
      Effect.gen(function* () {
        const ip = yield* clientIp
        yield* limits.hit(`auth:ip:${ip}`, 30, 600)
        const { wallet } = yield* body(Schema.Struct({ wallet: Schema.String }))
        return yield* auth.startSignIn(wallet)
      })
    )

    const authFinish = route(
      "POST",
      "/auth/finish",
      Effect.gen(function* () {
        const { nonce, signature } = yield* body(Signed)
        return yield* auth.finishSignIn(nonce, signature)
      })
    )

    const me = route(
      "GET",
      "/me",
      Effect.gen(function* () {
        const wallet = yield* session
        const owned = yield* rules.listForOwner(wallet)
        const funds = payments.kind === "devnet" && isAddress(wallet) ? yield* Effect.option(treasury.funds(address(wallet))) : Option.none()
        return {
          wallet,
          funds: Option.getOrNull(funds),
          rules: owned.map(ruleSummary)
        }
      })
    )

    const draftRule = route(
      "POST",
      "/rules/draft",
      Effect.gen(function* () {
        const wallet = yield* session
        const { want } = yield* body(Schema.Struct({ want: Schema.String }))
        const text = want.trim()
        if (text.length < 3 || text.length > 500) {
          return yield* new ApiError({ message: "describe what you want in 3 to 500 characters", status: 400 })
        }
        yield* limited("costly", wallet)
        const draft = yield* parser.parse(text)
        return { draft, setName: setName(draft.hard.setId), cardName: cardName(draft.hard.cardId) }
      })
    )

    const createRule = route(
      "POST",
      "/rules",
      Effect.gen(function* () {
        const wallet = yield* session
        const input = yield* body(NewRule)
        const { hard, budget } = input
        if (hard.setId !== null && !sets.some((s) => s.id === hard.setId)) {
          return yield* new ApiError({ message: "unknown set", status: 400 })
        }
        const card = hard.cardId === null ? null : cards.find((c) => c.id === hard.cardId)
        if (card === undefined || (card !== null && hard.setId !== null && card.setId !== hard.setId)) {
          return yield* new ApiError({ message: "unknown card for that set", status: 400 })
        }
        if (hard.maxPrice.currency !== budget.currency) {
          return yield* new ApiError({ message: "the budget and the price limit must use the same currency", status: 400 })
        }
        if (!(budget.amountMinor > 0) || !(hard.maxPrice.amountMinor > 0)) {
          return yield* new ApiError({ message: "the budget and the price limit must be above zero", status: 400 })
        }
        const owned = yield* rules.listForOwner(wallet)
        if (owned.filter((r) => r.rule.status === "active").length >= MAX_ACTIVE_RULES) {
          return yield* new ApiError({ message: `at most ${MAX_ACTIVE_RULES} active rules per wallet; pause one first`, status: 409 })
        }
        yield* limited("costly", wallet)
        const soft = input.softDescription?.trim() || null
        const softEmbedding = soft === null ? null : ((yield* embedder.embed([soft], "query"))[0] ?? null)
        const stored = {
          rule: {
            id: `R-${crypto.randomUUID().slice(0, 8)}`,
            ownerWallet: wallet,
            rawWant: input.rawWant.trim().slice(0, 500),
            hard: { ...hard, setId: hard.setId ?? card?.setId ?? null },
            softDescription: soft,
            budget,
            mode: "confirm" as const,
            status: "active" as const
          },
          softEmbedding
        }
        yield* rules.insert(stored)
        const { decisions, unjudgedReason } = yield* evaluateWithFallback(matcher, stored, pipelineV2)
        yield* rules.saveDecisions(decisions)
        return {
          rule: ruleSummary(stored),
          matches: decisions.filter((d) => d.verdict === "match").length,
          needsReview: decisions.filter((d) => d.verdict === "needs_review").length,
          unjudgedReason
        }
      })
    )

    const getRule = route(
      "GET",
      "/rules/:id",
      Effect.gen(function* () {
        const wallet = yield* session
        const stored = yield* ownedRule(wallet, yield* param("id"))
        const id = stored.rule.id
        const approvals = yield* sql<{ readonly id: string; readonly dailyCapUsdCents: number; readonly expiresAt: Date }>`
          SELECT id, daily_cap_usd_cents::float8 AS daily_cap_usd_cents, expires_at FROM rule_approvals
          WHERE rule_id = ${id} AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`
        const runs = yield* sql<{
          readonly id: string
          readonly listingId: string | null
          readonly trigger: string
          readonly status: string
          readonly outcome: string | null
          readonly modelCalls: number
          readonly toolCalls: number
          readonly startedAt: Date
          readonly transcript: unknown
        }>`
          SELECT id, listing_id, trigger, status, outcome, model_calls, tool_calls, started_at, transcript
          FROM agent_runs WHERE rule_id = ${id} ORDER BY started_at DESC LIMIT 20`
        return {
          rule: ruleSummary(stored),
          approvals,
          decisions: yield* latestDecisions(id),
          purchases: yield* purchases.listForRule(id),
          runs: runs.map(({ transcript, ...r }) => ({ ...r, finalText: lastAgentText(transcript) }))
        }
      })
    )

    const setRuleStatus = route(
      "POST",
      "/rules/:id/status",
      Effect.gen(function* () {
        const wallet = yield* session
        const stored = yield* ownedRule(wallet, yield* param("id"))
        const { status: next } = yield* body(Schema.Struct({ status: Schema.Literals(["active", "paused"]) }))
        if (next === "active") {
          const owned = yield* rules.listForOwner(wallet)
          if (owned.filter((r) => r.rule.status === "active" && r.rule.id !== stored.rule.id).length >= MAX_ACTIVE_RULES) {
            return yield* new ApiError({ message: `at most ${MAX_ACTIVE_RULES} active rules per wallet`, status: 409 })
          }
        }
        yield* rules.setStatus(stored.rule.id, next)
        return { ok: true }
      })
    )

    const autoStart = route(
      "POST",
      "/rules/:id/auto/start",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        const terms = yield* body(Schema.Struct({ dailyCapUsd: Schema.Number, hours: Schema.Number }))
        return yield* auth.startAutoApproval(wallet, yield* param("id"), terms)
      })
    )

    const autoFinish = route(
      "POST",
      "/rules/:id/auto/finish",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        const ruleId = yield* param("id")
        const { nonce, signature } = yield* body(Signed)
        const result = yield* auth.finishAutoApproval(wallet, nonce, signature)
        return { ...result, ruleId }
      })
    )

    const autoRevoke = route(
      "POST",
      "/rules/:id/auto/revoke",
      Effect.gen(function* () {
        const wallet = yield* session
        return { revoked: yield* auth.revokeAutoApprovals(wallet, yield* param("id")) }
      })
    )

    const askAgent = route(
      "POST",
      "/rules/:id/agent",
      Effect.gen(function* () {
        const wallet = yield* session
        const stored = yield* ownedRule(wallet, yield* param("id"))
        const { listingId } = yield* body(Schema.Struct({ listingId: Schema.String }))
        if (config.anthropicApiKey === null) {
          return yield* new ApiError({ message: "no model API key is configured on this server", status: 503 })
        }
        yield* limited("costly", wallet)
        return yield* agent.run({ ruleId: stored.rule.id, listingId, trigger: "manual" })
      })
    )

    const propose = route(
      "POST",
      "/purchases",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        const { ruleId, listingId } = yield* body(Schema.Struct({ ruleId: Schema.String, listingId: Schema.String }))
        const stored = yield* ownedRule(wallet, ruleId)
        return yield* purchases.propose(
          { actor: `collector:${wallet}`, allowedRuleIds: new Set([stored.rule.id]), runId: null },
          { ruleId, listingId, reason: "the collector picked this listing" }
        )
      })
    )

    const proposeDirect = route(
      "POST",
      "/purchases/direct",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        const { listingId } = yield* body(Schema.Struct({ listingId: Schema.String }))
        return yield* purchases.proposeDirect(wallet, listingId)
      })
    )

    const myPurchases = route(
      "GET",
      "/me/purchases",
      Effect.gen(function* () {
        const wallet = yield* session
        const rows = yield* purchases.listForBuyer(wallet)
        return {
          purchases: rows.map((p) => ({
            id: p.id,
            ruleId: p.ruleId,
            listingId: p.listingId,
            price: p.price,
            status: p.status,
            txSignature: p.txSignature
          }))
        }
      })
    )

    const approveStart = route(
      "POST",
      "/purchases/:id/approve/start",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        return yield* auth.startPurchaseApproval(wallet, yield* param("id"))
      })
    )

    const approveFinish = route(
      "POST",
      "/purchases/:id/approve/finish",
      Effect.gen(function* () {
        yield* writable
        const wallet = yield* session
        const { nonce, signature } = yield* body(Signed)
        yield* limited("chain", wallet)
        return yield* auth.finishPurchaseApproval(wallet, nonce, signature)
      })
    )

    const walletAddress = (wallet: string) =>
      isAddress(wallet) ? Effect.succeed(address(wallet)) : Effect.fail(new ApiError({ message: "not a Solana address", status: 400 }))

    const funds = route(
      "GET",
      "/wallet/funds",
      Effect.gen(function* () {
        yield* devnetOnly
        const wallet = yield* walletAddress(yield* session)
        return yield* treasury.funds(wallet)
      })
    )

    const faucet = route(
      "POST",
      "/wallet/faucet",
      Effect.gen(function* () {
        yield* writable
        yield* devnetOnly
        const wallet = yield* walletAddress(yield* session)
        const ip = yield* clientIp
        const recent = yield* sql<{ readonly n: number }>`
          SELECT count(*)::int AS n FROM faucet_grants WHERE wallet = ${wallet} AND created_at > now() - interval '1 day'`
        if ((recent[0]?.n ?? 0) > 0) {
          return yield* new ApiError({ message: "this wallet already got test dUSD today; come back tomorrow", status: 429 })
        }
        yield* limits.hit(`faucet:ip:${ip}`, 3, 86_400)
        const units = BigInt(Math.round(config.faucetUsd * 100))
        const signature = yield* treasury.faucet(wallet, units)
        yield* sql`INSERT INTO faucet_grants (wallet, token_units, lamports, signature) VALUES (${wallet}, ${units}, 0, ${signature})`
        return { signature, units }
      })
    )

    const allowance = route(
      "POST",
      "/wallet/allowance",
      Effect.gen(function* () {
        yield* writable
        yield* devnetOnly
        const wallet = yield* walletAddress(yield* session)
        const { amountUsd } = yield* body(Schema.Struct({ amountUsd: Schema.Number }))
        if (!(amountUsd >= 0) || amountUsd > MAX_ALLOWANCE_USD) {
          return yield* new ApiError({ message: `an allowance is between 0 and ${MAX_ALLOWANCE_USD} dUSD`, status: 400 })
        }
        yield* limited("chain", wallet)
        return { transaction: yield* treasury.allowanceTransaction(wallet, BigInt(Math.round(amountUsd * 100))) }
      })
    )

    const submit = route(
      "POST",
      "/wallet/submit",
      Effect.gen(function* () {
        yield* writable
        yield* devnetOnly
        const wallet = yield* session
        const { transaction } = yield* body(Schema.Struct({ transaction: Schema.String }))
        if (transaction.length > 4000) return yield* new ApiError({ message: "that transaction is too large", status: 400 })
        yield* limited("chain", wallet)
        return { signature: yield* treasury.submitSigned(transaction) }
      })
    )

    return [
      status,
      listings,
      catalogRoute,
      authStart,
      authFinish,
      me,
      draftRule,
      createRule,
      getRule,
      setRuleStatus,
      autoStart,
      autoFinish,
      autoRevoke,
      askAgent,
      propose,
      proposeDirect,
      myPurchases,
      approveStart,
      approveFinish,
      funds,
      faucet,
      allowance,
      submit
    ] as const
  }),
  { prefix: "/api" }
)
