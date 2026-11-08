import { cardById, cards } from "@slabwatch/seed"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Llm, type BatchAnswer, type StructuredRequest, type Usage } from "../src/llm/Llm.ts"
import type { MarketQuery } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { CardTagger, makeCardTagger } from "../src/tags/CardTagger.ts"
import { TAG_VOCAB_VERSION } from "../src/tags/vocabulary.ts"
import { seed, testLayer } from "./db.ts"

const TestLive = testLayer("tags")

const query = (q: string): MarketQuery => ({ set: null, grader: null, q, sort: "recent", from: "", fit: "", offset: 0, limit: 100 })

const active = seed.listings.filter((x) => x.listing.status === "active")
const listingsOf = (pick: (cardId: string) => boolean) =>
  active.filter((x) => pick(x.vaultItem.cardId)).map((x) => x.listing.id).sort()

const usage: Usage = { inputTokens: 100, outputTokens: 50, costUsdMicros: 35, latencyMs: 1 }

/** The cards in a tagging prompt, from its "ID: text" lines. */
const cardsIn = (user: string) =>
  user
    .split("\n")
    .map((line) => /^([A-Z0-9-]+): (.*)$/.exec(line))
    .flatMap((m) => (m === null ? [] : [{ id: m[1]!, text: m[2]! }]))

/** A stand-in model: water cards are sea creatures, every card is an animal. It skips EF-001 and answers about a card nobody asked about. */
const answer = (user: string) => ({
  cards: [
    ...cardsIn(user)
      .filter((c) => c.id !== "EF-001")
      .map((c) => ({ id: c.id, tags: cardById(c.id).kinds.includes("water") ? ["sea_creature", "animal", "sea_creature"] : ["animal"] })),
    { id: "NOPE-001", tags: ["dragon"] }
  ]
})

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("card tags", (it) => {
  it.effect("tags join the card's search terms and every listing of it, and nothing else", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      const tagger = yield* CardTagger

      // Every card waits for tags; without a model key the tagger says so instead of guessing.
      expect(yield* tagger.queued).toBe(cards.length)
      expect((yield* Effect.flip(tagger.tagQueued()))._tag).toBe("LlmNotConfigured")

      // Before any tags, "sea animal" matches only cards whose own words start with both: none.
      expect((yield* search.search(query("sea animal"))).total).toBe(0)

      yield* sql`UPDATE cards SET tags = '{sea_creature,fish}' WHERE id = 'TW-001'`
      const tagged = yield* sql<{ readonly listingId: string; readonly hit: boolean }>`
        SELECT listing_id, terms @@ '#sea_creature'::tsquery AS hit FROM listing_search WHERE card_id = 'TW-001'`
      expect(tagged.length).toBe(listingsOf((id) => id === "TW-001").length)
      expect(tagged.every((r) => r.hit)).toBe(true)

      const found = yield* search.search(query("sea animal"))
      expect([...found.ids].sort()).toEqual(listingsOf((id) => id === "TW-001"))
      expect(found.understood).toEqual(["sea creatures"])
      const holo = yield* search.search(query("sea animal with hologram"))
      expect(holo.total).toBe(
        active.filter((x) => x.vaultItem.cardId === "TW-001" && x.vaultItem.finish === "holo").length
      )
      expect(holo.understood).toEqual(["sea creatures", "holo"])

      // A tag word still finds cards by their own words: "water" is a tag and a kind.
      const water = yield* search.search(query("water"))
      expect(water.total).toBe(listingsOf((id) => cardById(id).kinds.includes("water")).length)

      // Tag lexemes stay out of "did you mean", and a user word can never reach one.
      expect((yield* sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM search_vocab WHERE term LIKE '#%'`)[0]!.n).toBe(0)
      expect((yield* search.search(query("sea_creature"))).total).toBe(0)

      // Untagged again: gone from the tag, everywhere.
      yield* sql`UPDATE cards SET tags = '{}' WHERE id = 'TW-001'`
      expect((yield* search.search(query("sea animal"))).total).toBe(0)
    }))

  it.effect("new card text puts a card back in the queue, keeping its tags meanwhile", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`UPDATE cards SET tags = '{bird}', tagged_version = ${TAG_VOCAB_VERSION} WHERE id = 'OS-006'`
      yield* sql`UPDATE cards SET catalog_text = catalog_text WHERE id = 'OS-006'`
      const same = yield* sql<{ readonly taggedVersion: number | null }>`SELECT tagged_version FROM cards WHERE id = 'OS-006'`
      expect(same[0]!.taggedVersion).toBe(TAG_VOCAB_VERSION)
      yield* sql`UPDATE cards SET catalog_text = catalog_text || ' Now with a new lore line.' WHERE id = 'OS-006'`
      const changed = yield* sql<{ readonly taggedVersion: number | null; readonly tags: ReadonlyArray<string> }>`
        SELECT tagged_version, tags FROM cards WHERE id = 'OS-006'`
      expect(changed[0]).toEqual({ taggedVersion: null, tags: ["bird"] })
      yield* sql`UPDATE cards SET tags = '{}' WHERE id = 'OS-006'`
    }))

  it.effect("the tagger writes checked tags, skips what it should, and carries on where it stopped", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      let failBatchOnce = true
      const fake = Llm.of({
        model: "fake",
        structured: <A>(req: StructuredRequest<A>) =>
          Effect.gen(function* () {
            expect(req.purpose).toBe("tag_cards")
            // Someone edits a card while the model is reading it: its tags must not be written.
            yield* sql`UPDATE cards SET catalog_text = catalog_text || ' Reprinted.' WHERE id = 'OS-002'`.pipe(Effect.orDie)
            return { value: answer(req.user) as unknown as A, usage }
          }),
        converse: () => Effect.die("not used"),
        // The Message Batches path: one call errors the first time.
        structuredBatch: (req) =>
          Effect.sync(() =>
            req.items.map((item): BatchAnswer<any> => {
              if (item.user.includes("EF-001:") && failBatchOnce) {
                failBatchOnce = false
                return { id: item.id, value: null, error: "errored", usage }
              }
              return { id: item.id, value: { cards: cardsIn(item.user).map((c) => ({ id: c.id, tags: ["animal"] })) }, error: null, usage }
            })
          )
      })
      const tagger = yield* makeCardTagger.pipe(Effect.provideService(Llm, fake))

      const first = yield* tagger.tagQueued()
      // 40 cards a call: two calls for the 80 hand-written cards.
      expect(first).toMatchObject({ cards: cards.length, calls: 2, failedCalls: 0, tagged: cards.length - 2, costUsdMicros: 70 })
      expect(yield* tagger.queued).toBe(2)
      const rows = yield* sql<{ readonly id: string; readonly tags: ReadonlyArray<string>; readonly taggedVersion: number | null }>`
        SELECT id, tags, tagged_version FROM cards WHERE id IN ('TW-001', 'EF-002', 'EF-001', 'OS-002') ORDER BY id`
      expect(rows).toEqual([
        { id: "EF-001", tags: [], taggedVersion: null },
        { id: "EF-002", tags: ["animal"], taggedVersion: TAG_VOCAB_VERSION },
        { id: "OS-002", tags: [], taggedVersion: null },
        // Repeats dropped, vocabulary order.
        { id: "TW-001", tags: ["animal", "sea_creature"], taggedVersion: TAG_VOCAB_VERSION }
      ])
      expect((yield* sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM cards WHERE id = 'NOPE-001'`)[0]!.n).toBe(0)

      // Sea creatures by tag: the water cards, minus the one whose text changed mid-call.
      const sea = yield* search.search(query("sea creatures"))
      expect([...sea.ids].sort()).toEqual(listingsOf((id) => id !== "OS-002" && cardById(id).kinds.includes("water")))

      // The rest through the Message Batches path, one card per call. A failed call leaves its card for next time.
      expect(yield* tagger.tagQueuedInBatches({ batch: 1 })).toMatchObject({ cards: 2, calls: 2, tagged: 1, failedCalls: 1 })
      expect(yield* tagger.queued).toBe(1)
      expect(yield* tagger.tagQueuedInBatches({ batch: 1 })).toMatchObject({ cards: 1, calls: 1, tagged: 1, failedCalls: 0 })
      expect(yield* tagger.queued).toBe(0)
      // Nothing queued: a run reads the queue and calls nobody.
      expect(yield* tagger.tagQueued()).toMatchObject({ cards: 0, calls: 0 })
    }))
})
