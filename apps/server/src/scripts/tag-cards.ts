import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"
import { CardTagger, CardTaggerLive, type TagRun } from "../tags/CardTagger.ts"
import { TAG_VOCAB_VERSION } from "../tags/vocabulary.ts"

/**
 * Tags every card that needs it, with the model, then reports what it did.
 * The running server does the same in the background, a few hundred cards at
 * a time; this is for loading a large catalog in one go, so it goes through
 * the Message Batches API at half the price. Batches usually finish within
 * minutes; TAG_NOW=1 makes ordinary calls instead, for a quick sample.
 *
 *   TAG_NOW=1 TAG_LIMIT=200 pnpm tags:run     a sample first, to check tags and cost
 *   pnpm tags:run                             every card that still needs tags
 *
 * Each call's tags are written as they come back, so it carries on where it
 * stopped. Spend counts toward LLM_DAILY_CAP_USD like every other model call.
 */

/** What the generator says each generated creature is (its first kind), and the tag that should say the same. */
const KIND_TAG: Record<string, string> = {
  dragon: "dragon",
  water: "sea_creature",
  beast: "mammal",
  bird: "bird",
  spirit: "spirit",
  golem: "golem",
  insect: "insect",
  plant: "plant",
  reptile: "reptile"
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`

const program = Effect.gen(function* () {
  const limit = Number.parseInt(process.env["TAG_LIMIT"] ?? "0", 10) || Number.POSITIVE_INFINITY
  const now = process.env["TAG_NOW"] === "1"
  yield* migrate
  const sql = yield* SqlClient
  const tagger = yield* CardTagger

  const queued = yield* tagger.queued
  yield* Effect.logInfo(`${queued} cards need tags (vocabulary version ${TAG_VOCAB_VERSION})`)
  const started = Date.now()
  let total: TagRun = { cards: 0, tagged: 0, calls: 0, failedCalls: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }
  while (total.cards < limit) {
    const take = Math.min(now ? 2000 : 20_000, limit - total.cards)
    const run = now ? yield* tagger.tagQueued({ limit: take, concurrency: 6 }) : yield* tagger.tagQueuedInBatches({ limit: take })
    if (run.cards === 0) break
    total = {
      cards: total.cards + run.cards,
      tagged: total.tagged + run.tagged,
      calls: total.calls + run.calls,
      failedCalls: total.failedCalls + run.failedCalls,
      inputTokens: total.inputTokens + run.inputTokens,
      outputTokens: total.outputTokens + run.outputTokens,
      costUsdMicros: total.costUsdMicros + run.costUsdMicros
    }
    yield* Effect.logInfo(`${total.tagged} cards tagged, ${total.calls} calls, ${usd(total.costUsdMicros)} so far`)
    // Nothing would tag: stop rather than ask again about the same cards.
    if (run.tagged === 0) break
  }
  const seconds = (Date.now() - started) / 1000
  yield* Effect.logInfo(
    `done: ${total.tagged} of ${total.cards} cards tagged in ${seconds.toFixed(0)} s, ${total.calls} calls (${total.failedCalls} failed), ` +
      `${total.inputTokens} tokens in, ${total.outputTokens} out, ${usd(total.costUsdMicros)}` +
      (total.tagged > 0 ? `, ${usd((1000 * total.costUsdMicros) / total.tagged)} per 1,000 cards` : "")
  )

  // How often each tag was given, and how well tags agree with what the generator knows about generated cards.
  const counts = yield* sql<{ readonly tag: string; readonly n: number }>`
    SELECT t AS tag, count(*)::int AS n FROM cards, unnest(tags) AS t
    WHERE tagged_version = ${TAG_VOCAB_VERSION} GROUP BY t ORDER BY n DESC, t`
  yield* Effect.logInfo(`tags given: ${counts.map((c) => `${c.tag} ${c.n}`).join(", ")}`)
  const agreement = yield* sql<{ readonly kind: string; readonly cards: number; readonly agreed: number }>`
    SELECT kinds[1] AS kind, count(*)::int AS cards,
           count(*) FILTER (WHERE (${JSON.stringify(KIND_TAG)}::jsonb ->> kinds[1]) = ANY(tags))::int AS agreed
    FROM cards WHERE id LIKE 'X%' AND tagged_version = ${TAG_VOCAB_VERSION}
    GROUP BY kinds[1] ORDER BY kinds[1]`
  if (agreement.length > 0) {
    const cards = agreement.reduce((n, a) => n + a.cards, 0)
    const agreed = agreement.reduce((n, a) => n + a.agreed, 0)
    yield* Effect.logInfo(
      `generated cards whose tags include what the generator made them: ${agreed} of ${cards} (${((100 * agreed) / cards).toFixed(1)}%); ` +
        agreement.map((a) => `${a.kind} as ${KIND_TAG[a.kind]} ${a.agreed}/${a.cards}`).join(", ")
    )
  }
})

program.pipe(
  Effect.provide(CardTaggerLive.pipe(Layer.provideMerge(ReposLive))),
  Effect.provide(LoggingLive),
  NodeRuntime.runMain
)
