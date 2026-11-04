/**
 * Runs against a real Postgres with pgvector (docker compose locally, a
 * service container in CI), in a throwaway schema, with the hash embedder so
 * no model is downloaded.
 */
import { passesHardChecks, type HardCriteria, type ListingView, type RedFlag, type TrapKind } from "@slabwatch/domain"
import { cards, generateSeed, makeRng, sellers, sets } from "@slabwatch/seed"
import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { migrate } from "../src/db/Database.ts"
import { BaseLive, ReposLive } from "../src/layers.ts"
import { redFlagsFor } from "../src/matcher/redFlags.ts"

const schema = `test_catalog_${process.pid}`
process.env["DB_SCHEMA"] = schema
process.env["EMBEDDER"] = "hash"
process.env["DATABASE_URL"] ??= "postgres://slabwatch:slabwatch@localhost:5432/slabwatch"

const seed = generateSeed()

const Seeded = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient
    yield* sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`
    yield* Effect.addFinalizer(() => sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`.pipe(Effect.ignore))
    yield* migrate
    const catalog = yield* CatalogRepo
    yield* catalog.insertCatalog(sellers)
    yield* catalog.insertSales(seed.sales)
    yield* catalog.insertListings(seed.listings)
  })
)

const TestLive = Seeded.pipe(Layer.provideMerge(ReposLive), Layer.provideMerge(BaseLive))

const randomRules = (n: number): ReadonlyArray<HardCriteria> => {
  const rng = makeRng(7)
  return Array.from({ length: n }, () => {
    const card = rng.chance(0.4) ? rng.pick(cards) : null
    const setId = card?.setId ?? (rng.chance(0.4) ? rng.pick(sets).id : null)
    return {
      setId,
      cardId: card?.id ?? null,
      edition: rng.pick(["any", "first", "unlimited"] as const),
      finish: rng.pick(["any", "holo", "non_holo", "reverse_holo"] as const),
      graders: rng.pick([[], ["NVG"], ["QSG", "LCA"]] as const),
      minGrade: rng.pick([1, 7, 8, 8.5, 9, 10]),
      maxPrice: {
        amountMinor: rng.int(1, 4000) * (rng.chance(0.1) ? 1 : 100),
        currency: rng.weighted([["USD", 8], ["EUR", 1], ["JPY", 1]] as const)
      }
    }
  })
}

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("catalog against Postgres", (it) => {
  it.effect("SQL hard filter returns exactly what the TypeScript checks accept", () =>
    Effect.gen(function* () {
      const catalog = yield* CatalogRepo
      const all: ReadonlyArray<ListingView> = yield* catalog.listActive(10_000)
      expect(all.length).toBe(seed.listings.length)
      let nonEmpty = 0
      for (const hard of randomRules(150)) {
        const fromSql = (yield* catalog.hardCandidates(hard)).map((l) => l.listingId).sort()
        const fromTs = all.filter((l) => passesHardChecks(hard, l)).map((l) => l.listingId).sort()
        expect(fromSql, JSON.stringify(hard)).toEqual(fromTs)
        if (fromSql.length > 0) nonEmpty++
      }
      // Guard against a test that passes because every rule matches nothing.
      expect(nonEmpty).toBeGreaterThan(30)
    }))

  it.effect("code red flags catch the seed's grade, price and duplicate traps", () =>
    Effect.gen(function* () {
      const catalog = yield* CatalogRepo
      const ids = seed.listings.map((l) => l.listing.id)
      const facts = new Map((yield* catalog.marketFacts(ids)).map((f) => [f.listingId, f]))
      const expected: Partial<Record<TrapKind, RedFlag>> = {
        grade_claim_mismatch: "grade_claim_mismatch",
        too_cheap: "price_far_below_market",
        duplicate_vault_item: "duplicate_vault_item"
      }
      let checked = 0
      for (const { listing, trap } of seed.listings) {
        const flag = expected[trap]
        const view = yield* catalog.getListing(listing.id)
        if (view === null) throw new Error(`missing ${listing.id}`)
        const flags = redFlagsFor(view, facts.get(listing.id))
        if (flag !== undefined) {
          expect(flags, `${listing.id} (${trap})`).toContain(flag)
          checked++
        } else if (trap === "none") {
          // A clean listing can share a vault item with a duplicate, but should not look cheap or misgraded.
          expect(flags.filter((f) => f !== "duplicate_vault_item"), listing.id).toEqual([])
        }
      }
      expect(checked).toBeGreaterThan(10)
    }))
})

