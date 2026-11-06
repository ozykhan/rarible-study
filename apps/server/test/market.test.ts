import { generateLargeCatalog, handWritten } from "@slabwatch/seed"
import { describe, expect, it } from "@effect/vitest"
import { describeSearch, emptySearch, isEmptySearch, parseSearch, searchWords, type ParsedSearch } from "../src/search/query.ts"
import { TAGS } from "../src/tags/vocabulary.ts"
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
    expect(p("wyrm, emberfall")).toEqual({ ...emptySearch, words: ["wyrm", "emberfall"] })
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

  it("reads described words as tags, keeping the words as another way to match", () => {
    expect(p("sea animal with hologram")).toEqual({
      ...emptySearch,
      tags: [{ tag: "sea_creature", words: ["sea", "animal"] }],
      finishes: ["holo"]
    })
    expect(p("Sea creatures").tags).toEqual([{ tag: "sea_creature", words: ["sea", "creatures"] }])
    expect(p("sea").tags).toEqual([{ tag: "sea_creature", words: ["sea"] }])
    // Longest phrase first: "fire breathing" is one tag, not fire plus a word.
    expect(p("flying fire breathing dragons")).toEqual({
      ...emptySearch,
      tags: [
        { tag: "flies", words: ["flying"] },
        { tag: "breathes_fire", words: ["fire", "breathing"] },
        { tag: "dragon", words: ["dragons"] }
      ]
    })
    expect(p("big cat").tags).toEqual([{ tag: "cat", words: ["big", "cat"] }])
    expect(p("big").tags).toEqual([{ tag: "giant", words: ["big"] }])
    // One tag asked for twice counts once.
    expect(p("ocean marine").tags).toEqual([{ tag: "sea_creature", words: ["ocean"] }])
    expect(p("glowing moth NVG 10")).toMatchObject({ tags: [{ tag: "glows" }], words: ["moth"], graders: ["NVG"], grades: [10] })
    expect(isEmptySearch(p("flying"))).toBe(false)
  })

  it("keeps tag words apart from words with a fixed meaning", () => {
    const phrases = TAGS.flatMap((t) => t.words)
    expect(new Set(phrases).size).toBe(phrases.length)
    expect(new Set(TAGS.map((t) => t.id)).size).toBe(TAGS.length)
    for (const t of TAGS) {
      // Ids become "#id" lexemes in a tsquery: no quoting needed.
      expect(t.id).toMatch(/^[a-z_]+$/)
      for (const phrase of t.words) {
        expect(phrase).toMatch(/^[a-z]+( [a-z]+)*$/)
        // Read alone, each phrase is its own tag and nothing else: no grader, edition, finish or stopword inside.
        expect(p(phrase), phrase).toEqual({ ...emptySearch, tags: [{ tag: t.id, words: phrase.split(" ") }] })
      }
    }
  })

  it("never swallows a word the catalog uses", () => {
    // A tag word still matches as a word too (see TagFilter), so it counts as kept.
    const kept = (s: ParsedSearch) => [...s.words, ...s.tags.flatMap((t) => t.words)]
    for (const catalog of [handWritten, generateLargeCatalog()]) {
      for (const c of catalog.cards) {
        const set = catalog.setById(c.setId)
        for (const w of [...searchWords(c.name), ...c.kinds, ...searchWords(set.name)]) {
          expect(kept(p(w)), `${w} (${c.id})`).toEqual([w])
        }
      }
    }
  })

  it("labels what it understood", () => {
    expect(describeSearch(p("glowing sea animal holo"))).toEqual(["glowing", "sea creatures", "holo"])
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
