import { money, type WatchRule } from "@slabwatch/domain"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { ownerLockKey, Purchases, type Caller } from "../src/purchases/Purchases.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { seed, testLayer } from "./db.ts"
import { ruleFor } from "./rules.ts"

const TestLive = testLayer("purchases", { PURCHASE_DAILY_CAP_USD: "100000" })

/** Clean seed listings: no trap and a vault item listed only once. */
const counts = new Map<string, number>()
for (const l of seed.listings) counts.set(l.vaultItem.id, (counts.get(l.vaultItem.id) ?? 0) + 1)
const cleanIds = seed.listings
  .filter((l) => l.trap === "none" && counts.get(l.vaultItem.id) === 1 && l.listing.currency === "USD")
  .map((l) => l.listing.id)

const caller = (...ruleIds: Array<string>): Caller => ({ actor: "test", allowedRuleIds: new Set(ruleIds), runId: null })

let next = 0
const setup = (over: Partial<WatchRule> = {}, budgetX = 2) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogRepo
    const rules = yield* RuleRepo
    const id = cleanIds[next++]
    if (id === undefined) throw new Error("ran out of clean listings")
    const listing = yield* catalog.getListing(id)
    if (listing === null) throw new Error(`missing ${id}`)
    const rule = ruleFor(listing, over, budgetX)
    yield* rules.insert({ rule, softEmbedding: null })
    return { listing, rule }
  })

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("purchases against Postgres", (it) => {
  it.effect("confirm mode: propose, wait for the collector, then execute once", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const catalog = yield* CatalogRepo
      const { listing, rule } = yield* setup()
      const proposed = yield* purchases.propose(caller(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "fits" })
      expect(proposed).toMatchObject({ status: "proposed", next: "awaiting_collector_approval" })
      if (proposed.status !== "proposed") return
      expect(yield* purchases.execute(caller(rule.id), proposed.purchaseId)).toEqual({
        status: "awaiting_collector_approval",
        purchaseId: proposed.purchaseId
      })
      expect(yield* purchases.approve(proposed.purchaseId)).toBe(true)
      const done = yield* purchases.execute(caller(rule.id), proposed.purchaseId)
      expect(done).toMatchObject({ status: "executed", txSignature: `simulated:${proposed.purchaseId}` })
      expect((yield* catalog.getListing(listing.listingId))?.status).toBe("sold")
      // Executing again, or proposing the sold listing again, gets nowhere.
      expect(yield* purchases.execute(caller(rule.id), proposed.purchaseId)).toMatchObject({ status: "refused" })
      const again = yield* purchases.propose(caller(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "again" })
      expect(again.status).toBe("refused")
    }))

  it.effect("refuses a rule that is not on the caller's allow-list, and keeps a record", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const { listing, rule } = yield* setup()
      const result = yield* purchases.propose(caller("SOMEONE-ELSE"), { ruleId: rule.id, listingId: listing.listingId, reason: "x" })
      expect(result.status).toBe("refused")
      if (result.status !== "refused") return
      expect(result.refusals.join(" ")).toMatch(/not on this caller's allow-list/)
      expect((yield* purchases.listForRule(rule.id)).map((p) => p.status)).toEqual(["refused"])
    }))

  it.effect("refuses over the rule budget and over the daily cap", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const tight = yield* setup({}, 0.5)
      const overBudget = yield* purchases.propose(caller(tight.rule.id), {
        ruleId: tight.rule.id,
        listingId: tight.listing.listingId,
        reason: "x"
      })
      expect(overBudget.status === "refused" && overBudget.refusals.join(" ")).toMatch(/budget/)

      const auto = yield* setup({ mode: "auto" })
      yield* purchases.recordApproval({
        ruleId: auto.rule.id,
        wallet: auto.rule.ownerWallet ?? "",
        budget: auto.rule.budget,
        dailyCapUsdCents: 1,
        mode: "auto",
        message: "test",
        signature: "test",
        expiresAt: new Date(Date.now() + 3_600_000)
      })
      const proposed = yield* purchases.propose(caller(auto.rule.id), { ruleId: auto.rule.id, listingId: auto.listing.listingId, reason: "x" })
      expect(proposed.status === "refused" && proposed.refusals.join(" ")).toMatch(/daily cap/)
    }))

  it.effect("auto mode executes with a signed approval and without one refuses", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const unsigned = yield* setup({ mode: "auto" })
      const p1 = yield* purchases.propose(caller(unsigned.rule.id), { ruleId: unsigned.rule.id, listingId: unsigned.listing.listingId, reason: "x" })
      expect(p1).toMatchObject({ status: "proposed", next: "awaiting_collector_approval" })
      if (p1.status !== "proposed") return
      const r1 = yield* purchases.execute(caller(unsigned.rule.id), p1.purchaseId)
      expect(r1.status === "refused" && r1.refusals.join(" ")).toMatch(/no unexpired auto-buy approval/)

      const signed = yield* setup({ mode: "auto" })
      yield* purchases.recordApproval({
        ruleId: signed.rule.id,
        wallet: signed.rule.ownerWallet ?? "",
        budget: signed.rule.budget,
        dailyCapUsdCents: 10_000_000,
        mode: "auto",
        message: "test",
        signature: "test",
        expiresAt: new Date(Date.now() + 3_600_000)
      })
      const p2 = yield* purchases.propose(caller(signed.rule.id), { ruleId: signed.rule.id, listingId: signed.listing.listingId, reason: "x" })
      expect(p2).toMatchObject({ status: "proposed", next: "execute_allowed" })
      if (p2.status !== "proposed") return
      expect((yield* purchases.execute(caller(signed.rule.id), p2.purchaseId)).status).toBe("executed")
    }))

  it.effect("refuses when the seller changed the price after the proposal", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const sql = yield* SqlClient
      const { listing, rule } = yield* setup({}, 3)
      const p = yield* purchases.propose(caller(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "x" })
      if (p.status !== "proposed") throw new Error("expected a proposal")
      yield* purchases.approve(p.purchaseId)
      yield* sql`UPDATE listings SET price_minor = price_minor - 1 WHERE id = ${listing.listingId}`
      const r = yield* purchases.execute(caller(rule.id), p.purchaseId)
      expect(r.status === "refused" && r.refusals.join(" ")).toMatch(/price changed/)
    }))

  it.effect("a second purchase that would overrun the budget is refused at execution", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const catalog = yield* CatalogRepo
      const rules = yield* RuleRepo
      const a = yield* catalog.getListing(cleanIds[next++] ?? "")
      const b = yield* catalog.getListing(cleanIds[next++] ?? "")
      if (a === null || b === null) throw new Error("missing listings")
      const dearest = Math.max(a.price.amountMinor, b.price.amountMinor)
      // Broad enough for both listings, with room for either one but not both.
      const rule: WatchRule = {
        ...ruleFor(a),
        hard: { setId: null, cardId: null, edition: "any", finish: "any", graders: [], minGrade: 1, maxPrice: money(dearest, "USD") },
        budget: money(dearest, "USD")
      }
      yield* rules.insert({ rule, softEmbedding: null })
      const ids: Array<string> = []
      for (const l of [a, b]) {
        const p = yield* purchases.propose(caller(rule.id), { ruleId: rule.id, listingId: l.listingId, reason: "x" })
        if (p.status !== "proposed") throw new Error(`expected a proposal, got ${JSON.stringify(p)}`)
        yield* purchases.approve(p.purchaseId)
        ids.push(p.purchaseId)
      }
      const [first, second] = [yield* purchases.execute(caller(rule.id), ids[0] ?? ""), yield* purchases.execute(caller(rule.id), ids[1] ?? "")]
      expect(first.status).toBe("executed")
      expect(second.status === "refused" && second.refusals.join(" ")).toMatch(/budget/)
    }))

  it.effect("executions for the same owner wait for the owner lock", () =>
    Effect.gen(function* () {
      const purchases = yield* Purchases
      const sql = yield* SqlClient
      const { listing, rule } = yield* setup()
      const p = yield* purchases.propose(caller(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "x" })
      if (p.status !== "proposed") throw new Error("expected a proposal")
      yield* purchases.approve(p.purchaseId)
      // Another transaction holds this owner's lock for 300 ms; the execution has to wait it out.
      const holder = sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${ownerLockKey(rule.ownerWallet)}))`
          yield* sql`SELECT pg_sleep(0.3)`
        })
      )
      const started = Date.now()
      const [, waited] = yield* Effect.all(
        [
          holder,
          Effect.sleep("50 millis").pipe(
            Effect.andThen(purchases.execute(caller(rule.id), p.purchaseId)),
            Effect.map((r) => ({ status: r.status, ms: Date.now() - started }))
          )
        ],
        { concurrency: "unbounded" }
      )
      expect(waited.status).toBe("executed")
      expect(waited.ms).toBeGreaterThanOrEqual(280)
    }))
})
