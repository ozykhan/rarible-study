import { formatMoney, type ListingView, type Money, type WatchRule } from "@slabwatch/domain"
import { toUsdCents } from "@slabwatch/seed"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { toTextArray } from "../db/Database.ts"
import { AppConfig } from "../config.ts"
import { redFlagsFor } from "../matcher/redFlags.ts"
import { RuleRepo } from "../rules/RuleRepo.ts"
import { currentTraceId } from "../tracing.ts"
import { Payments } from "./Payments.ts"
import { checkPurchase, type Authorization, type PolicyAction, type PolicyResult } from "./policy.ts"

/** Who is asking: an agent run or an MCP token, and which rules it may act for. */
export interface Caller {
  readonly actor: string
  readonly allowedRuleIds: ReadonlySet<string>
  readonly runId: string | null
}

export type PurchaseStatus = "proposed" | "approved" | "executing" | "executed" | "failed" | "refused"

export interface Purchase {
  readonly id: string
  readonly ruleId: string
  readonly listingId: string
  readonly runId: string | null
  readonly actor: string
  readonly price: Money
  readonly status: PurchaseStatus
  readonly reason: string | null
  readonly refusals: ReadonlyArray<string>
  readonly txSignature: string | null
  readonly traceId: string | null
}

export type ProposeResult =
  | {
      readonly status: "proposed"
      readonly purchaseId: string
      readonly price: Money
      /** What happens next: the caller may execute, or the collector has to approve first. */
      readonly next: "execute_allowed" | "awaiting_collector_approval"
    }
  | { readonly status: "refused"; readonly purchaseId: string | null; readonly refusals: ReadonlyArray<string> }

export type ExecuteResult =
  | { readonly status: "executed"; readonly purchaseId: string; readonly price: Money; readonly txSignature: string }
  | { readonly status: "awaiting_collector_approval"; readonly purchaseId: string }
  | { readonly status: "refused"; readonly purchaseId: string; readonly refusals: ReadonlyArray<string> }
  | { readonly status: "failed"; readonly purchaseId: string; readonly error: string }

export interface ApprovalInput {
  readonly ruleId: string
  readonly wallet: string
  readonly budget: Money
  readonly dailyCapUsdCents: number
  readonly mode: WatchRule["mode"]
  readonly message: string
  readonly signature: string
  readonly expiresAt: Date
}

export class Purchases extends Context.Service<
  Purchases,
  {
    readonly propose: (
      caller: Caller,
      args: { readonly ruleId: string; readonly listingId: string; readonly reason: string }
    ) => Effect.Effect<ProposeResult, SqlError>
    readonly execute: (caller: Caller, purchaseId: string) => Effect.Effect<ExecuteResult, SqlError>
    /** The collector approves one proposal (confirm mode). The wallet signature check sits in front of this. */
    readonly approve: (purchaseId: string) => Effect.Effect<boolean, SqlError>
    /** Stores a budget approval the collector signed. The signature is verified before this is called. */
    readonly recordApproval: (a: ApprovalInput) => Effect.Effect<string, SqlError>
    readonly get: (purchaseId: string) => Effect.Effect<Purchase | null, SqlError>
    readonly listForRule: (ruleId: string) => Effect.Effect<ReadonlyArray<Purchase>, SqlError>
  }
>()("slabwatch/Purchases") {}

interface PurchaseRowDb {
  readonly id: string
  readonly ruleId: string
  readonly listingId: string
  readonly runId: string | null
  readonly actor: string
  readonly priceMinor: number
  readonly currency: Money["currency"]
  readonly status: PurchaseStatus
  readonly reason: string | null
  readonly refusals: ReadonlyArray<string>
  readonly txSignature: string | null
  readonly traceId: string | null
}

const toPurchase = (r: PurchaseRowDb): Purchase => ({
  id: r.id,
  ruleId: r.ruleId,
  listingId: r.listingId,
  runId: r.runId,
  actor: r.actor,
  price: { amountMinor: r.priceMinor, currency: r.currency },
  status: r.status,
  reason: r.reason,
  refusals: r.refusals,
  txSignature: r.txSignature,
  traceId: r.traceId
})

/** Purchases by one owner are serialized on this advisory lock, so budgets and daily caps hold under concurrency. */
export const ownerLockKey = (ownerWallet: string | null) => `owner:${ownerWallet ?? "none"}`

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 13)}`

export const PurchasesLive = Layer.effect(
  Purchases,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const config = yield* AppConfig
    const catalog = yield* CatalogRepo
    const rules = yield* RuleRepo
    const payments = yield* Payments

    const selectPurchase = sql`
      SELECT id, rule_id, listing_id, run_id, actor, price_minor::float8 AS price_minor, currency, status, reason,
             refusals, tx_signature, trace_id
      FROM purchases`

    const activeApproval = (ruleId: string) =>
      sql<{ readonly id: string; readonly dailyCapUsdCents: number; readonly mode: WatchRule["mode"] }>`
        SELECT id, daily_cap_usd_cents::float8 AS daily_cap_usd_cents, mode FROM rule_approvals
        WHERE rule_id = ${ruleId} AND revoked_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1`.pipe(Effect.map((rows) => rows[0] ?? null))

    /** Everything the policy needs, read fresh from the database. */
    const evaluate = (
      caller: Caller,
      action: PolicyAction,
      rule: WatchRule,
      listing: ListingView | null,
      excludePurchaseId: string | null,
      collectorApproved: boolean
    ) =>
      Effect.gen(function* () {
        const facts = listing === null ? [] : yield* catalog.marketFacts([listing.listingId])
        const redFlags = listing === null ? [] : redFlagsFor(listing, facts[0])
        const live = listing === null
          ? []
          : yield* sql<{ readonly n: number }>`
              SELECT count(*)::int AS n FROM purchases
              WHERE listing_id = ${listing.listingId} AND id <> ${excludePurchaseId ?? ""}
                AND status IN ('proposed', 'approved', 'executing', 'executed')`
        const onRule = yield* sql<{ readonly total: number }>`
          SELECT coalesce(sum(price_minor), 0)::float8 AS total FROM purchases
          WHERE rule_id = ${rule.id} AND status IN ('executing', 'executed')`
        const today = yield* sql<{ readonly total: number }>`
          SELECT coalesce(sum(p.price_usd_cents), 0)::float8 AS total
          FROM purchases p JOIN watch_rules r ON r.id = p.rule_id
          WHERE r.owner_wallet IS NOT DISTINCT FROM ${rule.ownerWallet}
            AND p.status IN ('executing', 'executed')
            AND p.executing_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'`
        const approval = rule.mode === "auto" ? yield* activeApproval(rule.id) : null
        const serverCap = Math.round(config.purchaseDailyCapUsd * 100)
        const authorization: Authorization = collectorApproved
          ? "collector_approved"
          : approval !== null && approval.mode === "auto"
            ? "auto_approval"
            : "none"
        return checkPurchase({
          action,
          rule,
          listing,
          redFlags,
          allowedRuleIds: caller.allowedRuleIds,
          readOnly: config.readOnly,
          otherLivePurchases: live[0]?.n ?? 0,
          committedOnRuleMinor: onRule[0]?.total ?? 0,
          committedTodayUsdCents: today[0]?.total ?? 0,
          dailyCapUsdCents: approval === null ? serverCap : Math.min(serverCap, approval.dailyCapUsdCents),
          authorization
        })
      })

    const insertPurchase = (
      caller: Caller,
      rule: WatchRule,
      listing: ListingView,
      status: "proposed" | "refused",
      reason: string,
      result: PolicyResult
    ) =>
      Effect.gen(function* () {
        const id = newId("P")
        const traceId = yield* currentTraceId
        yield* sql`
          INSERT INTO purchases (id, rule_id, listing_id, run_id, actor, price_minor, currency, price_usd_cents, status,
                                 reason, refusals, trace_id)
          VALUES (${id}, ${rule.id}, ${listing.listingId}, ${caller.runId}, ${caller.actor}, ${listing.price.amountMinor},
                  ${listing.price.currency}, ${toUsdCents(listing.price.amountMinor, listing.price.currency)}, ${status},
                  ${reason.slice(0, 500)}, ${toTextArray(result.refusals)}::text[], ${traceId})`
        return id
      })

    const propose = Effect.fn("Purchases.propose")(function* (
      caller: Caller,
      args: { readonly ruleId: string; readonly listingId: string; readonly reason: string }
    ) {
      yield* Effect.annotateCurrentSpan({ "rule.id": args.ruleId, "listing.id": args.listingId, actor: caller.actor })
      const stored = yield* rules.get(args.ruleId)
      if (stored === null) {
        return { status: "refused", purchaseId: null, refusals: [`there is no rule ${args.ruleId}`] } satisfies ProposeResult
      }
      const listing = yield* catalog.getListing(args.listingId)
      const result = yield* evaluate(caller, "propose", stored.rule, listing, null, false)
      if (listing === null) {
        return { status: "refused", purchaseId: null, refusals: result.refusals } satisfies ProposeResult
      }
      if (!result.allowed) {
        const id = yield* insertPurchase(caller, stored.rule, listing, "refused", args.reason, result)
        yield* Effect.annotateCurrentSpan({ "purchase.outcome": "refused" })
        return { status: "refused", purchaseId: id, refusals: result.refusals } satisfies ProposeResult
      }
      // The unique index is the last word on "one live purchase per listing", even under races.
      const inserted = yield* insertPurchase(caller, stored.rule, listing, "proposed", args.reason, result).pipe(
        Effect.map((id) => ({ id })),
        Effect.catchTag("SqlError", (e) =>
          e.reason._tag === "UniqueViolation" ? Effect.succeed(null) : Effect.fail(e)
        )
      )
      if (inserted === null) {
        return { status: "refused", purchaseId: null, refusals: ["this listing already has a live purchase"] } satisfies ProposeResult
      }
      const approval = stored.rule.mode === "auto" ? yield* activeApproval(stored.rule.id) : null
      yield* Effect.annotateCurrentSpan({ "purchase.outcome": "proposed", "purchase.id": inserted.id })
      return {
        status: "proposed",
        purchaseId: inserted.id,
        price: listing.price,
        next: approval !== null ? "execute_allowed" : "awaiting_collector_approval"
      } satisfies ProposeResult
    })

    const execute = Effect.fn("Purchases.execute")(function* (caller: Caller, purchaseId: string) {
      yield* Effect.annotateCurrentSpan({ "purchase.id": purchaseId, actor: caller.actor })

      // Claim the purchase under a per-owner lock, so two executions can never
      // both fit under the same budget or daily cap.
      const claim = yield* sql.withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<PurchaseRowDb>`${selectPurchase} WHERE id = ${purchaseId} FOR UPDATE`
          const row = rows[0]
          if (row === undefined) {
            return { done: { status: "refused", purchaseId, refusals: [`there is no purchase ${purchaseId}`] } } as const
          }
          if (row.status !== "proposed" && row.status !== "approved") {
            return { done: { status: "refused", purchaseId, refusals: [`this purchase is already ${row.status}`] } } as const
          }
          const stored = yield* rules.get(row.ruleId)
          if (stored === null) {
            return { done: { status: "refused", purchaseId, refusals: ["the rule no longer exists"] } } as const
          }
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ownerLockKey(stored.rule.ownerWallet)}))`
          const listing = yield* catalog.getListing(row.listingId)
          const result = yield* evaluate(caller, "execute", stored.rule, listing, row.id, row.status === "approved")
          const priceChanged = listing !== null && listing.price.amountMinor !== row.priceMinor
          const refusals = [
            ...result.refusals,
            ...(priceChanged && listing !== null
              ? [`the price changed from ${formatMoney({ amountMinor: row.priceMinor, currency: row.currency })} to ${formatMoney(listing.price)} after the proposal`]
              : [])
          ]
          if (result.waitingForApproval && !priceChanged) {
            return { done: { status: "awaiting_collector_approval", purchaseId } } as const
          }
          if (!result.allowed || priceChanged || listing === null) {
            yield* sql`UPDATE purchases SET status = 'refused', refusals = ${toTextArray(refusals)}::text[], finished_at = now()
                       WHERE id = ${purchaseId}`
            return { done: { status: "refused", purchaseId, refusals } } as const
          }
          yield* sql`UPDATE purchases SET status = 'executing', executing_at = now() WHERE id = ${purchaseId}`
          return { claimed: { row, rule: stored.rule, listing } } as const
        })
      )
      if ("done" in claim) {
        yield* Effect.annotateCurrentSpan({ "purchase.outcome": claim.done.status })
        return claim.done satisfies ExecuteResult
      }

      const { row, rule, listing } = claim.claimed
      const price: Money = { amountMinor: row.priceMinor, currency: row.currency }
      return yield* payments
        .transfer({ purchaseId, amount: price, from: rule.ownerWallet, memo: `slabwatch ${purchaseId} ${listing.listingId}` })
        .pipe(
          Effect.matchEffect({
            onFailure: (e) =>
              sql`UPDATE purchases SET status = 'failed', refusals = ${toTextArray([e.message])}::text[], finished_at = now()
                  WHERE id = ${purchaseId}`.pipe(
                Effect.as({ status: "failed", purchaseId, error: e.message } satisfies ExecuteResult)
              ),
            onSuccess: ({ signature }) =>
              sql
                .withTransaction(
                  Effect.all([
                    sql`UPDATE purchases SET status = 'executed', tx_signature = ${signature}, finished_at = now()
                        WHERE id = ${purchaseId}`,
                    sql`UPDATE listings SET status = 'sold' WHERE id = ${listing.listingId}`
                  ])
                )
                .pipe(Effect.as({ status: "executed", purchaseId, price, txSignature: signature } satisfies ExecuteResult))
          }),
          Effect.tap((r) => Effect.annotateCurrentSpan({ "purchase.outcome": r.status }))
        )
    })

    const approve = Effect.fn("Purchases.approve")(function* (purchaseId: string) {
      const rows = yield* sql<{ readonly id: string }>`
        UPDATE purchases SET status = 'approved', approved_at = now()
        WHERE id = ${purchaseId} AND status = 'proposed' RETURNING id`
      return rows.length > 0
    })

    const recordApproval = Effect.fn("Purchases.recordApproval")(function* (a: ApprovalInput) {
      const id = newId("A")
      yield* sql`
        INSERT INTO rule_approvals (id, rule_id, wallet, budget_minor, currency, daily_cap_usd_cents, mode, message,
                                    signature, expires_at)
        VALUES (${id}, ${a.ruleId}, ${a.wallet}, ${a.budget.amountMinor}, ${a.budget.currency}, ${a.dailyCapUsdCents},
                ${a.mode}, ${a.message}, ${a.signature}, ${a.expiresAt.toISOString()}::timestamptz)`
      return id
    })

    const get = Effect.fn("Purchases.get")(function* (purchaseId: string) {
      const rows = yield* sql<PurchaseRowDb>`${selectPurchase} WHERE id = ${purchaseId}`
      return rows[0] ? toPurchase(rows[0]) : null
    })

    const listForRule = Effect.fn("Purchases.listForRule")(function* (ruleId: string) {
      const rows = yield* sql<PurchaseRowDb>`${selectPurchase} WHERE rule_id = ${ruleId} ORDER BY created_at`
      return rows.map(toPurchase)
    })

    return Purchases.of({ propose, execute, approve, recordApproval, get, listForRule })
  })
)
