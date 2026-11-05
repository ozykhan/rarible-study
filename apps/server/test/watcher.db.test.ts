import { generateListing, type LabelledListing } from "@slabwatch/seed"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Agent, makeAgent } from "../src/agent/Agent.ts"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { makeState } from "../src/jobs/generator.ts"
import { pipelineV2 } from "../src/matcher/Matcher.ts"
import { watchOnce } from "../src/jobs/watcher.ts"
import { Llm } from "../src/llm/Llm.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { testLayer } from "./db.ts"
import { ruleFor } from "./rules.ts"
import { scriptedLlm } from "./scriptedLlm.ts"

const TestLive = testLayer("watcher")

/** Lists a new trap-free USD card now, the way the generator would. */
const listClean = Effect.gen(function* () {
  const catalog = yield* CatalogRepo
  const state = yield* makeState
  let item: LabelledListing
  do item = generateListing(state, { prefix: "W", source: "generator", listedMinutesAgo: 0 })
  while (item.trap !== "none" || item.listing.currency !== "USD")
  yield* catalog.insertListings([item])
  const view = yield* catalog.getListing(item.listing.id)
  if (view === null) throw new Error("listing did not save")
  return view
})

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("watcher", (it) => {
  it.effect("matches only new listings, saves decisions, and starts runs only when asked", () =>
    Effect.gen(function* () {
      const rules = yield* RuleRepo
      const sql = yield* SqlClient
      const watch = (startAgents: boolean, agent: Agent["Service"], judge: "always" | "soft_only" = "always") =>
        watchOnce({ startAgents, maxRunsPerTick: 3, pipeline: { ...pipelineV2, judge } }).pipe(Effect.provideService(Agent, agent))
      const idle = yield* Agent
      const verdictOf = (ruleId: string, listingId: string) =>
        sql<{ readonly verdict: string; readonly reasons: ReadonlyArray<string> }>`
          SELECT verdict, reasons FROM match_decisions WHERE rule_id = ${ruleId} AND listing_id = ${listingId} AND pipeline_version = 'v2'`

      // The first pass only sets the cursor, so the seed does not wake anyone.
      expect(yield* watch(false, idle)).toMatchObject({ listings: [], matches: [] })

      // No API key here, so the judge is out of reach: code decides, and caps the verdict.
      const first = yield* listClean
      const rule = ruleFor(first)
      yield* rules.insert({ rule, softEmbedding: null })
      const tick = yield* watch(true, idle)
      expect(tick.listings).toEqual([first.listingId])
      expect(tick.unjudged).toContainEqual({ ruleId: rule.id, reason: "no model API key is configured" })
      expect(tick.matches).toEqual([])
      expect(tick.runs).toEqual([])
      const capped = yield* verdictOf(rule.id, first.listingId)
      expect(capped[0]?.verdict).toBe("needs_review")
      expect(capped[0]?.reasons[0]).toMatch(/judge unavailable/)

      // Nothing new, nothing to do.
      expect((yield* watch(false, idle)).listings).toEqual([])

      const second = yield* listClean
      const rule2 = ruleFor(second)
      yield* rules.insert({ rule: rule2, softEmbedding: null })
      const script = scriptedLlm([
        () => [{ name: "get_listing", input: { listing_id: second.listingId } }],
        () => "Checked it; leaving the decision for later."
      ])
      const agent = yield* makeAgent.pipe(Effect.provideService(Llm, script.llm))
      // A rule without a soft part needs no judge under soft_only, so this one matches.
      const withAgent = yield* watch(true, agent, "soft_only")
      expect(withAgent.matches).toContainEqual({ ruleId: rule2.id, listingId: second.listingId })
      expect((yield* verdictOf(rule2.id, second.listingId))[0]?.verdict).toBe("match")
      const run = withAgent.runs.find((r) => r.purchases.length === 0 && r.modelCalls === 2)
      expect(run).toMatchObject({ status: "done", outcome: "no_purchase" })
      const stored = yield* sql<{ readonly trigger: string; readonly listingId: string }>`
        SELECT trigger, listing_id FROM agent_runs WHERE id = ${run?.runId ?? ""}`
      expect(stored).toEqual([{ trigger: "new_match", listingId: second.listingId }])
    }))
})
