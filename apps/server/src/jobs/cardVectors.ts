import { Effect, Layer, Schedule } from "effect"
import { AppConfig } from "../config.ts"
import { CardVectors } from "../search/CardVectors.ts"

/** Cards per run. The local embedder does about a hundred a second, so a run stays short and a big catalog catches up over a few. */
const PER_RUN = 2000

/**
 * Keeps card search vectors current in the running server: new cards, and
 * cards whose text or tags changed (the tagger's work shows up here a minute
 * later). When nothing is queued a run is one indexed count. No model call.
 */
export const CardVectorsJobLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* AppConfig
    if (config.cardVectorsIntervalSeconds <= 0) return
    const vectors = yield* CardVectors
    const tick = Effect.gen(function* () {
      if ((yield* vectors.queued) === 0) return
      const run = yield* vectors.refresh(PER_RUN)
      yield* Effect.logInfo(`wrote search vectors for ${run.written} of ${run.cards} cards`)
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("card vectors run failed", cause)))
    yield* tick.pipe(Effect.repeat(Schedule.spaced(`${config.cardVectorsIntervalSeconds} seconds`)), Effect.forkScoped)
  })
)
