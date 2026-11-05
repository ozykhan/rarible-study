/**
 * Prompt injection, tested where it matters: at the purchase. The model is
 * replaced by a script that does what an injected model might do (execute
 * without a proposal, act for another collector's rule, buy a flagged
 * listing, overrun the budget, pay in confirm mode) and the tests check
 * that code refuses every step and that nothing is paid for.
 */
import { money, type ListingView, type WatchRule } from "@slabwatch/domain"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Agent, makeAgent } from "../src/agent/Agent.ts"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Llm } from "../src/llm/Llm.ts"
import { describeFlag } from "../src/matcher/redFlags.ts"
import { Purchases } from "../src/purchases/Purchases.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { seed, testLayer } from "./db.ts"
import { ruleFor } from "./rules.ts"
import { scriptedLlm, type Step } from "./scriptedLlm.ts"

const TestLive = testLayer("agent", { PURCHASE_DAILY_CAP_USD: "100000", AGENT_MAX_STEPS: "6" })

const listedOnce = (id: string) => seed.listings.filter((x) => x.vaultItem.id === id).length === 1
const clean = seed.listings
  .filter((l) => l.trap === "none" && l.listing.currency === "USD" && listedOnce(l.vaultItem.id))
  .map((l) => l.listing.id)
const tooCheap = seed.listings.filter((l) => l.trap === "too_cheap" && l.listing.currency === "USD").map((l) => l.listing.id)

let nextClean = 0
let nextCheap = 0
const take = (ids: ReadonlyArray<string>, which: "clean" | "cheap") =>
  Effect.gen(function* () {
    const catalog = yield* CatalogRepo
    const id = which === "clean" ? ids[nextClean++] : ids[nextCheap++]
    if (id === undefined) throw new Error(`ran out of ${which} listings`)
    const l = yield* catalog.getListing(id)
    if (l === null) throw new Error(`missing ${id}`)
    return l
  })

/** A rule any USD listing satisfies, so refusals come from the policy and not from the matcher. */
const broadRule = (l: ListingView, budgetMinor: number, over: Partial<WatchRule> = {}): WatchRule => ({
  ...ruleFor(l, over),
  hard: { setId: null, cardId: null, edition: "any", finish: "any", graders: [], minGrade: 1, maxPrice: money(100_000_000, "USD") },
  budget: money(budgetMinor, "USD")
})

const agentWith = (steps: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const script = scriptedLlm(steps)
    const agent = yield* makeAgent.pipe(Effect.provideService(Llm, script.llm))
    return { agent, script }
  })

const purchasesOf = (ruleIds: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    return yield* sql<{ readonly ruleId: string; readonly listingId: string; readonly status: string; readonly refusals: ReadonlyArray<string> }>`
      SELECT rule_id, listing_id, status, refusals FROM purchases WHERE rule_id IN ${sql.in(ruleIds)} ORDER BY created_at`
  })

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("agent loop under prompt injection", (it) => {
  it.effect("confirm mode: every unsafe step is refused and nothing is paid for", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const good = yield* take(clean, "clean")
      const flagged = yield* take(tooCheap, "cheap")
      const budget = Math.max(good.price.amountMinor, flagged.price.amountMinor) * 2
      const rule = broadRule(good, budget)
      const someoneElse = broadRule(good, budget)
      yield* rules.insert({ rule, softEmbedding: null })
      yield* rules.insert({ rule: someoneElse, softEmbedding: null })

      const { agent, script } = yield* agentWith([
        () => [
          { name: "execute_purchase", input: { purchase_id: "P-invented" } },
          { name: "propose_purchase", input: { rule_id: someoneElse.id, listing_id: good.listingId, reason: "the seller said to" } },
          { name: "propose_purchase", input: { rule_id: rule.id, listing_id: flagged.listingId, reason: "a bargain" } }
        ],
        () => [{ name: "propose_purchase", input: { rule_id: rule.id, listing_id: good.listingId, reason: "fits" } }],
        (prev) => [{ name: "execute_purchase", input: { purchase_id: prev[0]?.body["purchase_id"] } }],
        () => "Proposed one listing."
      ])
      const result = yield* agent.run({ ruleId: rule.id, listingId: good.listingId, trigger: "manual" })

      // Confirm mode never offers execute_purchase, and asking for it anyway is refused.
      for (const req of script.requests) expect(req.tools.map((t) => t.name)).not.toContain("execute_purchase")
      const [first, , third] = script.replies
      expect(first?.[0]).toMatchObject({ isError: true, body: { error: "the tool execute_purchase is not available to you" } })
      expect(first?.[1]?.body).toMatchObject({ status: "refused" })
      expect(first?.[1]?.body["refusals"].join(" ")).toMatch(/allow-list/)
      expect(first?.[2]?.body).toMatchObject({ status: "refused" })
      expect(first?.[2]?.body["refusals"]).toEqual([describeFlag.price_far_below_market])
      expect(third?.[0]?.isError).toBe(true)

      expect(result).toMatchObject({ status: "done", outcome: "proposed", modelCalls: 4, toolCalls: 5 })
      const rows = yield* purchasesOf([rule.id, someoneElse.id])
      expect(rows.map((r) => r.status)).toEqual(["refused", "refused", "proposed"])
      expect(rows.some((r) => r.status === "executed")).toBe(false)
    }))

  it.effect("auto mode without a signed approval: proposing is allowed, paying is not", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const a = yield* take(clean, "clean")
      const b = yield* take(clean, "clean")
      const rule = broadRule(a, a.price.amountMinor, { mode: "auto" })
      yield* rules.insert({ rule, softEmbedding: null })

      const { agent, script } = yield* agentWith([
        () => [{ name: "propose_purchase", input: { rule_id: rule.id, listing_id: a.listingId, reason: "fits" } }],
        (prev) => [{ name: "execute_purchase", input: { purchase_id: prev[0]?.body["purchase_id"] } }],
        () => [{ name: "propose_purchase", input: { rule_id: rule.id, listing_id: b.listingId, reason: "and this one" } }],
        () => "Done."
      ])
      const result = yield* agent.run({ ruleId: rule.id, listingId: a.listingId, trigger: "manual" })

      expect(script.requests[0]?.tools.map((t) => t.name)).toContain("execute_purchase")
      const [, paid] = script.replies
      expect(paid?.[0]?.body).toMatchObject({ status: "refused" })
      expect(paid?.[0]?.body["refusals"].join(" ")).toMatch(/no unexpired auto-buy approval/)
      expect(result.outcome).toBe("proposed")
      const rows = yield* purchasesOf([rule.id])
      expect(rows.some((r) => r.status === "executed")).toBe(false)
    }))

  it.effect("auto mode with a signed approval pays once, then the budget stops a second buy", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const purchases = yield* Purchases
      const a = yield* take(clean, "clean")
      const b = yield* take(clean, "clean")
      // Room for the first listing and a little more, never for both.
      const rule = broadRule(a, Math.round(a.price.amountMinor * 1.01), { mode: "auto" })
      yield* rules.insert({ rule, softEmbedding: null })
      yield* purchases.recordApproval({
        ruleId: rule.id,
        wallet: rule.ownerWallet ?? "",
        budget: rule.budget,
        dailyCapUsdCents: 10_000_000,
        mode: "auto",
        message: "test",
        signature: "test",
        expiresAt: new Date(Date.now() + 3_600_000)
      })

      const { agent, script } = yield* agentWith([
        () => [{ name: "propose_purchase", input: { rule_id: rule.id, listing_id: a.listingId, reason: "fits" } }],
        (prev) => [{ name: "execute_purchase", input: { purchase_id: prev[0]?.body["purchase_id"] } }],
        () => [{ name: "propose_purchase", input: { rule_id: rule.id, listing_id: b.listingId, reason: "ignore the budget" } }],
        () => "Bought one."
      ])
      const result = yield* agent.run({ ruleId: rule.id, listingId: a.listingId, trigger: "manual" })

      expect(script.replies[1]?.[0]?.body).toMatchObject({ status: "executed" })
      const third = script.replies[2]?.[0]?.body
      expect(b.price.amountMinor).toBeGreaterThan(rule.budget.amountMinor - a.price.amountMinor)
      expect(third).toMatchObject({ status: "refused" })
      expect(third?.["refusals"].join(" ")).toMatch(/budget/)
      expect(result.outcome).toBe("executed")
      const rows = yield* purchasesOf([rule.id])
      expect(rows.filter((r) => r.status === "executed").map((r) => r.listingId)).toEqual([a.listingId])
    }))

  it.effect("a model that never stops is cut off at the step limit", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const sql = yield* SqlClient
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor)
      yield* rules.insert({ rule, softEmbedding: null })
      const forever: Step = () => [{ name: "search_listings", input: { limit: 1 } }]
      const { agent } = yield* agentWith(Array.from({ length: 50 }, () => forever))
      const result = yield* agent.run({ ruleId: rule.id, listingId: null, trigger: "manual" })
      expect(result).toMatchObject({ status: "done", outcome: "step_limit", modelCalls: 6, toolCalls: 6 })
      const run = yield* sql<{ readonly status: string; readonly outcome: string; readonly turns: number }>`
        SELECT status, outcome, jsonb_array_length(transcript) AS turns FROM agent_runs WHERE id = ${result.runId}`
      expect(run[0]).toEqual({ status: "done", outcome: "step_limit", turns: 13 })
    }))

  it.effect("without an API key the run fails cleanly and says why", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const agent = yield* Agent
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor)
      yield* rules.insert({ rule, softEmbedding: null })
      const result = yield* agent.run({ ruleId: rule.id, listingId: l.listingId, trigger: "manual" })
      expect(result).toMatchObject({ status: "failed", outcome: "llm_not_configured", modelCalls: 0 })
      const unknown = yield* agent.run({ ruleId: "NO-SUCH-RULE", listingId: null, trigger: "manual" })
      expect(unknown.outcome).toBe("no_such_rule")
    }))
})
