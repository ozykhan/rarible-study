import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { toVector } from "../src/db/Database.ts"
import { Embedder } from "../src/embeddings/Embedder.ts"
import { CardVectors, cardSearchText } from "../src/search/CardVectors.ts"
import { describedWords, type MarketQuery } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { testLayer } from "./db.ts"

const TestLive = testLayer("ranking")

const query = (over: Partial<MarketQuery> = {}): MarketQuery => ({
  set: null,
  grader: null,
  q: "",
  sort: null,
  from: "",
  offset: 0,
  limit: 100,
  ...over
})

layer(TestLive, { timeout: "60 seconds" })("best match", (it) => {
  it.effect("writes a vector per card from its catalog text and tags, and again when they change", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const vectors = yield* CardVectors
      expect(yield* vectors.queued).toBe(40)
      expect(yield* vectors.refresh(1000)).toEqual({ cards: 40, written: 40 })
      expect(yield* vectors.queued).toBe(0)

      const before = (yield* sql<{ readonly v: string }>`SELECT search_vector::text AS v FROM cards WHERE id = 'TW-001'`)[0]!.v
      yield* sql`UPDATE cards SET tags = '{sea_creature,glows}' WHERE id = 'TW-001'`
      // Retagging with the same tags queues nothing.
      yield* sql`UPDATE cards SET tags = '{sea_creature,glows}' WHERE id = 'TW-001'`
      yield* sql`UPDATE cards SET name = name WHERE id = 'TW-002'`
      expect(yield* vectors.queued).toBe(1)
      expect(yield* vectors.refresh(1000)).toEqual({ cards: 1, written: 1 })
      const after = (yield* sql<{ readonly v: string }>`SELECT search_vector::text AS v FROM cards WHERE id = 'TW-001'`)[0]!.v
      expect(after).not.toBe(before)

      expect(cardSearchText("Tidewild #001 Glimmerfin.", ["sea_creature", "glows"])).toBe(
        "Tidewild #001 Glimmerfin. Described as: sea creatures, glowing."
      )
      expect(cardSearchText("Tidewild #001 Glimmerfin.", [])).toBe("Tidewild #001 Glimmerfin.")
    }))

  it.effect("orders a described search by meaning by default, one listing per card first", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      const embedder = yield* Embedder
      yield* sql`UPDATE cards SET tags = '{dragon}' WHERE kinds @> '{dragon}'`
      yield* (yield* CardVectors).refresh(1000)

      const q = "dragon"
      const from = "dragon that guards a frozen treasure"
      const found = yield* search.search(query({ q, from }))
      expect(found.sort).toBe("relevance")
      expect(found.total).toBeGreaterThan(10)

      // The order is the definition: each card's newest listing, then the rest, by card distance, then newest first.
      const [vector] = yield* embedder.embed([describedWords(from).join(" ")], "query")
      const definition = yield* sql<{ readonly listingId: string; readonly cardId: string }>`
        SELECT ls.listing_id, ls.card_id FROM listing_search ls JOIN cards c ON c.id = ls.card_id
        WHERE ls.terms @@ '(''#dragon'' | ''dragon'':*)'::tsquery
        ORDER BY row_number() OVER (PARTITION BY ls.card_id ORDER BY ls.listed_at DESC, ls.listing_id) > 1,
                 c.search_vector <=> ${toVector(vector!)}::vector, ls.listed_at DESC, ls.listing_id`
      expect(found.ids).toEqual(definition.map((d) => d.listingId))
      const cards = new Set(definition.map((d) => d.cardId)).size
      expect(new Set(definition.slice(0, cards).map((d) => d.cardId)).size).toBe(cards)

      // The same order a page at a time.
      const pages: Array<string> = []
      for (let offset = 0; offset < found.total; offset += 7) {
        pages.push(...(yield* search.search(query({ q, from, offset, limit: 7 }))).ids)
      }
      expect(pages).toEqual(found.ids)

      // Without ?from the search's own words rank; the filter decides what matches either way.
      const own = yield* search.search(query({ q }))
      expect(own.sort).toBe("relevance")
      expect([...own.ids].sort()).toEqual([...found.ids].sort())
    }))

  it.effect("keeps newest first for names, and falls back to it when there is nothing to rank by", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      expect((yield* search.search(query({ q: "ashen wyrm" }))).sort).toBe("recent")
      expect((yield* search.search(query({ q: "nvg 10" }))).sort).toBe("recent")
      // Asked for: a name search ranks by its words too.
      expect((yield* search.search(query({ q: "wyrm", sort: "relevance" }))).sort).toBe("relevance")
      // Nothing describes a card: newest first, whatever was asked.
      const holo = yield* search.search(query({ q: "holo", sort: "relevance" }))
      expect(holo.sort).toBe("recent")
      expect(holo.ids).toEqual((yield* search.search(query({ q: "holo", sort: "recent" }))).ids)
      expect((yield* search.search(query({ sort: "relevance" }))).sort).toBe("recent")
      // Picking another order keeps it.
      expect((yield* search.search(query({ q: "dragon", sort: "price_asc" }))).sort).toBe("price_asc")
    }))
})
