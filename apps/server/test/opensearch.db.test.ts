/**
 * The OpenSearch copy gives the same answers as Postgres. Needs a node at
 * OPENSEARCH_URL (CI starts one; locally: docker compose --profile opensearch
 * up -d); without it the file is skipped.
 */
import { sellers } from "@slabwatch/seed"
import { describe, expect, layer } from "@effect/vitest"
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { CardVectors } from "../src/search/CardVectors.ts"
import { OpenSearch, OpenSearchLive, trigrams } from "../src/search/opensearch/OpenSearch.ts"
import { SearchServiceOpenSearch } from "../src/search/opensearch/SearchServiceOpenSearch.ts"
import { SearchSync, SearchSyncLive } from "../src/search/opensearch/SearchSync.ts"
import { FIT_VERSION, fitKey, type MarketQuery, type MarketSort } from "../src/search/query.ts"
import { SearchService, SearchServicePg } from "../src/search/SearchService.ts"
import { seed, testLayer } from "./db.ts"

const enabled = (process.env["OPENSEARCH_URL"] ?? "") !== ""

/** Removes this file's indexes when it is done. */
const Cleanup = Layer.effectDiscard(
  Effect.gen(function* () {
    const os = yield* OpenSearch
    yield* Effect.addFinalizer(() =>
      Effect.forEach(Object.values(os.indexes), (alias) =>
        Effect.gen(function* () {
          const current = (yield* os.call("GET", `/_alias/${alias}`, undefined, { missingOk: true })) ?? {}
          for (const index of Object.keys(current)) yield* os.call("DELETE", `/${index}`)
        })
      ).pipe(Effect.ignore)
    )
  })
)

const TestLive = Cleanup.pipe(
  Layer.provideMerge(SearchSyncLive),
  Layer.provideMerge(OpenSearchLive),
  Layer.provideMerge(testLayer("opensearch", { SEARCH_ENGINE: "postgres" }))
)

const query = (over: Partial<MarketQuery> = {}): MarketQuery => ({
  set: null,
  grader: null,
  q: "",
  sort: null,
  from: "",
  fit: "",
  offset: 0,
  limit: 100,
  ...over
})

/** Both engines, built fresh so neither answers from numbers it cached before a change. */
const engines = Effect.gen(function* () {
  const pg = Context.get(yield* Layer.build(Layer.fresh(SearchServicePg)), SearchService)
  const os = Context.get(yield* Layer.build(Layer.fresh(SearchServiceOpenSearch)), SearchService)
  return { pg, os }
}).pipe(Effect.scoped)

type Search = (typeof SearchService)["Service"]

const plainSeller = sellers.find((s) => !s.handle.includes("_"))!
const underscoreSeller = sellers.find((s) => s.handle.includes("_"))!
const someCert = seed.listings.find((x) => x.listing.status === "active")!.vaultItem.certNumber

/** Every kind of search the market page makes, from search.db.test.ts, plus tags, misspellings and words nobody uses. */
const SEARCHES = [
  "",
  "ashen wyrm",
  "wyr",
  "holo",
  "reverse holo",
  "non-holo",
  "1st edition holo",
  "NVG 10",
  "dragon",
  "water holo",
  "emberfall 9+",
  "under 100",
  "dragon NVG under 500",
  "#010",
  "ef",
  `@${plainSeller.handle}`,
  underscoreSeller.handle,
  `${underscoreSeller.handle} holo`,
  someCert,
  "unlimited reverse 8 and up",
  "sea animal",
  "glowing sea creature holo",
  "flying fire 9+ under 300",
  "Ashen Wyrn NVG",
  "qqqxz",
  "@nobody_here"
]

const SORTS: ReadonlyArray<MarketSort | null> = [null, "recent", "price_asc", "price_desc", "grade", "relevance"]

const same = (pg: Search, os: Search, queries: ReadonlyArray<MarketQuery>) =>
  Effect.gen(function* () {
    for (const q of queries) expect(yield* os.search(q), JSON.stringify(q)).toEqual(yield* pg.search(q))
  })

const everyKind: ReadonlyArray<MarketQuery> = [
  ...SEARCHES.flatMap((q) => SORTS.map((sort) => query({ q, sort }))),
  ...SEARCHES.map((q) => query({ q, grader: "QSG" })),
  ...SEARCHES.map((q) => query({ q, set: "TW", sort: "relevance", from: "dragon that guards a frozen treasure" })),
  // Pages through both rounds of Best match, and through sorted results.
  ...[0, 5, 30, 45, 200].flatMap((offset) => [
    query({ q: "dragon", sort: "relevance", from: "a dragon of fire and ash", offset, limit: 5 }),
    query({ q: "holo", sort: "relevance", offset, limit: 7 }),
    query({ sort: "price_desc", offset, limit: 9 }),
    query({ set: "EF", sort: "grade", offset, limit: 9 })
  ]),
  query({ set: "NOPE" })
]

/** Each catalog word, the start of it, and a letter dropped from it. */
const wordProbes = (vocab: ReadonlyArray<string>) =>
  [...new Set(vocab.flatMap((t) => [t, t.slice(0, 3), t.slice(0, -2) + t.slice(-1), `${t}x`]))].filter((w) => w.length > 0)

const sameWords = (pg: Search, os: Search, words: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    expect(yield* os.knownWords(words)).toEqual(yield* pg.knownWords(words))
    expect(yield* os.closeWords(words, 3, 0.2)).toEqual(yield* pg.closeWords(words, 3, 0.2))
    expect(yield* os.closeWords(words, 1)).toEqual(yield* pg.closeWords(words, 1))
  })

describe.skipIf(!enabled)("market search on OpenSearch", () => {
  layer(TestLive, { timeout: "180 seconds", excludeTestServices: true })("OpenSearch", (it) => {
    it("makes trigrams the way pg_trgm does", () => {
      expect(trigrams("wyrm")).toEqual(["  w", " wy", "wyr", "yrm", "rm "])
      expect(trigrams("aaa")).toEqual(["  a", " aa", "aaa", "aa "])
    })

    it.effect("gives the same answers as Postgres for every kind of search", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const sync = yield* SearchSync
        yield* sql`UPDATE cards SET tags = '{dragon,fire}' WHERE kinds @> '{dragon}'`
        yield* sql`UPDATE cards SET tags = '{sea_creature,glows}' WHERE id IN ('TW-001', 'TW-004')`
        const run = yield* sync.copyAll
        expect(run.listings).toBe(seed.listings.filter((x) => x.listing.status === "active").length)
        expect(run.cards).toBe(40)

        // No card has a vector yet: Best match ranks them all alike, and orders them by their newest listing.
        let { pg, os } = yield* engines
        yield* same(pg, os, everyKind)

        // With vectors, by meaning. The copy picks them up from the outbox.
        yield* (yield* CardVectors).refresh(1000)
        expect(yield* sync.pending).toBeGreaterThanOrEqual(40)
        while ((yield* sync.applyChanges(25)) > 0) {}
        yield* sync.refresh
        ;({ pg, os } = yield* engines)
        yield* same(pg, os, everyKind)
        expect(yield* os.stats).toEqual(yield* pg.stats)

        // A description a model judged: only the cards it said fit match, on both, and both offer the same cards to judge.
        const fit = "guards a frozen treasure"
        yield* sql`
          INSERT INTO card_fits (concept, version, card_id, fits)
          SELECT ${fitKey(fit)}, ${FIT_VERSION}, id, number < '005' FROM cards WHERE kinds @> '{dragon}'`
        const judged = [query({ q: "dragon", fit }), query({ fit }), query({ q: "holo", fit, sort: "price_asc" })]
        yield* same(pg, os, judged)
        expect((yield* os.search(judged[0]!)).fit).toEqual({ phrase: fit, applied: true })
        expect(yield* os.fitCandidates(query({ q: "dragon", fit }), 50)).toEqual(yield* pg.fitCandidates(query({ q: "dragon", fit }), 50))

        const vocab = (yield* sql<{ readonly term: string }>`SELECT term FROM search_vocab`).map((r) => r.term)
        yield* sameWords(pg, os, wordProbes(vocab))
      }))

    it.effect("keeps the copy in step through the outbox, and records nothing once stopped", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient
        const sync = yield* SearchSync
        const catalog = yield* CatalogRepo
        yield* sync.copyAll
        expect(yield* sync.pending).toBe(0)

        const [sold, repriced] = seed.listings.filter((x) => x.listing.status === "active").map((x) => x.listing.id)
        yield* sql`UPDATE listings SET status = 'sold' WHERE id = ${sold!}`
        yield* sql`UPDATE listings SET price_minor = 100, currency = 'USD' WHERE id = ${repriced!}`
        const fresh = seed.listings[0]!
        yield* catalog.insertListings([
          {
            ...fresh,
            vaultItem: { ...fresh.vaultItem, id: "VLT-900001", certNumber: "QSG99990001" },
            listing: { ...fresh.listing, id: "G-900001", vaultItemId: "VLT-900001", source: "generator" as const }
          }
        ])
        // A new name is a new catalog word, new terms on every listing of the card, and a new card copy.
        yield* sql`UPDATE cards SET name = 'Zephyrquill Heron' WHERE id = ${fresh.vaultItem.cardId}`
        yield* sql`UPDATE cards SET tags = '{bird,flies}' WHERE id = ${fresh.vaultItem.cardId}`

        const changed = [
          query(),
          query({ q: "zephyrquill" }),
          query({ q: "bird", sort: "relevance" }),
          query({ q: "QSG99990001" }),
          query({ q: "under 1.00", sort: "price_asc" }),
          query({ sort: "price_desc", limit: 400 })
        ]
        let { pg, os } = yield* engines
        expect((yield* os.search(query({ q: "zephyrquill" }))).total).toBe(0)
        expect(yield* sync.pending).toBeGreaterThan(0)
        while ((yield* sync.applyChanges(3)) > 0) {}
        yield* sync.refresh
        ;({ pg, os } = yield* engines)
        expect((yield* os.search(query({ q: "zephyrquill" }))).total).toBeGreaterThan(0)
        yield* same(pg, os, changed)
        yield* sameWords(pg, os, ["zephyrquill", "zephyrquil", "zep"])

        yield* sync.stopRecording
        yield* sql`UPDATE listings SET status = 'withdrawn' WHERE id = 'G-900001'`
        expect(yield* sync.pending).toBe(0)
      }))
  })
})
