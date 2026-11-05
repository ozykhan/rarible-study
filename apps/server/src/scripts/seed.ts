import { NodeRuntime } from "@effect/platform-node"
import { generateSeed, sellers } from "@slabwatch/seed"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"

/**
 * Loads the fictional catalog, about 200 listings with traps, and the price
 * history. Safe to run again, and to run twice at once: a second deploy's
 * pre-deploy step can start while the first one's is still seeding.
 */
const program = Effect.gen(function* () {
  yield* migrate
  const sql = yield* SqlClient
  const repo = yield* CatalogRepo
  const data = generateSeed()
  const done = yield* sql.withTransaction(
    Effect.gen(function* () {
      // A concurrent seed waits here, then sees the first one's rows.
      yield* sql`SELECT pg_advisory_xact_lock(hashtext('slabwatch:seed'))`
      const rows = yield* sql<{ readonly listings: number; readonly sales: number }>`
        SELECT (SELECT count(*)::int FROM listings WHERE source = 'seed') AS listings,
               (SELECT count(*)::int FROM sales) AS sales`
      const listings = rows[0]?.listings ?? 0
      const sales = rows[0]?.sales ?? 0
      if (listings > 0 && sales === data.sales.length) return "present" as const
      // Only the seed writes sales and the seed is deterministic, so any other
      // count means an earlier run died part way or ran twice. Start them over.
      yield* sql`DELETE FROM sales`
      yield* repo.insertCatalog(sellers)
      yield* repo.insertSales(data.sales)
      if (listings === 0) yield* repo.insertListings(data.listings)
      return listings === 0 ? ("seeded" as const) : ("sales repaired" as const)
    })
  )
  if (done === "present") yield* Effect.logInfo("seed data already present, nothing to do")
  else if (done === "sales repaired") yield* Effect.logInfo(`found the wrong number of past sales; reloaded ${data.sales.length}`)
  else yield* Effect.logInfo(`seeded ${data.listings.length} listings and ${data.sales.length} past sales`)
})

program.pipe(Effect.provide(ReposLive), NodeRuntime.runMain)
