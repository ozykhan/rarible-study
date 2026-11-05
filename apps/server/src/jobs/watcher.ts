import { Effect, Layer, Schedule } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Agent, type AgentRunResult } from "../agent/Agent.ts"
import { AppConfig } from "../config.ts"
import type { MatchDecision } from "@slabwatch/domain"
import { Matcher, pipelineV2, type PipelineOptions } from "../matcher/Matcher.ts"
import { RuleRepo, type StoredRule } from "../rules/RuleRepo.ts"

const CURSOR = "watcher"

export interface WatchOptions {
  /** Start an agent run for each match. Off unless AGENT_ENABLED=true. */
  readonly startAgents: boolean
  /** At most this many agent runs per tick, so a burst of listings cannot run up the model bill. */
  readonly maxRunsPerTick: number
  /** At most this many new listings per tick; the rest wait for the next one. */
  readonly batch?: number
  /** Defaults to v2, the version the evals picked. */
  readonly pipeline?: PipelineOptions
}

export interface WatchTick {
  readonly listings: ReadonlyArray<string>
  readonly matches: ReadonlyArray<{ readonly ruleId: string; readonly listingId: string }>
  readonly runs: ReadonlyArray<AgentRunResult>
  /** Rules decided without the judge, because the model was out of reach. */
  readonly unjudged: ReadonlyArray<{ readonly ruleId: string; readonly reason: string }>
}

/**
 * Without the judge, code still checks fields and red flags, but nothing it
 * passes becomes a match: the judge reads things code cannot, so these wait
 * for the collector as needs_review and never start an agent run.
 */
const capUnjudged = (decisions: ReadonlyArray<MatchDecision>, reason: string): ReadonlyArray<MatchDecision> =>
  decisions.map((d) =>
    d.verdict === "match" ? { ...d, verdict: "needs_review", reasons: [`judge unavailable: ${reason}`, ...d.reasons] } : d
  )

/**
 * The matcher, falling back to code-only checks when the model is out of
 * reach (spend cap, no key). Used by the watcher and when a rule is created.
 */
export const evaluateWithFallback = (
  matcher: Matcher["Service"],
  stored: StoredRule,
  pipeline: PipelineOptions,
  only?: ReadonlyArray<string>
) => {
  const withoutJudge = (reason: string) =>
    matcher
      .evaluate(stored, { ...pipeline, judge: "never" }, only)
      .pipe(Effect.map((ds) => ({ decisions: capUnjudged(ds, reason), unjudgedReason: reason as string | null })))
  return matcher.evaluate(stored, pipeline, only).pipe(
    Effect.map((decisions) => ({ decisions, unjudgedReason: null as string | null })),
    Effect.catchTags({
      SpendCapReached: () => withoutJudge("the daily model spend cap is reached"),
      LlmNotConfigured: () => withoutJudge("no model API key is configured")
    })
  )
}

/**
 * One pass: listings that arrived since the last pass, every active rule
 * through the v2 matcher on just those listings, decisions saved, and an
 * agent run for each match. The cursor starts at the first pass, so a fresh
 * server does not wake the agent for the whole seed.
 */
export const watchOnce = Effect.fn("watcher.tick")(function* (options: WatchOptions) {
  const sql = yield* SqlClient
  const rules = yield* RuleRepo
  const matcher = yield* Matcher
  const agent = yield* Agent

  // Timestamps stay in SQL: Postgres keeps microseconds, a JS Date would round them off.
  const started = yield* sql`INSERT INTO job_cursors (name, last_seen_at) VALUES (${CURSOR}, now()) ON CONFLICT (name) DO NOTHING RETURNING name`
  if (started.length > 0) return { listings: [], matches: [], runs: [], unjudged: [] } satisfies WatchTick
  const fresh = yield* sql<{ readonly id: string }>`
    SELECT id FROM listings
    WHERE status = 'active' AND listed_at > (SELECT last_seen_at FROM job_cursors WHERE name = ${CURSOR})
    ORDER BY listed_at, id LIMIT ${options.batch ?? 100}`
  if (fresh.length === 0) return { listings: [], matches: [], runs: [], unjudged: [] } satisfies WatchTick
  const ids = fresh.map((l) => l.id)
  yield* Effect.annotateCurrentSpan({ "watcher.listings": ids.length })

  const pipeline = options.pipeline ?? pipelineV2
  const matches: Array<{ ruleId: string; listingId: string }> = []
  const unjudged: Array<{ ruleId: string; reason: string }> = []
  for (const stored of yield* rules.listActive) {
    const { decisions, unjudgedReason } = yield* evaluateWithFallback(matcher, stored, pipeline, ids)
    if (unjudgedReason !== null) unjudged.push({ ruleId: stored.rule.id, reason: unjudgedReason })
    yield* rules.saveDecisions(decisions)
    for (const d of decisions) if (d.verdict === "match") matches.push({ ruleId: d.ruleId, listingId: d.listingId })
  }
  // Advance first: a listing is looked at once, even if a run below fails.
  yield* sql`
    UPDATE job_cursors SET last_seen_at = (SELECT max(listed_at) FROM listings WHERE id IN ${sql.in(ids)})
    WHERE name = ${CURSOR}`

  const runs: Array<AgentRunResult> = []
  if (options.startAgents) {
    for (const m of matches.slice(0, options.maxRunsPerTick)) {
      runs.push(yield* agent.run({ ruleId: m.ruleId, listingId: m.listingId, trigger: "new_match" }))
    }
  }
  for (const u of unjudged) yield* Effect.logWarning(`watcher decided rule ${u.ruleId} without the judge: ${u.reason}`)
  if (matches.length > 0) yield* Effect.logInfo(`watcher: ${matches.length} new matches, ${runs.length} agent runs`)
  return { listings: ids, matches, runs, unjudged } satisfies WatchTick
})

/** Runs every WATCHER_INTERVAL_SECONDS for the life of the server; 0 turns it off. */
export const WatcherLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* AppConfig
    if (config.watcherIntervalSeconds <= 0) return
    const options: WatchOptions = { startAgents: config.agentEnabled && !config.readOnly, maxRunsPerTick: 3 }
    yield* watchOnce(options).pipe(
      Effect.catchCause((cause) => Effect.logWarning("watcher tick failed", cause)),
      Effect.repeat(Schedule.spaced(`${config.watcherIntervalSeconds} seconds`)),
      Effect.forkScoped
    )
  })
)
