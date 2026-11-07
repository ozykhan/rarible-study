import { generateLargeCatalog } from "@slabwatch/seed"
import { parseSearch } from "@slabwatch/server"
import { describe, expect, it } from "vitest"
import { rankingCases } from "../src/rankingDataset.ts"

describe("the Best match cases", () => {
  const cards = generateLargeCatalog().cards

  it("filter by one tag, and say the rest in words no tag reads", () => {
    for (const c of rankingCases) {
      const q = parseSearch(c.q)
      expect(q.tags.length, c.q).toBe(1)
      expect(q.words, c.q).toEqual([])
      // Code reads the same single tag in what the shopper typed: the rest can only change the order.
      expect(parseSearch(c.from).tags.map((t) => t.tag), c.from).toEqual(q.tags.map((t) => t.tag))
    }
    expect(new Set(rankingCases.map((c) => c.from)).size).toBe(rankingCases.length)
  })

  it("label cards the generator really wrote, without copying its words", () => {
    for (const c of rankingCases) {
      const fit = cards.filter((x) => x.lore.includes(c.lore) && (c.kind === undefined || x.kinds[0] === c.kind))
      expect(fit.length, c.lore).toBeGreaterThan(100)
      expect(c.from.includes(c.lore), c.from).toBe(false)
    }
  })
})
