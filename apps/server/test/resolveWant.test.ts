import type { ParsedWant } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { cards, setById, sets } from "@slabwatch/seed"
import { Effect } from "effect"
import { describedIn, nameWords, resolveWant, type NameLookup } from "../src/rules/RuleParser.ts"

const parsed = (over: Partial<ParsedWant> = {}): ParsedWant => ({
  setName: null,
  cardName: null,
  edition: "any",
  finish: "any",
  graders: [],
  minGrade: 8,
  maxPrice: 500,
  currency: "USD",
  softDescription: null,
  unclear: [],
  ...over
})

/** Every set and card of the hand-written catalog as candidates: the database narrows them first in the app. */
const handWritten: NameLookup = {
  sets: () => Effect.succeed(sets.map((s) => ({ id: s.id, code: s.code, name: s.name }))),
  cards: (_name, setId) =>
    Effect.succeed(
      cards
        .filter((c) => setId === null || c.setId === setId)
        .map((c) => ({ id: c.id, setId: c.setId, setName: setById(c.setId).name, name: c.name }))
    )
}

const resolve = (rawWant: string, over: Partial<ParsedWant> = {}) => Effect.runSync(resolveWant(rawWant, parsed(over), handWritten))

describe("resolveWant", () => {
  it("asks which set when a card name exists in two sets", () => {
    const { draft } = resolve("a cinderwing drake", { cardName: "Cinderwing Drake" })
    expect(draft.hard.cardId).toBeNull()
    expect(draft.questions.join(" ")).toMatch(/Origin Set or Starward Expedition/)
  })

  it("resolves the card once the set is given, and fills in the set id and names", () => {
    const out = resolve("origin cinderwing", { setName: "origin set", cardName: "Cinderwing Drake" })
    expect(out.draft.hard).toMatchObject({ setId: "OS", cardId: "OS-001" })
    expect(out.draft.questions).toEqual([])
    expect(out).toMatchObject({ setName: "Origin Set", cardName: "Cinderwing Drake" })
  })

  it("tolerates a small typo but never invents an id", () => {
    expect(resolve("x", { setName: "Origin Set", cardName: "Cinderwng Drake" }).draft.hard.cardId).toBe("OS-001")
    const unknown = resolve("x", { cardName: "Moonlight Unicorn" }).draft
    expect(unknown.hard.cardId).toBeNull()
    expect(unknown.questions).toHaveLength(1)
  })

  it("takes the first words of a name when only one name starts with them", () => {
    expect(resolve("kelpie", { cardName: "Kelpie" }).draft.hard).toMatchObject({ setId: "TW", cardId: "TW-004" })
    expect(resolve("origin", { setName: "Origin" }).draft.hard.setId).toBe("OS")
    // Two cards start with Cinderwing: ask, as for any name in two sets.
    expect(resolve("cinderwing", { cardName: "Cinderwing" }).draft.questions.join(" ")).toMatch(/Origin Set or Starward Expedition/)
  })

  it("reads a kind of creature given as a card name as a description, the way search reads it", () => {
    const { draft } = resolve("horse cards grade 7 or better under $100", { cardName: "horse" })
    expect(draft.hard.cardId).toBeNull()
    expect(draft.softDescription).toBe("horse")
    expect(draft.questions).toEqual([])
    // Already in the description: nothing is added.
    expect(resolve("x", { cardName: "horse cards", softDescription: "a horse" }).draft.softDescription).toBe("a horse")
  })

  it("asks for a price instead of guessing one", () => {
    const { draft } = resolve("any water card", { maxPrice: null })
    expect(draft.questions).toContain("What is the most you want to pay?")
  })

  it("stores the price in minor units of the chosen currency", () => {
    expect(resolve("x", { maxPrice: 900 }).draft.hard.maxPrice).toEqual({ amountMinor: 90_000, currency: "USD" })
    expect(resolve("x", { maxPrice: 50_000, currency: "JPY" }).draft.hard.maxPrice).toEqual({
      amountMinor: 50_000,
      currency: "JPY"
    })
  })
})

describe("what the parser looks up for a want", () => {
  it("looks up the words that could name a card, not grades, prices, graders or filler", () => {
    expect(nameWords("Horse cards grade 7 or better under $100")).toEqual(["horse"])
    expect(nameWords("Origin Set Cinderwing Drake, 1st edition holo, NVG 9 or better, under $2,000")).toEqual([
      "origin",
      "cinderwing",
      "drake"
    ])
    expect(nameWords("A first edition dragon card from any set, grade 9 or better")).toEqual(["dragon"])
    expect(nameWords("Tidewild Glimmerfin reverse holo, QSG 10 only, under $500")).toEqual(["tidewild", "glimmerfin"])
  })

  it("names the descriptions market search reads, in the shopper's words", () => {
    expect(describedIn("Horse cards grade 7 or better under $100")).toEqual([{ words: "horse", label: "horses" }])
    expect(describedIn("a glowing sea creature")).toEqual([
      { words: "glowing", label: "glowing" },
      { words: "sea creature", label: "sea creatures" }
    ])
    expect(describedIn("Ashen Wyrm holo")).toEqual([])
  })
})
