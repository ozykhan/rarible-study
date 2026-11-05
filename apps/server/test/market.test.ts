import { money } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { marketPage, matchesSearch, parseMarketQuery } from "../src/web/market.ts"
import { listing } from "./fixtures.ts"

const q = (s: string) => parseMarketQuery(new URLSearchParams(s))

const wyrm = listing({
  listingId: "L-1",
  setId: "EF",
  setName: "Emberfall",
  cardId: "EF-001",
  cardNumber: "001",
  cardName: "Ashen Wyrm",
  grader: "NVG",
  grade: 10,
  price: money(84_900, "USD"),
  sellerHandle: "vaultkeeper",
  listedAt: "2026-11-05T10:00:00Z",
  // The seller's title claims a grade the slab does not have; search ignores it.
  title: "Ashen Wyrm QSG 9.5 best on the market"
})
const eel = listing({
  listingId: "L-2",
  setId: "EF",
  setName: "Emberfall",
  cardId: "EF-010",
  cardNumber: "010",
  cardName: "Lava Eel",
  edition: "unlimited",
  finish: "non_holo",
  grader: "QSG",
  grade: 7,
  price: money(1_000_000, "JPY"),
  listedAt: "2026-11-05T11:00:00Z"
})
const foal = listing({
  listingId: "L-3",
  setId: "TW",
  setName: "Tidewild",
  cardId: "TW-004",
  cardNumber: "004",
  cardName: "Kelpie Foal",
  finish: "reverse_holo",
  grader: "LCA",
  grade: 9.5,
  price: money(9_000, "EUR"),
  listedAt: "2026-11-05T09:00:00Z"
})
const all = [wyrm, eel, foal]
const ids = (s: string) => marketPage(all, q(s)).page.map((l) => l.listingId)

describe("market query", () => {
  it("defaults to the 40 newest and ignores unknown values", () => {
    expect(q("")).toEqual({ set: null, grader: null, q: "", sort: "recent", offset: 0, limit: 40 })
    expect(q("set=XX&grader=ABC&sort=cheapest&limit=5000&offset=-3")).toEqual({
      set: null,
      grader: null,
      q: "",
      sort: "recent",
      offset: 0,
      limit: 100
    })
    expect(q("set=EF&grader=NVG&q=%20wyrm%20&sort=grade&offset=40&limit=20")).toEqual({
      set: "EF",
      grader: "NVG",
      q: "wyrm",
      sort: "grade",
      offset: 40,
      limit: 20
    })
  })

  it("searches the vault record word by word, not the seller's title", () => {
    expect(matchesSearch(wyrm, "ashen wyrm")).toBe(true)
    expect(matchesSearch(wyrm, "wyr")).toBe(true)
    expect(matchesSearch(wyrm, "NVG 10")).toBe(true)
    expect(matchesSearch(wyrm, "1st edition holo")).toBe(true)
    expect(matchesSearch(wyrm, "@vaultkeeper")).toBe(true)
    expect(matchesSearch(wyrm, "northvale")).toBe(true)
    expect(matchesSearch(wyrm, "QSG 9.5")).toBe(false)
    // "10" is a grade, not the start of card #010.
    expect(matchesSearch(eel, "10")).toBe(false)
    expect(matchesSearch(eel, "#010")).toBe(true)
    expect(matchesSearch(eel, "holo")).toBe(false)
    expect(matchesSearch(foal, "reverse holo")).toBe(true)
  })

  it("filters by set and grader, sorts by the dUSD price, and counts per set", () => {
    expect(ids("")).toEqual(["L-2", "L-1", "L-3"])
    expect(ids("set=EF")).toEqual(["L-2", "L-1"])
    expect(ids("grader=LCA")).toEqual(["L-3"])
    // 1,000,000 JPY is 6,666.67 USD; 90.00 EUR is 97.83 USD.
    expect(ids("sort=price_asc")).toEqual(["L-3", "L-1", "L-2"])
    expect(ids("sort=price_desc")).toEqual(["L-2", "L-1", "L-3"])
    expect(ids("sort=grade")).toEqual(["L-1", "L-3", "L-2"])
    expect(ids("offset=1&limit=1")).toEqual(["L-1"])

    const page = marketPage(all, q("set=TW&q=emberfall"))
    expect(page.total).toBe(0)
    // The tabs count what the search matches in each set, whatever set is picked.
    expect(page.counts).toEqual({ all: 2, sets: { OS: 0, TW: 0, EF: 2, SE: 0 } })
  })
})
