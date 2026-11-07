import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"
import { CardVectors, CardVectorsLive } from "../search/CardVectors.ts"

/**
 * Writes a search vector for every card that needs one, with the local
 * embedder, and reports the rate. The running server does the same in the
 * background; this is for loading a large catalog in one go. No model call
 * and no cost. Run it after tagging, since tags are part of the text.
 *
 *   pnpm vectors:run
 */
const program = Effect.gen(function* () {
  yield* migrate
  const vectors = yield* CardVectors
  const queued = yield* vectors.queued
  yield* Effect.logInfo(`${queued} cards need a search vector`)
  const started = Date.now()
  let written = 0
  while (true) {
    const run = yield* vectors.refresh(2000)
    written += run.written
    if (run.cards === 0 || run.written === 0) break
    const perSecond = Math.round(written / ((Date.now() - started) / 1000))
    yield* Effect.logInfo(`${written} of ${queued} vectors written (${perSecond} a second)`)
  }
  yield* Effect.logInfo(`done: ${written} vectors in ${Math.round((Date.now() - started) / 1000)} s`)
})

program.pipe(Effect.provide(CardVectorsLive.pipe(Layer.provideMerge(ReposLive))), Effect.provide(LoggingLive), NodeRuntime.runMain)
