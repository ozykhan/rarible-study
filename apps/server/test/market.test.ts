import { generateLargeCatalog, handWritten } from "@slabwatch/seed"
import { describe, expect, it } from "@effect/vitest"
import { describeSearch, emptySearch, isEmptySearch, parseSearch, searchWords } from "../src/search/query.ts"
import { parseMarketQuery } from "../src/web/market.ts"

const q = (s: string) => parseMarketQuery(new URLSearchParams(s))

describe("market query", () => {
  it("defaults to the 40 newest and ignores unknown values", () => {
    expect(q("")).toEqual({ set: null, grader: null, q: "", sort: "recent", offset: 0, limit: 40 })
    expect(q("set=X%20Y&grader=ABC&sort=cheapest&limit=5000&offset=-3")).toEqual({
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
    // Generated sets are valid ids; whether one exists is the search's business.
    expect(q("set=X050").set).toBe("X050")
    // Deep pages stop where search engines stop.
    expect(q("offset=250000").offset).toBe(10_000)
  })
})

describe("reading the search box", () => {
  const p = (s: string) => parseSearch(s)

  it("leaves card, kind and set words to the database", () => {
    expect(p("Ashen Wyrm")).toEqual({ ...emptySearch, words: ["ashen", "wyrm"] })
    expect(p("wyr")).toEqual({ ...emptySearch, words: ["wyr"] })
    expect(p("dragon, emberfall")).toEqual({ ...emptySearch, words: ["dragon", "emberfall"] })
    expect(isEmptySearch(p("   "))).toBe(true)
  })

  it("tells holo, reverse holo and non-holo apart", () => {
    expect(p("holo").finishes).toEqual(["holo"])
    expect(p("hologram").finishes).toEqual(["holo"])
    expect(p("reverse holo").finishes).toEqual(["reverse_holo"])
    expect(p("reverse-holo").finishes).toEqual(["reverse_holo"])
    expect(p("reverse").finishes).toEqual(["reverse_holo"])
    for (const s of ["non holo", "non-holo", "nonholo", "no holo"]) expect(p(s).finishes, s).toEqual(["non_holo"])
    expect(p("1st edition holo")).toEqual({ ...emptySearch, editions: ["first"], finishes: ["holo"] })
    expect(p("unlimited").editions).toEqual(["unlimited"])
  })

  it("reads graders by code or name, and drops the generic words in their names", () => {
    expect(p("NVG 10")).toEqual({ ...emptySearch, graders: ["NVG"], grades: [10] })
    expect(p("Northvale Grading")).toEqual({ ...emptySearch, graders: ["NVG"] })
    expect(p("quarry slab grading 9.5")).toEqual({ ...emptySearch, graders: ["QSG"], grades: [9.5] })
    expect(p("lantern card authentication")).toEqual({ ...emptySearch, graders: ["LCA"] })
    expect(p("graded card slab").words).toEqual([])
  })

  it("tells grades from card numbers, and reads minimum grades and price limits", () => {
    expect(p("10")).toEqual({ ...emptySearch, grades: [10] })
    expect(p("#010")).toEqual({ ...emptySearch, cardNumber: "010" })
    expect(p("#10")).toEqual({ ...emptySearch, cardNumber: "010" })
    expect(p("010")).toEqual({ ...emptySearch, cardNumber: "010" })
    for (const s of ["9+", "9 +", "9 and up", "9 or better", "at least 9", "min 9"]) expect(p(s), s).toEqual({ ...emptySearch, minGrade: 9 })
    for (const s of ["under 100", "under $100", "<100", "< 100", "less than 100", "up to 100", "max 100"]) {
      expect(p(s), s).toEqual({ ...emptySearch, maxUsdCents: 10_000 })
    }
    expect(p("below 1.5k").maxUsdCents).toBe(150_000)
    expect(p("wyrm under 50 under 80").maxUsdCents).toBe(5_000)
    // A bare price says nothing about up or down: shown as ignored, not matched as a card number.
    expect(p("$100")).toEqual({ ...emptySearch, ignored: ["$100"] })
  })

  it("finds sellers by @handle or a full handle, and certs by number", () => {
    expect(p("@vaultkeeper").handles).toEqual([{ handle: "vaultkeeper", orWords: [] }])
    expect(p("holo_harbor").handles).toEqual([{ handle: "holo_harbor", orWords: ["holo", "harbor"] }])
    // Plain "holo" is the finish, never the start of a seller's handle.
    expect(p("holo").handles).toEqual([])
    expect(p("cert NVG12345678")).toEqual({ ...emptySearch, cert: "NVG12345678" })
  })

  it("never swallows a word the catalog uses", () => {
    for (const catalog of [handWritten, generateLargeCatalog()]) {
      for (const c of catalog.cards) {
        const set = catalog.setById(c.setId)
        for (const w of [...searchWords(c.name), ...c.kinds, ...searchWords(set.name)]) {
          expect(p(w).words, `${w} (${c.id})`).toEqual([w])
        }
      }
    }
  })

  it("labels what it understood", () => {
    expect(describeSearch(p("ashen wyrm NVG 10 1st edition holo under 900"), ["vaultkeeper"])).toEqual([
      "Northvale Grading",
      "grade 10",
      "1st edition",
      "holo",
      "900 dUSD or less",
      "seller @vaultkeeper",
      '"ashen wyrm"'
    ])
  })
})
