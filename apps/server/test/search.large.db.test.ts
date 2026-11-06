import { generateBulkListings, generateLargeCatalog, generateSellers, toUsdCents, type CardSpec, type Catalog } from "@slabwatch/seed"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Embedder } from "../src/embeddings/Embedder.ts"
import { makeState } from "../src/jobs/generator.ts"
import { searchWords, type MarketQuery } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { seed, testLayer } from "./db.ts"

const TestLive = testLayer("searchlarge")

const query = (over: Partial<MarketQuery> = {}): MarketQuery => ({
  set: null,
  grader: null,
  q: "",
  sort: "recent",
  offset: 0,
  limit: 100,
  ...over
})

/** The words a card is found by, as migration 0005 indexes them. */
const cardWords = (c: CardSpec, cat: Catalog) => {
  const set = cat.setById(c.setId)
  return [...searchWords(c.name), ...c.kinds, ...searchWords(set.name), set.code.toLowerCase()]
}

// A small slice of the large catalog: the same code path as a million listings, fast enough for CI.
const catalog = generateLargeCatalog({ sets: 3, cardsPerSet: 30 })
const sellers = generateSellers(40)
const bulk = [...generateBulkListings({ count: 12_000, chunk: 4000, catalog, sellers })]

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("the large test market", (it) => {
  it.effect("loads in bulk and searches like the seed", () =>
    Effect.gen(function* () {
      const repo = yield* CatalogRepo
      const search = yield* SearchService
      yield* repo.insertCatalog(sellers, catalog)
      for (const rows of bulk) yield* repo.insertBulkListings(rows, new Date())
      const listings = bulk.flat()
      const active = seed.listings.length + listings.length

      // Generated sets become tabs after the hand-written four, in catalog order.
      const all = yield* search.search(query())
      expect(all.total).toBe(active)
      expect(all.stats.setCount).toBe(7)
      expect(all.sets.slice(0, 4).map((s) => s.id)).toEqual(["OS", "TW", "EF", "SE"])
      expect(all.sets.slice(4).map((s) => s.id).sort()).toEqual(["X001", "X002", "X003"])
      const x2 = catalog.setById("X002")
      expect(all.sets.find((s) => s.id === "X002")?.name).toBe(x2.name)

      // A generated card's full name finds its listings and nothing whose words do not start that way.
      const card = catalog.cards.find((c) => c.setId === "X002")!
      const named = yield* search.search(query({ q: card.name, limit: 100 }))
      const expected = listings.filter((x) => {
        const own = cardWords(catalog.cardById(x.vaultItem.cardId), catalog)
        return searchWords(card.name).every((w) => own.some((o) => o.startsWith(w)))
      })
      expect(named.total).toBeGreaterThan(0)
      expect(named.total).toBe(expected.length)

      // A set filter on a generated set, and its name as words.
      const bySet = yield* search.search(query({ set: "X002" }))
      expect(bySet.total).toBe(listings.filter((x) => x.vaultItem.cardId.startsWith("X002-")).length)
      expect((yield* search.search(query({ q: x2.name }))).counts.sets["X002"]).toBe(bySet.total)
    }))

  it.effect("counts exactly up to 10,000 matches, then says so", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      // Nearly every listing costs less than 100,000 dUSD: far past the cap.
      const broad = yield* search.search(query({ q: "under 100000" }))
      expect(broad).toMatchObject({ exact: false, total: 10_000, counts: { all: 10_000, sets: {} } })
      expect(broad.ids.length).toBe(100)
      expect(broad.sets.length).toBe(7)
      // One set under the cap still gets its exact number.
      const listings = [...seed.listings, ...bulk.flat()]
      const inX001 = listings.filter(
        (x) => x.vaultItem.cardId.startsWith("X001-") && toUsdCents(x.listing.priceMinor, x.listing.currency) <= 10_000_000
      ).length
      const one = yield* search.search(query({ q: "under 100000", set: "X001" }))
      expect(one.exact).toBe(false)
      expect(one.total).toBe(inX001)
      // A narrow search is exact as before.
      const narrow = yield* search.search(query({ q: "NVG 10" }))
      expect(narrow.exact).toBe(true)
      expect(narrow.counts.all).toBe(Object.values(narrow.counts.sets).reduce((a, b) => a + b, 0))
    }))

  it.effect("keeps bulk ids out of the generator's way and out of meaning search", () =>
    Effect.gen(function* () {
      const repo = yield* CatalogRepo
      const embedder = yield* Embedder
      // Bulk vault items are VLB-; the generator still counts on from the seed's VLT- numbers.
      const state = yield* makeState
      expect(state.vaultCounter).toBeLessThan(1000)
      expect(bulk[0]![0]!.vaultItem.id).toMatch(/^VLB-/)
      // Bulk listings have no vector; ranking by meaning skips them instead of putting them first.
      const [vector] = yield* embedder.embed(["sea creature"], "query")
      const ranked = yield* repo.search({}, vector!, 20)
      expect(ranked.length).toBe(20)
      expect(ranked.every((r) => r.similarity !== null && !r.listing.listingId.startsWith("B-"))).toBe(true)
    }))
})
