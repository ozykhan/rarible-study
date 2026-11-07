import { describe, expect, it } from "@effect/vitest"
import type { CardFacts } from "../src/catalog/CatalogRepo.ts"
import { JUDGE_SYSTEM, judgePrompt } from "../src/matcher/judge.ts"
import { listing } from "./fixtures.ts"
import { ruleFor } from "./rules.ts"

const crab = listing({ setId: "TW", setName: "Tidewild", cardId: "TW-002", cardNumber: "002", cardName: "Reefguard Crab" })
const armored = ruleFor(crab, { rawWant: "armored creature grade 8 or higher up to $50", softDescription: "armored creature" })
const facts = (tags: ReadonlyArray<string>): CardFacts => ({
  cardId: "TW-002",
  kinds: ["water"],
  tags,
  catalogText: "Reefguard Crab, a common water card from Tidewild. A crab that guards coral with oversized claws."
})

describe("the match check's catalog facts", () => {
  it("shows how the market describes the card, the tags search finds it by", () => {
    const prompt = judgePrompt(armored, crab, facts(["animal", "sea_creature", "coast", "armored"]), [])
    expect(prompt).toContain("Kinds: water\nDescribed by the market as: animals, sea creatures, coastal, armored\n</catalog_facts>")
    // A kind is a broad type: a trait it does not name is no evidence against the card.
    expect(JUDGE_SYSTEM).toContain("a trait the kinds do not name is no evidence against the card")
  })

  it("says so when the market has not described the card yet, and when the card is unknown", () => {
    expect(judgePrompt(armored, crab, facts([]), [])).toContain("Described by the market as: not described yet")
    expect(judgePrompt(armored, crab, undefined, [])).toContain("Described by the market as: unknown")
  })
})
