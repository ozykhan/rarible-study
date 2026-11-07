import { expect, layer } from "@effect/vitest"
import type { ParsedWant } from "@slabwatch/domain"
import { cards, makeCatalog, sellers } from "@slabwatch/seed"
import { Effect } from "effect"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Llm, type StructuredRequest, type Usage } from "../src/llm/Llm.ts"
import { makeRuleParser, PARSE_SYSTEM } from "../src/rules/RuleParser.ts"
import { testLayer } from "./db.ts"

const TestLive = testLayer("ruleparser")

const usage: Usage = { inputTokens: 600, cacheReadTokens: 0, outputTokens: 80, costUsdMicros: 100, latencyMs: 1 }

const want = (over: Partial<ParsedWant>): ParsedWant => ({
  setName: null,
  cardName: null,
  edition: "any",
  finish: "any",
  graders: [],
  minGrade: 1,
  maxPrice: 100,
  currency: "USD",
  softDescription: null,
  unclear: [],
  ...over
})

/** A stand-in model that answers from a script and remembers what it was shown. */
const scripted = (answers: ReadonlyArray<ParsedWant>) => {
  const asked: Array<{ readonly system: string; readonly user: string }> = []
  const llm = Llm.of({
    model: "fake",
    structured: <A>(req: StructuredRequest<A>) =>
      Effect.sync(() => {
        expect(req.purpose).toBe("parse_want")
        asked.push({ system: req.system, user: req.user })
        return { value: answers[asked.length - 1] as unknown as A, usage }
      }),
    converse: () => Effect.die("not used"),
    structuredBatch: () => Effect.die("not used")
  })
  return { llm, asked }
}

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("drafting a watch from a want", (it) => {
  it.effect("looks up names in the database by spelling, a word at a time", () =>
    Effect.gen(function* () {
      const catalog = yield* CatalogRepo
      // A set the hand-written catalog does not have: the parser sees the catalog in the database.
      yield* catalog.insertCatalog(
        sellers,
        makeCatalog(
          [{ id: "X001", code: "X001", name: "Gilded Shores", releaseYear: 2010 }],
          [{ id: "X001-001", setId: "X001", number: "001", name: "Tidefang Seahorse", rarity: "rare", kinds: ["water"], lore: "A seahorse.", baseValueUsd: 80 }]
        )
      )

      // No card is called a horse in the hand-written sets; a seahorse's name has the word in it.
      expect((yield* catalog.cardsLike(["horse"], 5)).map((c) => c.name)).toEqual(["Tidefang Seahorse"])
      expect((yield* catalog.setsLike(["origin", "cinderwing", "drake"])).map((s) => s.id)).toEqual(["OS"])
      const named = yield* catalog.cardsLike(["cinderwing", "drake"], 5)
      // In the order of the words: both Cinderwing Drakes first, then other drakes.
      expect(named.slice(0, 2).map((c) => c.id).sort()).toEqual(["OS-001", "SE-010"])
      expect(named.length).toBeLessThanOrEqual(10)
      expect(yield* catalog.cardsLike(["kelpie"], 5)).toEqual([{ id: "TW-004", setId: "TW", setName: "Tidewild", name: "Kelpie Foal" }])

      expect((yield* catalog.setsNamed("origin")).map((s) => s.id)).toEqual(["OS"])
      expect((yield* catalog.setsNamed("tw")).map((s) => s.id)).toEqual(["TW"])
      expect((yield* catalog.cardsNamed("cinderwng drake", null)).slice(0, 2).map((c) => c.id).sort()).toEqual(["OS-001", "SE-010"])
      expect((yield* catalog.cardsNamed("cinderwng drake", "SE")).map((c) => c.id)).toEqual(["SE-010"])
      expect((yield* catalog.cardsNamed("tidefang seahorse", null)).map((c) => c.id)).toEqual(["X001-001"])

      expect(yield* catalog.namesById({ setId: "X001", cardId: "X001-001" })).toEqual({
        set: { id: "X001", code: "X001", name: "Gilded Shores" },
        card: { id: "X001-001", setId: "X001", setName: "Gilded Shores", name: "Tidefang Seahorse" }
      })
      expect(yield* catalog.namesById({ setId: "NOPE", cardId: "NOPE-001" })).toEqual({ set: null, card: null })
    }))

  it.effect("shows the model what search knows about the words, never the catalog", () =>
    Effect.gen(function* () {
      const fake = scripted([
        want({ minGrade: 7, maxPrice: 100, softDescription: "a horse" }),
        want({ cardName: "Kelpie Foal", minGrade: 9, maxPrice: 150 }),
        // A model that takes a kind of creature for a card's name: code reads it as search does.
        want({ cardName: "horse", minGrade: 7, maxPrice: 100 })
      ])
      const parser = yield* makeRuleParser.pipe(Effect.provideService(Llm, fake.llm))

      const horses = yield* parser.parse("Horse cards grade 7 or better under $100")
      expect(horses.draft).toMatchObject({
        hard: { setId: null, cardId: null, minGrade: 7, maxPrice: { amountMinor: 10_000, currency: "USD" } },
        softDescription: "a horse",
        questions: []
      })
      const first = fake.asked[0]!
      expect(first.user).toContain("<want>\nHorse cards grade 7 or better under $100\n</want>")
      expect(first.user).toContain(`Words the market reads as a description of a card: "horse" means horses.`)
      // The prompt holds no list of cards: names cannot say what a card is, and a big catalog would not fit.
      for (const c of cards) expect(first.system).not.toContain(c.name)
      expect(first.user).not.toContain("Kelpie Foal")

      const kelpie = yield* parser.parse("kelpie, grade 9 or better, under $150")
      expect(fake.asked[1]!.user).toContain("Cards with a name like these words: Kelpie Foal (Tidewild).")
      expect(kelpie).toMatchObject({
        draft: { hard: { setId: "TW", cardId: "TW-004", minGrade: 9 }, questions: [] },
        setName: "Tidewild",
        cardName: "Kelpie Foal"
      })

      const misread = yield* parser.parse("horse cards grade 7 or better under $100")
      expect(misread.draft).toMatchObject({ hard: { cardId: null }, softDescription: "horse", questions: [] })
      expect(PARSE_SYSTEM).toContain("Never ask whether a card, set or kind of creature exists")
    }))
})
