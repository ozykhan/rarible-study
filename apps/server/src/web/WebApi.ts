import { HardCriteria, Money, type ListingView, type MatchDecision } from "@slabwatch/domain"
import { cards, sets, toUsdCents } from "@slabwatch/seed"
import { address, isAddress } from "@solana/kit"
import { Effect, Option, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql/SqlClient"
import { Agent, CHAT_MAX_CHARS, lastAgentText } from "../agent/Agent.ts"
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
import { SearchService } from "../search/SearchService.ts"
import { CardFit } from "../search/CardFit.ts"
import { SearchUnderstanding } from "../search/SearchUnderstanding.ts"
import { parseMarketQuery } from "./market.ts"
import { RateLimits } from "./RateLimits.ts"

/** A refusal with the HTTP status it answers with. */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", {
  message: Schema.String,
  status: Schema.Number
}) {}

const MAX_ACTIVE_RULES = 5
/** Agent runs on a watch's page, chat turns included, newest first. */
const RUNS_SHOWN = 40
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

/**
 * The JSON API the web app calls. A session comes from a wallet
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
    const search = yield* SearchService
    const understanding = yield* SearchUnderstanding
    const cardFit = yield* CardFit
    const rules = yield* RuleRepo
    const parser = yield* RuleParser
    const matcher = yield* Matcher
    const embedder = yield* Embedder
    const purchases = yield* Purchases
    const agent = yield* Agent

    const general = Effect.flatMap(clientIp, (ip) => limits.hit(`all:ip:${ip}`, 600, 600))

    /** Chat messages have buckets of their own, so a long chat does not use up drafting and described searches. */
    const limited = (kind: "costly" | "chat" | "chain", wallet: string | null) =>
      Effect.gen(function* () {
        const perHour = kind === "chain" ? 20 : config.costlyRequestsPerHour
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

    /**
     * Listings as the market sends them. payUnits is what each costs in dUSD
     * units (cents): what checkout funds, approves and pays. redFlags are the
     * same code checks the purchase policy runs; a flagged listing cannot be
     * bought directly.
     */
    const forSale = (ls: ReadonlyArray<ListingView>) =>
      Effect.gen(function* () {
        const facts = new Map((yield* catalog.marketFacts(ls.map((l) => l.listingId))).map((f) => [f.listingId, f]))
        return ls.map((l) => ({
          ...l,
          payUnits: toUsdCents(l.price.amountMinor, l.price.currency),
          redFlags: redFlagsFor(l, facts.get(l.listingId))
        }))
      })

    const ruleSummary = (stored: { readonly rule: import("@slabwatch/domain").WatchRule }) => ({
      ...stored.rule,
      setName: setName(stored.rule.hard.setId),
      cardName: cardName(stored.rule.hard.cardId)
    })

    /** Listings by id, in one query. */
    const listingsById = (ids: ReadonlyArray<string>) =>
      catalog.getListings([...new Set(ids)]).pipe(Effect.map((ls) => new Map(ls.map((l): [string, ListingView] => [l.listingId, l]))))

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
        const listings = yield* listingsById(sorted.map((r) => r.listingId))
        return sorted.map((r) => ({ ...r, listing: listings.get(r.listingId) ?? null }))
      })

    /**
     * A watch's purchases, each with its listing. Found for you draws a
     * purchase waiting for a signature from it: a busy watch has more
     * purchases than the 60 decisions it sends, so the decision may be missing.
     */
    const purchasesWithListings = (ruleId: string) =>
      Effect.gen(function* () {
        const rows = yield* purchases.listForRule(ruleId)
        const listings = yield* listingsById(rows.map((p) => p.listingId))
        return rows.map((p) => ({ ...p, listing: listings.get(p.listingId) ?? null }))
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
        // ?set, ?grader, ?q, ?from, ?sort, ?offset and ?limit pick one page; with none, the 40 newest.
        // stats cover the whole market, counts what matches the search and grader per set.
        const request = yield* HttpServerRequest.HttpServerRequest
        // originalUrl keeps the query string; url is the path after the /api prefix.
        const query = parseMarketQuery(new URL(request.originalUrl, "http://localhost").searchParams)
        const found = yield* search.search(query)
        const { ids, ...rest } = found
        return { listings: yield* forSale(yield* catalog.getListings(ids)), ...rest }
      })
    )

    /**
     * Reads a submitted market search with the model when code cannot: the
     * page calls it on Enter, when a search still has words nothing matches.
     * When the reading leaves a description no filter holds, the first cards
     * the search shows are judged against it (CardFit), within ?set and
     * ?grader, so the page can show only the ones that fit. Cached readings
     * and judgments are free; each new model call counts against the costly
     * limit.
     */
    const understand = route(
      "GET",
      "/search/understand",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const params = new URL(request.originalUrl, "http://localhost").searchParams
        const q = params.get("q") ?? ""
        if (q.length > 200) return yield* new ApiError({ message: "a search is at most 200 characters", status: 400 })
        const read = yield* understanding.understand(q, limited("costly", null))
        if (read.status !== "understood" || read.describes.length === 0) return read
        const fit = read.describes.join(", ")
        const checked = yield* cardFit.check(
          { ...parseMarketQuery(params), q: read.q, from: q.trim(), fit, sort: "relevance", offset: 0 },
          limited("costly", null)
        )
        return { ...read, fit, checked }
      })
    )

    const listing = route(
      "GET",
      "/listings/:id",
      Effect.gen(function* () {
        // Any status: a sold or withdrawn listing still has a page, which says it is off the market.
        const l = yield* catalog.getListing(yield* param("id"))
        if (l === null) return yield* new ApiError({ message: "no such listing", status: 404 })
        const [one] = yield* forSale([l])
        return { listing: one }
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
        return yield* parser.parse(text)
      })
    )

    const createRule = route(
      "POST",
      "/rules",
      Effect.gen(function* () {
        const wallet = yield* session
        const input = yield* body(NewRule)
        const { hard, budget } = input
        // The catalog in the database, as the parser and search see it, not the hand-written seed.
        const named = yield* catalog.namesById({ setId: hard.setId, cardId: hard.cardId })
        if (hard.setId !== null && named.set === null) {
          return yield* new ApiError({ message: "unknown set", status: 400 })
        }
        const card = named.card
        if ((hard.cardId !== null && card === null) || (card !== null && hard.setId !== null && card.setId !== hard.setId)) {
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
        // The transcript is read only for runs saved before final_text was kept.
        const runs = yield* sql<{
          readonly id: string
          readonly listingId: string | null
          readonly trigger: string
          readonly status: string
          readonly outcome: string | null
          readonly question: string | null
          readonly modelCalls: number
          readonly toolCalls: number
          readonly startedAt: Date
          readonly finalText: string | null
          readonly transcript: unknown
        }>`
          SELECT id, listing_id, trigger, status, outcome, question, model_calls, tool_calls, started_at, final_text,
                 CASE WHEN final_text IS NULL THEN transcript END AS transcript
          FROM agent_runs WHERE rule_id = ${id} ORDER BY started_at DESC LIMIT ${RUNS_SHOWN}`
        return {
          rule: ruleSummary(stored),
          approvals,
          decisions: yield* latestDecisions(id),
          purchases: yield* purchasesWithListings(id),
          runs: runs.map(({ transcript, finalText, ...r }) => ({ ...r, finalText: finalText ?? lastAgentText(transcript) }))
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

    /**
     * The chat about one watch: the collector's message, answered by the
     * agent with read-only tools. The answer is stored as a run with trigger
     * "chat", so GET /rules/:id shows it with the question. Messages are
     * limited per IP and per wallet in their own buckets, and every model
     * call in one counts against the spend cap.
     */
    const chat = route(
      "POST",
      "/rules/:id/chat",
      Effect.gen(function* () {
        const wallet = yield* session
        const stored = yield* ownedRule(wallet, yield* param("id"))
        const { message } = yield* body(Schema.Struct({ message: Schema.String }))
        const text = message.trim()
        if (text.length === 0 || text.length > CHAT_MAX_CHARS) {
          return yield* new ApiError({ message: `a message is 1 to ${CHAT_MAX_CHARS} characters`, status: 400 })
        }
        if (config.anthropicApiKey === null) {
          return yield* new ApiError({ message: "no model API key is configured on this server", status: 503 })
        }
        yield* limited("chat", wallet)
        return yield* agent.chat({ ruleId: stored.rule.id, message: text })
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
      understand,
      listing,
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
      chat,
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
