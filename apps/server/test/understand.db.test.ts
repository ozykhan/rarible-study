import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { Llm, LlmError, SpendCapReached, type StructuredRequest, type Usage } from "../src/llm/Llm.ts"
import { parseSearch } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { makeSearchUnderstanding, understandKey, type Reading } from "../src/search/SearchUnderstanding.ts"
import { testLayer } from "./db.ts"

const TestLive = testLayer("understand")

const usage: Usage = { inputTokens: 3000, cacheReadTokens: 2900, outputTokens: 70, costUsdMicros: 70, latencyMs: 1 }

const nothing: Reading = {
  tags: [],
  names: [],
  finishes: [],
  editions: [],
  graders: [],
  min_grade: null,
  max_price: null,
  describes: [],
  not_understood: []
}

/** A stand-in model that answers from a script and remembers what it was asked. */
const scripted = (answer: (user: string) => Effect.Effect<Reading, LlmError | SpendCapReached>) => {
  const asked: Array<string> = []
  const llm = Llm.of({
    model: "fake",
    structured: <A>(req: StructuredRequest<A>) =>
      Effect.gen(function* () {
        expect(req.purpose).toBe("understand_search")
        asked.push(req.user)
        return { value: (yield* answer(req.user)) as unknown as A, usage }
      }),
    converse: () => Effect.die("not used"),
    structuredBatch: () => Effect.die("not used")
  })
  return { llm, asked }
}

const open = Effect.void
const closed = Effect.fail("too many")

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("reading a described search", (it) => {
  it.effect("reads what code cannot, keeps what checks out, and remembers it", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const fake = scripted(() =>
        Effect.succeed({
          ...nothing,
          // "ocean" is already sea creature (code reads it), and "wyrm" is a name: neither can stand for
          // a second filter. "lava" was never typed, and 9.3 is not a grade.
          tags: [
            { tag: "sea_creature", from: "from the ocean" },
            { tag: "water", from: "ocean" },
            { tag: "dragon", from: "wyrm" },
            { tag: "fire", from: "lava" }
          ],
          names: ["wyrm", "blorp"],
          finishes: [{ finish: "holo", from: "shiny" }],
          min_grade: { grade: 9.3, from: "thing" },
          not_understood: ["cheapest", "drop every table"]
        })
      )
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))

      // Every word known: no model, the search stands as typed.
      expect(yield* reader.understand("ashen wyrm holo 9+", closed)).toEqual({ status: "not_needed" })
      expect(fake.asked).toEqual([])

      const typed = "cheapest shiny wyrm thing from the ocean"
      const read = yield* reader.understand(typed, open)
      expect(read).toEqual({
        status: "understood",
        q: "ocean, holo, wyrm",
        understood: ["sea creatures", "holo", '"wyrm"'],
        describes: [],
        // Only the shopper's own words come back; "blorp" was never typed, nor was "drop every table".
        notUnderstood: ["cheapest"],
        source: "model"
      })
      // The model is told which words the catalog knows and what the others look like, never the catalog.
      expect(fake.asked[0]).toContain(`<search>${typed}</search>`)
      expect(fake.asked[0]).toContain("Words the catalog knows: wyrm.")
      expect(fake.asked[0]).toMatch(/Words it does not know, with the catalog words spelled most like them: cheapest \(/)

      // The same words in another order and case: one reading, from the cache, even when the limit is reached.
      const again = yield* reader.understand("The ocean, from thing WYRM shiny cheapest", closed)
      expect(again).toMatchObject({ status: "understood", q: "ocean, holo, wyrm", source: "cache" })
      expect(fake.asked.length).toBe(1)
      const row = yield* sql<{ readonly hits: number; readonly costUsdMicros: number }>`
        SELECT hits, cost_usd_micros FROM search_understandings WHERE key = ${understandKey(typed)}`
      expect(row[0]).toEqual({ hits: 1, costUsdMicros: 70 })

      // The URL keeps the rewritten search, which code reads alone.
      expect(yield* reader.understand("ocean, holo, wyrm", closed)).toEqual({ status: "not_needed" })

      // A reading from an older vocabulary or prompt is not used.
      yield* sql`UPDATE search_understandings SET version = 'tags0.prompt0'`
      expect(yield* reader.understand(typed, open)).toMatchObject({ source: "model" })
      expect(fake.asked.length).toBe(2)
    }))

  it.effect("finds the search the rewritten text asks for", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      const fake = scripted(() =>
        Effect.succeed({
          ...nothing,
          tags: [{ tag: "sea_creature", from: "lives in the ocean" }],
          finishes: [{ finish: "holo", from: "shiny" }]
        })
      )
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))
      const read = yield* reader.understand("something that lives in the ocean, shiny", open)
      expect(read).toMatchObject({ status: "understood", q: "ocean, holo" })
      const q = (read as { readonly q: string }).q
      const query = { set: null, grader: null, sort: "recent", from: "", fit: "", offset: 0, limit: 100 } as const
      // Typed as is, the search has unknown words and finds nothing; rewritten, it is the sea and holo search.
      expect(yield* search.search({ ...query, q: "something that lives in the ocean, shiny" })).toMatchObject({
        total: 0,
        unknown: ["that", "lives", "shiny"]
      })
      const found = yield* search.search({ ...query, q })
      expect(found.understood).toEqual(["sea creatures", "holo"])
      expect(found.total).toBe((yield* search.search({ ...query, q: "sea creature holo" })).total)
      expect(found.chips).toEqual([
        { label: "sea creatures", q: "holo" },
        { label: "holo", q: "ocean" }
      ])
    }))

  it.effect("lets each typed word stand for one filter", () =>
    Effect.gen(function* () {
      const fake = scripted(() =>
        Effect.succeed({
          ...nothing,
          // "shiny" is the holo finish, so it cannot also be glowing; "volcano" was never typed.
          tags: [
            { tag: "glows", from: "shiny" },
            { tag: "space", from: "glimmery" },
            { tag: "fire", from: "volcano" }
          ],
          finishes: [{ finish: "holo", from: "shiny" }]
        })
      )
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))
      const read = yield* reader.understand("a shiny glimmery thing", open)
      expect(read.status).toBe("understood")
      const p = parseSearch((read as { readonly q: string }).q)
      expect(p.tags.map((t) => t.tag)).toEqual(["space"])
      expect(p.finishes).toEqual(["holo"])
    }))

  it.effect("lets a corrected name keep its misspelling, and the model leave out a tag code saw", () =>
    Effect.gen(function* () {
      const answers: Record<string, Reading> = {
        // "stormcaler" was offered as close to stormcaller, so it cannot also be the storm tag.
        "stormcaler heron": { ...nothing, names: ["stormcaller", "heron"], tags: [{ tag: "storm", from: "stormcaler" }] },
        // Code reads "fire" as a tag word, but the shopper ruled it out and the model left it out.
        "dragon that is not fire": { ...nothing, tags: [{ tag: "dragon", from: "dragon" }], describes: ["not fire"] }
      }
      const fake = scripted((user) => Effect.succeed(Object.entries(answers).find(([q]) => user.includes(`<search>${q}</search>`))![1]))
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))
      expect(yield* reader.understand("stormcaler heron", open)).toMatchObject({ status: "understood", q: "stormcaller heron" })
      expect(yield* reader.understand("dragon that is not fire", open)).toMatchObject({
        status: "understood",
        q: "dragon",
        describes: ["not fire"]
      })
    }))

  it.effect("keeps what describes the card in the shopper's words, minus what a filter took", () =>
    Effect.gen(function* () {
      const answers: Record<string, Reading> = {
        "dragon that guards treasure from the ocean": {
          ...nothing,
          tags: [
            { tag: "dragon", from: "dragon" },
            { tag: "sea_creature", from: "from the ocean" }
          ],
          // "from the ocean" is the sea creature tag already; "hoards gold" was never typed.
          describes: ["guards treasure", "from the ocean", "hoards gold", "guards treasure"]
        },
        // Nothing to filter by, only a description: the whole catalog is judged against it.
        "something that guards treasure": { ...nothing, describes: ["that guards treasure"] },
        "zzkq that": { ...nothing, describes: ["that"] }
      }
      const fake = scripted((user) => Effect.succeed(Object.entries(answers).find(([q]) => user.includes(`<search>${q}</search>`))![1]))
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))
      expect(yield* reader.understand("dragon that guards treasure from the ocean", open)).toMatchObject({
        status: "understood",
        q: "dragon, ocean",
        describes: ["guards treasure"]
      })
      expect(yield* reader.understand("something that guards treasure", open)).toEqual({
        status: "understood",
        q: "",
        understood: [],
        describes: ["that guards treasure"],
        notUnderstood: [],
        source: "model"
      })
      expect(yield* reader.understand("something that guards treasure", closed)).toMatchObject({ q: "", source: "cache" })
      // A description of joining words alone describes nothing.
      expect(yield* reader.understand("zzkq that", open)).toMatchObject({ status: "nothing" })
    }))

  it.effect("remembers when there is nothing to search for", () =>
    Effect.gen(function* () {
      const fake = scripted(() => Effect.succeed({ ...nothing, not_understood: ["zzkq"] }))
      const reader = yield* makeSearchUnderstanding.pipe(Effect.provideService(Llm, fake.llm))
      expect(yield* reader.understand("zzkq qqxv", open)).toEqual({ status: "nothing", notUnderstood: ["zzkq"], source: "model" })
      expect(yield* reader.understand("qqxv zzkq", open)).toEqual({ status: "nothing", notUnderstood: ["zzkq"], source: "cache" })
      expect(fake.asked.length).toBe(1)
    }))

  it.effect("keeps the keyword results when the model cannot answer, and remembers nothing", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const read = (answer: Effect.Effect<Reading, LlmError | SpendCapReached>, limit: Effect.Effect<void, string> = open) =>
        Effect.flatMap(makeSearchUnderstanding.pipe(Effect.provideService(Llm, scripted(() => answer).llm)), (r) =>
          r.understand("a gloopy wibbler", limit)
        )
      expect(yield* read(Effect.fail(new LlmError({ message: "overloaded" })))).toEqual({ status: "unavailable", reason: "failed" })
      expect(yield* read(Effect.fail(new SpendCapReached({ capUsd: 2, spentUsd: 2 })))).toEqual({
        status: "unavailable",
        reason: "spend_cap"
      })
      // The rate limit is checked only when the model would be called.
      expect(yield* read(Effect.succeed(nothing), closed)).toEqual({ status: "unavailable", reason: "busy" })
      // Past the time limit the shopper keeps the keyword results.
      expect(yield* read(Effect.never)).toEqual({ status: "unavailable", reason: "slow" })
      const cached = yield* sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM search_understandings WHERE query = 'a gloopy wibbler'`
      expect(cached[0]!.n).toBe(0)
    }))
})
