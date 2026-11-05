import { NodeRuntime } from "@effect/platform-node"
import { generateSeed, sellers } from "@slabwatch/seed"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"

/** Loads the fictional catalog, about 200 listings with traps, and the price history. Idempotent. */
const program = Effect.gen(function* () {
  yield* migrate
  const sql = yield* SqlClient
  const repo = yield* CatalogRepo
  const existing = yield* sql<{ n: number }>`SELECT count(*)::int AS n FROM listings WHERE source = 'seed'`
  if ((existing[0]?.n ?? 0) > 0) {
    yield* Effect.logInfo("seed data already present, nothing to do")
    return
  }
  const data = generateSeed()
  yield* repo.insertCatalog(sellers)
  yield* repo.insertSales(data.sales)
  yield* repo.insertListings(data.listings)
  yield* Effect.logInfo(`seeded ${data.listings.length} listings and ${data.sales.length} past sales`)
})

program.pipe(Effect.provide(ReposLive), NodeRuntime.runMain)
