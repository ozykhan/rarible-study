import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Llm, LlmError, SpendCapReached, type StructuredRequest, type Usage } from "../src/llm/Llm.ts"
import { FIT_BATCH, FIT_CANDIDATES, makeCardFit } from "../src/search/CardFit.ts"
import { CardVectors } from "../src/search/CardVectors.ts"
import { fitKey, type MarketQuery } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { testLayer } from "./db.ts"

const TestLive = testLayer("fit")

const usage: Usage = { inputTokens: 2500, cacheReadTokens: 0, outputTokens: 40, costUsdMicros: 270, latencyMs: 1 }

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

type Verdict = { readonly card: number; readonly words: string }

/** A card's own words, as a judge copies them: the last three of its line. */
const ownWords = (line: string) => line.split(" ").slice(-3).join(" ")

/**
 * A stand-in judge that answers each call from a script, given the numbered
 * lines of the cards in that call, and remembers the lines it was shown.
 */
const judge = (answer: (cards: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<Verdict>, LlmError | SpendCapReached>) => {
  const asked: Array<ReadonlyArray<string>> = []
  const llm = Llm.of({
    model: "fake",
    structured: <A>(req: StructuredRequest<A>) =>
      Effect.gen(function* () {
        expect(req.purpose).toBe("fit_cards")
        const cards = req.user.split("\n").filter((l) => /^\d+\. /.test(l))
        asked.push(cards)
        return { value: { fits: yield* answer(cards), ruled_out: [] } as unknown as A, usage }
      }),
    converse: () => Effect.die("not used"),
    structuredBatch: () => Effect.die("not used")
  })
  return { llm, asked }
}

/** Keeps the cards whose text is one of `texts`, quoting each card's own words. */
const keeping = (texts: ReadonlyArray<string>) => (cards: ReadonlyArray<string>) =>
  Effect.succeed(
    cards.flatMap((line, i) => (texts.some((t) => line === `${i + 1}. ${t}`) ? [{ card: i + 1, words: ownWords(line) }] : []))
  )

const open = Effect.void
const closed = Effect.fail("too many")

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("judging cards against a description", (it) => {
  it.effect("judges the first cards once, then shows only the ones that fit, a page at a time", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      yield* (yield* CardVectors).refresh(1000)
      const dragons = query({ q: "dragon", from: "dragon that guards treasure", fit: "guards treasure" })

      // Before any judging the description only ranks.
      const ranked = yield* search.search(dragons)
      expect(ranked).toMatchObject({ sort: "relevance", fit: { phrase: "guards treasure", applied: false } })
      const candidates = yield* search.fitCandidates(dragons, FIT_CANDIDATES)
      expect(candidates.length).toBeGreaterThan(2)
      // A card is judged on its kinds and lore: not its set's name, its own name or its rarity.
      const [first] = yield* sql<{ readonly name: string; readonly setName: string; readonly catalogText: string }>`
        SELECT c.name, s.name AS set_name, c.catalog_text FROM cards c JOIN sets s ON s.id = c.set_id WHERE c.id = ${candidates[0]!.id}`
      expect(candidates[0]!.catalogText).toBe(first!.catalogText)
      expect(candidates[0]!.text).toMatch(/ type card\. /)
      for (const left of [first!.setName, first!.name, "Rarity"]) expect(candidates[0]!.text).not.toContain(left)

      const fake = judge(keeping([candidates[0]!.text, candidates[2]!.text]))
      const fit = yield* makeCardFit.pipe(Effect.provideService(Llm, fake.llm))
      expect(yield* fit.check(dragons, open)).toEqual({ status: "checked", checked: candidates.length, fitting: 2, source: "model" })
      // Ten cards a call, side by side.
      expect(fake.asked.map((a) => a.length)).toEqual(
        Array.from({ length: Math.ceil(candidates.length / FIT_BATCH) }, (_, b) => Math.min(FIT_BATCH, candidates.length - b * FIT_BATCH))
      )
      expect(fake.asked[0]![0]).toBe(`1. ${candidates[0]!.text}`)
      const calls = fake.asked.length

      const kept = [candidates[0]!.id, candidates[2]!.id]
      const cut = yield* search.search(dragons)
      expect(cut.fit).toEqual({ phrase: "guards treasure", applied: true })
      const cardOf = (ids: ReadonlyArray<string>) =>
        sql<{ readonly listingId: string; readonly cardId: string }>`
          SELECT listing_id, card_id FROM listing_search WHERE listing_id IN ${sql.in(ids)}`.pipe(
          Effect.map((rows) => ids.map((id) => rows.find((r) => r.listingId === id)!.cardId))
        )
      const shown = yield* cardOf(cut.ids)
      expect(new Set(shown)).toEqual(new Set(kept))
      expect(shown.slice(0, 2)).toEqual(kept)
      const n = (yield* sql<{ readonly n: number }>`
        SELECT count(*)::int AS n FROM listing_search WHERE card_id IN ${sql.in(kept)}`)[0]!.n
      expect(cut.total).toBe(n)
      expect(cut.counts.all).toBe(n)

      // The same order a page at a time.
      const pages: Array<string> = []
      for (let offset = 0; offset < cut.total; offset += 3) pages.push(...(yield* search.search({ ...dragons, offset, limit: 3 })).ids)
      expect(pages).toEqual(cut.ids)

      // Judged once: the same search again needs no model, even past the rate limit.
      expect(yield* fit.check(dragons, closed)).toMatchObject({ status: "checked", fitting: 2, source: "cache" })
      expect(fake.asked.length).toBe(calls)

      // The same description elsewhere reuses what was judged and asks only about the rest. With nothing to
      // filter by, the first cards of the whole catalog are judged.
      const anything = query({ from: "something that guards treasure", fit: "that guards treasure" })
      const all = yield* search.fitCandidates(anything, FIT_CANDIDATES)
      expect(all.length).toBeGreaterThan(candidates.length)
      expect((yield* search.search(anything)).sort).toBe("relevance")
      yield* fit.check(anything, open)
      const judgedBefore = all.filter((c) => candidates.some((d) => d.id === c.id)).length
      expect(fake.asked.slice(calls).flat().length).toBe(all.length - judgedBefore)

      // A card whose text changes loses its judgments, so it drops out until judged again.
      yield* sql`UPDATE cards SET catalog_text = catalog_text || ' Now with a new line of lore.' WHERE id = ${kept[0]!}`
      const after = yield* cardOf((yield* search.search(dragons)).ids)
      expect(after.includes(kept[0]!)).toBe(false)
      expect(after.includes(kept[1]!)).toBe(true)
    }))

  it.effect("keeps only verdicts that name a card and quote its own words, of the text still there", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      const owls = query({ q: "bird", from: "bird that sings at dusk", fit: "sings at dusk" })
      const candidates = yield* search.fitCandidates(owls, FIT_CANDIDATES)
      expect(candidates.length).toBeGreaterThanOrEqual(4)
      const line = (n: number) => `${n}. ${candidates[n - 1]!.text}`
      const fake = judge((cards) =>
        cards[0] !== line(1)
          ? Effect.succeed([])
          : // The second card's text changes while it is being judged.
            sql`UPDATE cards SET catalog_text = catalog_text || ' Changed.' WHERE id = ${candidates[1]!.id}`.pipe(
              Effect.orDie,
              Effect.as([
                { card: 0, words: "" },
                { card: 1, words: ownWords(line(1)).toUpperCase() },
                { card: 2, words: ownWords(line(2)) },
                { card: 2.5, words: ownWords(line(2)) },
                // Words the card does not have, and no words at all.
                { card: 3, words: "sings to the qqxv moon" },
                { card: 4, words: "" },
                { card: cards.length + 1, words: "at dusk" }
              ])
            )
      )
      const fit = yield* makeCardFit.pipe(Effect.provideService(Llm, fake.llm))
      expect(yield* fit.check(owls, open)).toMatchObject({ status: "checked", fitting: 1, source: "model" })
      expect(fitKey(owls.fit)).toBe("sings at dusk")
      const rows = yield* sql<{ readonly cardId: string; readonly fits: boolean }>`
        SELECT card_id, fits FROM card_fits WHERE concept = ${fitKey(owls.fit)} ORDER BY card_id`
      expect(rows.find((r) => r.cardId === candidates[0]!.id)?.fits).toBe(true)
      expect(rows.some((r) => r.cardId === candidates[1]!.id)).toBe(false)
      expect(rows.length).toBe(candidates.length - 1)
    }))

  it.effect("leaves the search uncut when the model cannot answer, and remembers nothing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      const golems = query({ q: "golem", from: "golem that hums", fit: "hums" })
      const check = (answer: Effect.Effect<ReadonlyArray<Verdict>, LlmError | SpendCapReached>, limit: Effect.Effect<void, string> = open) =>
        Effect.flatMap(makeCardFit.pipe(Effect.provideService(Llm, judge(() => answer).llm)), (f) => f.check(golems, limit))
      expect(yield* check(Effect.fail(new LlmError({ message: "overloaded" })))).toEqual({ status: "unavailable", reason: "failed" })
      expect(yield* check(Effect.fail(new SpendCapReached({ capUsd: 2, spentUsd: 2 })))).toEqual({
        status: "unavailable",
        reason: "spend_cap"
      })
      expect(yield* check(Effect.succeed([]), closed)).toEqual({ status: "unavailable", reason: "busy" })
      expect(yield* check(Effect.never)).toEqual({ status: "unavailable", reason: "slow" })
      const stored = yield* sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM card_fits WHERE concept = 'hums'`
      expect(stored[0]!.n).toBe(0)
      expect((yield* search.search(golems)).fit).toEqual({ phrase: "hums", applied: false })
      // A search that shows nothing has nothing to judge.
      const none = yield* Effect.flatMap(makeCardFit.pipe(Effect.provideService(Llm, judge(() => Effect.succeed([])).llm)), (f) =>
        f.check(query({ q: "golem nvg 10 under 1", fit: "hums" }), closed)
      )
      expect(none).toEqual({ status: "no_cards" })
    }))

  it.effect("keeps the calls that answered when another is slow, and judges the rest next time", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      // Nothing to filter by: the whole catalog is ranked, more cards than one call takes.
      const lights = query({ from: "something that glows in the dark", fit: "glows in the dark" })
      const candidates = yield* search.fitCandidates(lights, FIT_CANDIDATES)
      expect(candidates.length).toBeGreaterThan(FIT_BATCH)
      const firstCall = (cards: ReadonlyArray<string>) => cards[0] === `1. ${candidates[0]!.text}`
      const slow = judge((cards) => (firstCall(cards) ? Effect.never : keeping(candidates.map((c) => c.text))(cards)))
      const partly = yield* Effect.flatMap(makeCardFit.pipe(Effect.provideService(Llm, slow.llm)), (f) => f.check(lights, open))
      const rest = candidates.length - FIT_BATCH
      expect(partly).toEqual({ status: "checked", checked: rest, fitting: rest, source: "model" })
      // The cut shows what was judged to fit; the slow call's cards are asked about on the next search.
      expect((yield* search.search(lights)).fit).toEqual({ phrase: "glows in the dark", applied: true })
      const next = judge(keeping([]))
      const again = yield* Effect.flatMap(makeCardFit.pipe(Effect.provideService(Llm, next.llm)), (f) => f.check(lights, open))
      expect(again).toEqual({ status: "checked", checked: candidates.length, fitting: rest, source: "model" })
      expect(next.asked.flat().length).toBe(FIT_BATCH)
    }))
})
