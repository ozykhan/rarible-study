import { NodeRuntime } from "@effect/platform-node"
import { artPath, generateSeed, handWritten, makeCatalog, sellers } from "@slabwatch/seed"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"

/**
 * Loads the fictional catalog and, for each catalog drop, about 200 listings
 * with traps and the price history. Safe to run again, and to run twice at
 * once: a second deploy's pre-deploy step can start while the first one's is
 * still seeding.
 *
 * A database seeded before a drop existed gets the new drop's cards, listings
 * and sales added next to what it has. Rows already there are never changed,
 * except each card's art path, which follows the art manifest.
 */
const program = Effect.gen(function* () {
  yield* migrate
  const sql = yield* SqlClient
  const repo = yield* CatalogRepo
  const data = generateSeed()
  const report = yield* sql.withTransaction(
    Effect.gen(function* () {
      // A concurrent seed waits here, then sees the first one's rows.
      yield* sql`SELECT pg_advisory_xact_lock(hashtext('slabwatch:seed'))`
      const lines: Array<string> = []

      const ids = handWritten.cards.map((c) => c.id)
      const present = new Set((yield* sql<{ readonly id: string }>`SELECT id FROM cards WHERE id IN ${sql.in(ids)}`).map((r) => r.id))
      const missing = handWritten.cards.filter((c) => !present.has(c.id))
      // Sets and sellers go in on conflict do nothing; only missing cards are embedded.
      yield* repo.insertCatalog(sellers, makeCatalog(handWritten.sets, missing))
      if (missing.length > 0) lines.push(`added ${missing.length} cards`)

      for (const d of data.drops) {
        const cardIds = d.drop.cards.map((c) => c.id)
        const rows = yield* sql<{ readonly listings: number; readonly sales: number }>`
          SELECT (SELECT count(*)::int FROM listings WHERE source = 'seed' AND id LIKE ${`${d.spec.listingPrefix}-%`}) AS listings,
                 (SELECT count(*)::int FROM sales WHERE card_id IN ${sql.in(cardIds)}) AS sales`
        const listings = rows[0]?.listings ?? 0
        const sales = rows[0]?.sales ?? 0
        // Only the seed writes sales and the seed is deterministic, so any other
        // count means an earlier run died part way or ran twice. Start them over.
        if (sales !== d.sales.length) {
          yield* sql`DELETE FROM sales WHERE card_id IN ${sql.in(cardIds)}`
          yield* repo.insertSales(d.sales)
          lines.push(`${d.drop.id}: ${sales === 0 ? "loaded" : "reloaded"} ${d.sales.length} past sales`)
        }
        if (listings === 0) {
          yield* repo.insertListings(d.listings)
          lines.push(`${d.drop.id}: seeded ${d.listings.length} listings`)
        }
      }

      const changed = yield* repo.setArtPaths(handWritten.cards.map((c) => ({ cardId: c.id, artPath: artPath(c.id) })))
      if (changed.length > 0) lines.push(`art changed for ${changed.length} cards`)
      return lines
    })
  )
  if (report.length === 0) yield* Effect.logInfo("seed data already present, nothing to do")
  for (const line of report) yield* Effect.logInfo(line)
})

program.pipe(Effect.provide(ReposLive), Effect.provide(LoggingLive), NodeRuntime.runMain)
