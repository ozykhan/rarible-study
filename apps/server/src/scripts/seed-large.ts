import { NodeRuntime } from "@effect/platform-node"
import { generateBulkListings, generateLargeCatalog, generateSellers } from "@slabwatch/seed"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"

/**
 * Grows a local database to marketplace size for testing search: about
 * 20,000 cards in 204 sets, 2,012 sellers and, by default, a million active
 * listings. All fictional and deterministic. Run `pnpm db:seed` first.
 *
 *   BULK_LISTINGS=1000000 pnpm db:seed:large
 *
 * It picks up where it stopped if interrupted (each chunk of 5,000 is its own
 * transaction) and refuses to run on Railway: the public demo stays small.
 */
const CHUNK = 5000

const program = Effect.gen(function* () {
  if (process.env["RAILWAY_PROJECT_ID"] !== undefined) {
    return yield* Effect.fail(new Error("the large seed is for local databases only; the live demo stays small"))
  }
  const target = Number.parseInt(process.env["BULK_LISTINGS"] ?? "1000000", 10)
  if (!Number.isFinite(target) || target < 0) return yield* Effect.fail(new Error("BULK_LISTINGS must be a whole number"))

  yield* migrate
  const sql = yield* SqlClient
  const repo = yield* CatalogRepo
  const catalog = generateLargeCatalog()
  const sellers = generateSellers()

  yield* Effect.logInfo(`catalog: ${catalog.sets.length} sets, ${catalog.cards.length} cards, ${sellers.length} sellers`)
  yield* repo.insertCatalog(sellers, catalog)

  const [{ present = 0 } = {}] = yield* sql<{ readonly present: number }>`
    SELECT count(*)::int AS present FROM listings WHERE source = 'bulk'`
  const skip = Math.floor(present / CHUNK)
  if (present >= target) {
    yield* Effect.logInfo(`${present} bulk listings already present, nothing to do`)
    return
  }
  const now = new Date()
  const started = Date.now()
  let chunk = 0
  let written = skip * CHUNK
  // The generator is deterministic: chunks already written are generated again and skipped, so the rest match.
  for (const rows of generateBulkListings({ count: target, chunk: CHUNK, catalog, sellers })) {
    if (chunk++ < skip) continue
    yield* sql.withTransaction(repo.insertBulkListings(rows, now))
    written += rows.length
    if (chunk % 20 === 0 || written === target) {
      const perSecond = Math.round((written - skip * CHUNK) / ((Date.now() - started) / 1000))
      yield* Effect.logInfo(`${written} of ${target} bulk listings (${perSecond} a second)`)
    }
  }
  // Fresh statistics so the planner knows the tables grew a thousandfold.
  yield* sql`ANALYZE listings`
  yield* sql`ANALYZE vault_items`
  yield* sql`ANALYZE listing_search`
  yield* Effect.logInfo(`done in ${Math.round((Date.now() - started) / 1000)} s`)
})

program.pipe(Effect.provide(ReposLive), Effect.provide(LoggingLive), NodeRuntime.runMain)
