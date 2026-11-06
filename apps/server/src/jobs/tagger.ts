import { Effect, Layer, Schedule } from "effect"
import { AppConfig } from "../config.ts"
import { CardTagger } from "../tags/CardTagger.ts"

/** Cards per run: a few model calls, so a catalog that grows by thousands catches up over a few runs instead of in one burst. */
const PER_RUN = 400

/**
 * Keeps card tags current in the running server: new cards, cards whose text
 * changed, and every card after the vocabulary version moves. When nothing
 * is queued a run is one indexed count and no model call. Without a model
 * key it stays off, and search works on names alone.
 */
export const TaggerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* AppConfig
    if (config.taggerIntervalSeconds <= 0) return
    if (config.anthropicApiKey === null) {
      yield* Effect.logInfo("card tagger off: no model API key, so search matches names and kinds only")
      return
    }
    const tagger = yield* CardTagger
    const tick = Effect.gen(function* () {
      if ((yield* tagger.queued) === 0) return
      const run = yield* tagger.tagQueued({ limit: PER_RUN })
      yield* Effect.logInfo(
        `tagged ${run.tagged} of ${run.cards} cards in ${run.calls} model calls ($${(run.costUsdMicros / 1_000_000).toFixed(4)})`
      )
    }).pipe(
      Effect.catchTag("SpendCapReached", (e) =>
        Effect.logWarning(`card tagger paused: the daily model spend cap of $${e.capUsd} is reached`)
      ),
      Effect.catchCause((cause) => Effect.logWarning("card tagger run failed", cause))
    )
    yield* tick.pipe(Effect.repeat(Schedule.spaced(`${config.taggerIntervalSeconds} seconds`)), Effect.forkScoped)
  })
)
