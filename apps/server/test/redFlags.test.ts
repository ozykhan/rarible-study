import { money } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { gradeClaimMismatch, redFlagsFor } from "../src/matcher/redFlags.ts"
import { listing } from "./fixtures.ts"

const facts = (over: { activeListingsForVaultItem?: number; medianSaleUsdCents?: number | null } = {}) => ({
  listingId: "T-00001",
  activeListingsForVaultItem: 1,
  medianSaleUsdCents: 150_000,
  ...over
})

describe("gradeClaimMismatch", () => {
  it("accepts text that repeats the vault grade", () => {
    expect(gradeClaimMismatch(listing())).toBe(false)
  })

  it("catches a higher grade claimed in the title", () => {
    expect(gradeClaimMismatch(listing({ grade: 8, title: "Cinderwing Drake Gem mint NVG 10" }))).toBe(true)
  })

  it("catches a different grader claimed in the description", () => {
    expect(gradeClaimMismatch(listing({ description: "Graded QSG 9, cert in photos." }))).toBe(true)
  })

  it("catches a bare gem mint claim", () => {
    expect(gradeClaimMismatch(listing({ grade: 9, description: "Gem mint 10 copy." }))).toBe(true)
  })

  it("reads a long run of spaces in seller text in linear time", () => {
    // The old pattern backtracked quadratically here: about 0.6 s for 20,000 spaces.
    const started = performance.now()
    expect(gradeClaimMismatch(listing({ description: `Gem mint${" ".repeat(20_000)}x` }))).toBe(false)
    expect(performance.now() - started).toBeLessThan(100)
  })
})

describe("redFlagsFor", () => {
  it("has no flags for a clean listing at market price", () => {
    expect(redFlagsFor(listing(), facts())).toEqual([])
  })

  it("flags a vault item that is listed twice", () => {
    expect(redFlagsFor(listing(), facts({ activeListingsForVaultItem: 2 }))).toEqual(["duplicate_vault_item"])
  })

  it("flags a price far below recent sales, converting currency first", () => {
    expect(redFlagsFor(listing({ price: money(40_000, "USD") }), facts())).toEqual(["price_far_below_market"])
    // 1,000,000 JPY is about $6,667, so not cheap against a $1,500 median.
    expect(redFlagsFor(listing({ price: money(1_000_000, "JPY") }), facts())).toEqual([])
  })

  it("does not call a price cheap when there is no sales history", () => {
    expect(redFlagsFor(listing({ price: money(100, "USD") }), facts({ medianSaleUsdCents: null }))).toEqual([])
  })
})
