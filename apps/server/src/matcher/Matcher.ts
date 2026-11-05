import {
  hardChecks,
  JudgeResult,
  type ListingView,
  type MatchDecision,
  type Verdict
} from "@slabwatch/domain"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { Llm, type LlmNotConfigured, type SpendCapReached } from "../llm/Llm.ts"
import type { StoredRule } from "../rules/RuleRepo.ts"
import { JUDGE_SYSTEM, judgePrompt } from "./judge.ts"
import { describeFlag, redFlagsFor } from "./redFlags.ts"

/** The knobs that differ between pipeline versions. Evals compare versions. */
export interface PipelineOptions {
  readonly version: string
  /** Embed-and-compare against seller text, or against our own catalog text. */
  readonly similarityAgainst: "listing" | "card"
  /** Soft rules: candidates under this cosine similarity are rejected before the judge. */
  readonly similarityFloor: number
  /** Soft rules: at most this many candidates, best first, go to the judge. */
  readonly maxJudged: number
  /**
   * What a code red flag does. "warn" passes it to the judge as a warning;
   * "review" caps the verdict at needs_review, so no model can match past it;
   * "reject" drops the listing before the judge.
   */
  readonly redFlags: "warn" | "review" | "reject"
  readonly judge: "always" | "soft_only" | "never"
}

export const pipelineV1: PipelineOptions = {
  version: "v1",
  similarityAgainst: "listing",
  similarityFloor: 0.3,
  maxJudged: 20,
  redFlags: "warn",
  judge: "always"
}

/**
 * v2 changes one thing. In v1, four of the five wrong decisions were listings
 * that code had flagged (a duplicate vault item, a price far below recent
 * sales) and the judge matched anyway. Now a red flag caps the verdict at
 * needs_review: the collector still sees the listing, but no model can turn
 * it into a match, and an agent cannot auto-buy it.
 */
export const pipelineV2: PipelineOptions = { ...pipelineV1, version: "v2", redFlags: "review" }

export class Matcher extends Context.Service<
  Matcher,
  {
    /**
     * Decisions for every listing that passes the rule's hard criteria.
     * Listings that fail them never reach later stages; `explain` gives the
     * field-by-field reasons for any listing.
     */
    readonly evaluate: (
      stored: StoredRule,
      options: PipelineOptions,
      only?: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyArray<MatchDecision>, SqlError | SpendCapReached | LlmNotConfigured>
    readonly explain: (stored: StoredRule, listing: ListingView, version: string) => MatchDecision
  }
>()("slabwatch/Matcher") {}

const ORDER: Record<Verdict, number> = { reject: 0, needs_review: 1, match: 2 }
/** The judge can only make a verdict stricter, never more permissive. */
const stricter = (a: Verdict, b: Verdict): Verdict => (ORDER[a] <= ORDER[b] ? a : b)

export const MatcherLive = Layer.effect(
  Matcher,
  Effect.gen(function* () {
    const repo = yield* CatalogRepo
    const llm = yield* Llm

    const explain = (stored: StoredRule, l: ListingView, version: string): MatchDecision => {
      const checks = hardChecks(stored.rule.hard, l)
      const failed = checks.filter((c) => !c.pass)
      return {
        ruleId: stored.rule.id,
        listingId: l.listingId,
        pipelineVersion: version,
        verdict: failed.length === 0 ? "match" : "reject",
        decidedAt: "hard_filter",
        fieldChecks: checks,
        redFlags: [],
        similarity: null,
        judge: null,
        reasons: failed.map((c) => `${c.field}: wanted ${c.expected}, listing has ${c.actual}`)
      }
    }

    const evaluate = Effect.fn("Matcher.evaluate")(function* (
      stored: StoredRule,
      options: PipelineOptions,
      only?: ReadonlyArray<string>
    ) {
      const { rule } = stored
      yield* Effect.annotateCurrentSpan({ "rule.id": rule.id, "pipeline.version": options.version })

      // Stage 1: hard filter in SQL.
      const all = yield* repo.hardCandidates(rule.hard)
      const candidates = only ? all.filter((l) => only.includes(l.listingId)) : all
      const ids = candidates.map((l) => l.listingId)

      // Stage 2: red flags from code, with the facts computed in SQL.
      const facts = new Map((yield* repo.marketFacts(ids)).map((f) => [f.listingId, f]))
      const cardFacts = new Map(
        (yield* repo.cardFacts([...new Set(candidates.map((l) => l.cardId))])).map((c) => [c.cardId, c])
      )

      // Stage 3: similarity, for rules with a soft part.
      const soft = rule.softDescription !== null && stored.softEmbedding !== null
      const sims =
        soft && stored.softEmbedding !== null
          ? yield* repo.similarities(stored.softEmbedding, ids, options.similarityAgainst)
          : new Map<string, number>()
      const ranked = soft
        ? [...candidates].sort((a, b) => (sims.get(b.listingId) ?? 0) - (sims.get(a.listingId) ?? 0))
        : candidates

      const decide = (l: ListingView, rank: number) =>
        Effect.gen(function* () {
          const fieldChecks = hardChecks(rule.hard, l)
          const redFlags = redFlagsFor(l, facts.get(l.listingId))
          const similarity = soft ? (sims.get(l.listingId) ?? 0) : null
          const base = {
            ruleId: rule.id,
            listingId: l.listingId,
            pipelineVersion: options.version,
            fieldChecks,
            redFlags,
            similarity
          }
          const flagReasons = redFlags.map((f) => `warning: ${describeFlag[f]}`)

          // SQL and code must agree. If they ever do not, fail safe.
          if (fieldChecks.some((c) => !c.pass)) {
            return { ...base, verdict: "reject", decidedAt: "hard_filter", judge: null, reasons: ["field checks failed"] } satisfies MatchDecision
          }
          if (options.redFlags === "reject" && redFlags.length > 0) {
            return { ...base, verdict: "reject", decidedAt: "red_flags", judge: null, reasons: flagReasons } satisfies MatchDecision
          }
          if (similarity !== null && (similarity < options.similarityFloor || rank >= options.maxJudged)) {
            return {
              ...base,
              verdict: "reject",
              decidedAt: "similarity",
              judge: null,
              reasons: [`not similar enough to "${rule.softDescription}" (${similarity.toFixed(2)})`]
            } satisfies MatchDecision
          }
          const useJudge = options.judge === "always" || (options.judge === "soft_only" && soft)
          const flagCap: Verdict = options.redFlags === "review" && redFlags.length > 0 ? "needs_review" : "match"
          if (!useJudge) {
            return { ...base, verdict: flagCap, decidedAt: "hard_filter", judge: null, reasons: ["all fields match", ...flagReasons] } satisfies MatchDecision
          }

          // Stage 4: the judge, only for what code cannot check.
          const judged = yield* llm
            .structured({
              purpose: "judge",
              system: JUDGE_SYSTEM,
              user: judgePrompt(rule, l, cardFacts.get(l.cardId), redFlags),
              schema: JudgeResult,
              maxTokens: 1024
            })
            .pipe(
              Effect.map((r) => r.value),
              Effect.catchTag("LlmError", (e) => Effect.succeed({ error: e.message } as const))
            )
          if ("error" in judged) {
            return {
              ...base,
              verdict: "needs_review",
              decidedAt: "judge",
              judge: null,
              reasons: [`judge unavailable: ${judged.error}`, ...flagReasons]
            } satisfies MatchDecision
          }
          let verdict: Verdict = stricter(flagCap, judged.verdict)
          if (soft && judged.softMatch === false) verdict = "reject"
          return {
            ...base,
            verdict,
            decidedAt: "judge",
            judge: judged,
            reasons: [...judged.reasons, ...flagReasons]
          } satisfies MatchDecision
        })

      return yield* Effect.forEach(ranked, decide, { concurrency: 4 })
    })

    return Matcher.of({ evaluate, explain })
  })
)
