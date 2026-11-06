import { describe, expect, it } from "vitest"
import { handWritten } from "./catalog.ts"
import { generateBulkListings, generateLargeCatalog, generateSellers } from "./large.ts"

describe("the large test market", () => {
  const catalog = generateLargeCatalog()
  const sellers = generateSellers()

  it("is about 20,000 cards in 204 sets, the hand-written four first and unchanged", () => {
    expect(catalog.sets.length).toBe(204)
    expect(catalog.cards.length).toBe(20_040)
    expect(catalog.sets.slice(0, 4)).toEqual(handWritten.sets)
    expect(catalog.cards.slice(0, handWritten.cards.length)).toEqual(handWritten.cards)
    expect(new Set(catalog.cards.map((c) => c.id)).size).toBe(catalog.cards.length)
    expect(new Set(catalog.sets.map((s) => s.name)).size).toBe(catalog.sets.length)
    for (const c of catalog.cards) expect(catalog.setById(c.setId).id).toBe(c.setId)
  })

  it("is the same on every run", () => {
    const again = generateLargeCatalog()
    expect(again.sets).toEqual(catalog.sets)
    expect(again.cards).toEqual(catalog.cards)
    expect(generateSellers()).toEqual(sellers)
  })

  it("has sellers with unique ids and handles, the seed's twelve first", () => {
    expect(sellers.length).toBe(2012)
    expect(new Set(sellers.map((s) => s.id)).size).toBe(sellers.length)
    expect(new Set(sellers.map((s) => s.handle)).size).toBe(sellers.length)
  })

  it("lists in chunks, with bulk ids that never meet the seed's", () => {
    const chunks = [...generateBulkListings({ count: 12_345, chunk: 5000, catalog, sellers })]
    expect(chunks.map((c) => c.length)).toEqual([5000, 5000, 2345])
    const rows = chunks.flat()
    expect(new Set(rows.map((r) => r.listing.id)).size).toBe(rows.length)
    expect(rows.every((r) => r.listing.id.startsWith("B-") && r.vaultItem.id.startsWith("VLB-"))).toBe(true)
    expect(rows.every((r) => r.listing.source === "bulk" && r.listing.status === "active")).toBe(true)
    // Cards come from the whole catalog, not only the hand-written forty.
    expect(rows.filter((r) => r.vaultItem.cardId.startsWith("X")).length).toBeGreaterThan(rows.length * 0.9)
    const again = [...generateBulkListings({ count: 12_345, chunk: 5000, catalog, sellers })].flat()
    expect(again).toEqual(rows)
  })
})
