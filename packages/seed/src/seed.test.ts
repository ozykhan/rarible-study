import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { cards, drops, handWritten } from "./catalog.ts"
import { dropSeeds, generateSeed } from "./generate.ts"

const fingerprint = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 16)

describe("catalog drops", () => {
  it("never changes what an earlier drop seeded", () => {
    // Fingerprints of the seed from before the second drop. A live database
    // holds these rows already, so a change here would leave it out of step.
    const launch = generateSeed().drops[0]
    expect(launch?.drop.id).toBe("launch")
    expect(launch?.listings.length).toBe(199)
    expect(fingerprint(launch?.listings)).toBe("0175f54142874576")
    expect(fingerprint(launch?.sales)).toBe("3f9fd7741ce78afc")
  })

  it("gives every drop its own ids", () => {
    const seed = generateSeed()
    expect(seed.listings.length).toBe(seed.drops.reduce((n, d) => n + d.listings.length, 0))
    const listingIds = seed.listings.map((x) => x.listing.id)
    expect(new Set(listingIds).size).toBe(listingIds.length)
    for (const d of seed.drops) {
      expect(d.listings.every((x) => x.listing.id.startsWith(`${d.spec.listingPrefix}-`))).toBe(true)
      expect(d.listings.every((x) => x.vaultItem.id.startsWith(`${d.spec.vaultPrefix}-`))).toBe(true)
      expect(d.listings.every((x) => d.drop.cards.some((c) => c.id === x.vaultItem.cardId))).toBe(true)
    }
    // Only the launch drop may use VLT-: the live generator numbers on from the highest one.
    expect(dropSeeds.filter((s) => s.vaultPrefix === "VLT").map((s) => s.dropId)).toEqual(["launch"])
    expect(new Set(dropSeeds.map((s) => s.listingPrefix)).size).toBe(dropSeeds.length)
  })

  it("keeps every card in a set of its own drop", () => {
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length)
    for (const d of drops) {
      expect(d.cards.every((c) => d.sets.some((s) => s.id === c.setId))).toBe(true)
    }
    expect(handWritten.cards.length).toBe(80)
    expect(handWritten.sets.length).toBe(8)
  })
})
