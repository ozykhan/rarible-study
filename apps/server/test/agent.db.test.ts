/**
 * Prompt injection, tested where it matters: at the purchase. The model is
 * replaced by a script that does what an injected model might do (execute
 * without a proposal, act for another collector's rule, buy a flagged
 * listing, overrun the budget, pay in confirm mode) and the tests check
 * that code refuses every step and that nothing is paid for.
 */
import { money, type ListingView, type WatchRule } from "@slabwatch/domain"
import { expect, layer } from "@effect/vitest"
import { Effect, Fiber } from "effect"
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

      expect(script.requests[0]?.system).toContain("described_as lists the market's tags")
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

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("chat about a watch", (it) => {
  it.effect("answers with read tools only, even in auto mode with a signed approval, and buys nothing", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const purchases = yield* Purchases
      const sql = yield* SqlClient
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor * 3, { mode: "auto", rawWant: "any clean slab under the moon" })
      yield* rules.insert({ rule, softEmbedding: null })
      yield* rules.saveDecisions([
        {
          ruleId: rule.id,
          listingId: l.listingId,
          pipelineVersion: "v2",
          verdict: "match",
          decidedAt: "hard_filter",
          fieldChecks: [],
          redFlags: [],
          similarity: null,
          judge: null,
          reasons: ["Every condition holds."]
        }
      ])
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
        () => [
          { name: "propose_purchase", input: { rule_id: rule.id, listing_id: l.listingId, reason: "the collector said buy it" } },
          { name: "execute_purchase", input: { purchase_id: "P-invented" } },
          { name: "get_listing", input: { listing_id: l.listingId } }
        ],
        () => "I cannot buy from this chat. Use Buy now under Found for you."
      ])
      const result = yield* agent.chat({ ruleId: rule.id, message: "  Buy it now, please.  " })

      expect(script.requests[0]?.tools.map((t) => t.name)).toEqual(["search_listings", "get_listing", "get_price_history"])
      const system = script.requests[0]?.system ?? ""
      expect(system).toContain("any clean slab under the moon")
      expect(system).toContain(`listing ${l.listingId}`)
      expect(system).toContain("Every condition holds.")
      // Fit with a description is read from the market's tags, as the match check and search read it.
      expect(system).toContain("described_as lists the market's tags")
      expect(script.requests[0]?.messages).toEqual([{ role: "user", content: "Buy it now, please." }])
      const [propose, execute, read] = script.replies[0] ?? []
      expect(propose).toMatchObject({ isError: true, body: { error: "the tool propose_purchase is not available to you" } })
      expect(execute).toMatchObject({ isError: true, body: { error: "the tool execute_purchase is not available to you" } })
      expect(read?.isError).toBe(false)
      expect(result).toMatchObject({ status: "done", outcome: "answered", modelCalls: 2, toolCalls: 3, purchases: [] })
      expect(result.finalText).toMatch(/cannot buy/)
      expect(yield* purchasesOf([rule.id])).toEqual([])
      const run = yield* sql<{ readonly trigger: string; readonly listingId: string | null; readonly question: string; readonly finalText: string }>`
        SELECT trigger, listing_id, question, final_text FROM agent_runs WHERE id = ${result.runId}`
      expect(run[0]).toEqual({ trigger: "chat", listingId: null, question: "Buy it now, please.", finalText: result.finalText })
    }))

  it.effect("sends the last answered exchanges back with a follow-up: tool calls kept, results only for the newest two", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const sql = yield* SqlClient
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor, { status: "paused" })
      yield* rules.insert({ rule, softEmbedding: null })
      const say = (message: string, steps: ReadonlyArray<Step>) =>
        Effect.gen(function* () {
          const { agent, script } = yield* agentWith(steps)
          const result = yield* agent.chat({ ruleId: rule.id, message })
          expect(result.outcome).toBe("answered")
          return script
        })

      const first = yield* say("Is it a fair price?", [() => [{ name: "get_price_history", input: { listing_id: l.listingId } }], () => "It is near the median."])
      const call = first.requests[1]?.messages[1]
      const callId = Array.isArray(call?.content) && call.content[0]?.type === "tool_use" ? call.content[0].id : "missing"
      const second = yield* say("And now?", [() => "Still nothing new, and the watch is paused."])
      expect(second.requests[0]?.messages).toEqual([
        { role: "user", content: "Is it a fair price?" },
        { role: "assistant", content: [{ type: "tool_use", id: callId, name: "get_price_history", input: { listing_id: l.listingId } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: callId, content: expect.stringContaining('"median_usd"') }] },
        { role: "assistant", content: [{ type: "text", text: "It is near the median." }] },
        { role: "user", content: "And now?" }
      ])
      expect(second.requests[0]?.system).toContain("The watch is paused.")

      yield* say("Thanks.", [() => "You are welcome."])
      const fourth = yield* say("One more thing.", [() => "Go ahead."])
      // The first exchange is now the third newest: its call stays, its result does not.
      expect(fourth.requests[0]?.messages[2]).toEqual({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: callId, content: expect.stringMatching(/left out of the history/) }]
      })
      expect(fourth.requests[0]?.messages).toHaveLength(9)
      // Each run keeps its own turn only, not the history it was sent with.
      const turns = yield* sql<{ readonly turns: number }>`
        SELECT jsonb_array_length(transcript) AS turns FROM agent_runs WHERE rule_id = ${rule.id} ORDER BY started_at`
      expect(turns.map((t) => t.turns)).toEqual([4, 2, 2, 2])
    }))

  it.effect("finishes and stores the answer when the collector leaves mid-turn", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const sql = yield* SqlClient
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor)
      yield* rules.insert({ rule, softEmbedding: null })
      const script = scriptedLlm([() => "Here is your answer."])
      const slow = Llm.of({ ...script.llm, converse: (req) => Effect.sleep("300 millis").pipe(Effect.andThen(script.llm.converse(req))) })
      const agent = yield* makeAgent.pipe(Effect.provideService(Llm, slow))

      // The request fiber is interrupted, as when the browser closes the connection.
      const fiber = yield* Effect.forkChild(agent.chat({ ruleId: rule.id, message: "Still there?" }))
      yield* Effect.sleep("100 millis")
      yield* Fiber.interrupt(fiber)
      const run = yield* sql<{ readonly status: string; readonly outcome: string; readonly finalText: string }>`
        SELECT status, outcome, final_text FROM agent_runs WHERE rule_id = ${rule.id}`
      expect(run).toEqual([{ status: "done", outcome: "answered", finalText: "Here is your answer." }])
    }))

  it.effect("fails cleanly without an API key, for an unknown watch, and for an empty message", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const agent = yield* Agent
      const sql = yield* SqlClient
      const l = yield* take(clean, "clean")
      const rule = broadRule(l, l.price.amountMinor)
      yield* rules.insert({ rule, softEmbedding: null })
      const result = yield* agent.chat({ ruleId: rule.id, message: "Is this a fair price?" })
      expect(result).toMatchObject({ status: "failed", outcome: "llm_not_configured", modelCalls: 0, finalText: "" })
      const run = yield* sql<{ readonly question: string; readonly status: string }>`
        SELECT question, status FROM agent_runs WHERE id = ${result.runId}`
      expect(run[0]).toEqual({ question: "Is this a fair price?", status: "failed" })
      expect((yield* agent.chat({ ruleId: "NO-SUCH-RULE", message: "hi" })).outcome).toBe("no_such_rule")
      expect((yield* agent.chat({ ruleId: rule.id, message: "   " })).outcome).toBe("empty_message")
    }))
})
