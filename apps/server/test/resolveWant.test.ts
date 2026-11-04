import type { ParsedWant } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { resolveWant } from "../src/rules/RuleParser.ts"

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

describe("resolveWant", () => {
  it("asks which set when a card name exists in two sets", () => {
    const draft = resolveWant("a cinderwing drake", parsed({ cardName: "Cinderwing Drake" }))
    expect(draft.hard.cardId).toBeNull()
    expect(draft.questions.join(" ")).toMatch(/Origin Set or Starward Expedition/)
  })

  it("resolves the card once the set is given, and fills in the set id", () => {
    const draft = resolveWant("origin cinderwing", parsed({ setName: "origin set", cardName: "Cinderwing Drake" }))
    expect(draft.hard).toMatchObject({ setId: "OS", cardId: "OS-001" })
    expect(draft.questions).toEqual([])
  })

  it("tolerates a small typo but never invents an id", () => {
    expect(resolveWant("x", parsed({ setName: "Origin Set", cardName: "Cinderwng Drake" })).hard.cardId).toBe("OS-001")
    const unknown = resolveWant("x", parsed({ cardName: "Moonlight Unicorn" }))
    expect(unknown.hard.cardId).toBeNull()
    expect(unknown.questions).toHaveLength(1)
  })

  it("asks for a price instead of guessing one", () => {
    const draft = resolveWant("any water card", parsed({ maxPrice: null }))
    expect(draft.questions).toContain("What is the most you want to pay?")
  })

  it("stores the price in minor units of the chosen currency", () => {
    expect(resolveWant("x", parsed({ maxPrice: 900 })).hard.maxPrice).toEqual({ amountMinor: 90_000, currency: "USD" })
    expect(resolveWant("x", parsed({ maxPrice: 50_000, currency: "JPY" })).hard.maxPrice).toEqual({
      amountMinor: 50_000,
      currency: "JPY"
    })
  })
})
