import { generateListing, makeGeneratorState, type GeneratorState } from "@slabwatch/seed"
import { Effect, Layer, Schedule } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { AppConfig } from "../config.ts"

/** Generated listings beyond this many are withdrawn, oldest first, so the demo database stays small. */
export const MAX_ACTIVE_GENERATED = 150

/**
 * Lists one new random card, with the same trap odds as the seed, so watch
 * rules have something new to react to while the demo is open.
 */
export const listOne = Effect.fn("generator.listOne")(function* (state: GeneratorState) {
  const sql = yield* SqlClient
  const catalog = yield* CatalogRepo
  const item = generateListing(state, { prefix: "G", source: "generator", listedMinutesAgo: 0 })
  yield* catalog.insertListings([item])
  yield* sql`
    UPDATE listings SET status = 'withdrawn'
    WHERE source = 'generator' AND status = 'active'
      AND id NOT IN (SELECT id FROM listings WHERE source = 'generator' AND status = 'active'
                     ORDER BY listed_at DESC LIMIT ${MAX_ACTIVE_GENERATED})`
  yield* Effect.annotateCurrentSpan({ "listing.id": item.listing.id })
  yield* Effect.logInfo(`listed ${item.listing.id}: ${item.listing.title}`)
  return item
})

/**
 * Starts after the highest vault item number in the database. The generator
 * moves its vault and listing counters together, so new ids never collide
 * with earlier runs.
 */
export const makeState = Effect.gen(function* () {
  const sql = yield* SqlClient
  const rows = yield* sql<{ readonly next: number }>`
    SELECT coalesce(max(substring(id from 5)::int), 0) + 1 AS next FROM vault_items`
  return makeGeneratorState(Date.now() % 2_147_483_647, rows[0]?.next ?? 1)
})

/** Runs in the background for the life of the server. GENERATOR_INTERVAL_SECONDS=0 turns it off. */
export const GeneratorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const { generatorIntervalSeconds } = yield* AppConfig
    if (generatorIntervalSeconds <= 0) return
    const state = yield* makeState
    yield* listOne(state).pipe(
      Effect.catchCause((cause) => Effect.logWarning("generator tick failed", cause)),
      Effect.repeat(Schedule.spaced(`${generatorIntervalSeconds} seconds`)),
      Effect.forkScoped
    )
  })
)
