import { generateLargeCatalog, handWritten } from "@slabwatch/seed"
import { describe, expect, it } from "@effect/vitest"
import {
  defaultSort,
  describedWords,
  describeSearch,
  emptySearch,
  isEmptySearch,
  isStopword,
  parseSearch,
  searchChips,
  searchText,
  searchWords,
  type ParsedSearch
} from "../src/search/query.ts"
import { TAGS } from "../src/tags/vocabulary.ts"
import { parseMarketQuery } from "../src/web/market.ts"

const q = (s: string) => parseMarketQuery(new URLSearchParams(s))

describe("market query", () => {
  it("defaults to the first 40 in the search's own order and ignores unknown values", () => {
    expect(q("")).toEqual({ set: null, grader: null, q: "", sort: null, from: "", fit: "", offset: 0, limit: 40 })
    expect(q("set=X%20Y&grader=ABC&sort=cheapest&limit=5000&offset=-3")).toEqual({
      set: null,
      grader: null,
      q: "",
      sort: null,
      from: "",
      fit: "",
      offset: 0,
      limit: 100
    })
    expect(q("set=EF&grader=NVG&q=%20wyrm%20&sort=grade&offset=40&limit=20&from=%20a%20fiery%20wyrm&fit=%20fiery%20")).toEqual({
      set: "EF",
      grader: "NVG",
      q: "wyrm",
      sort: "grade",
      from: "a fiery wyrm",
      fit: "fiery",
      offset: 40,
      limit: 20
    })
    expect(q("sort=relevance").sort).toBe("relevance")
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
    expect(describeSearch(p("ashen wyrm NVG 10 1st edition holo under 900 @vaultkeeper"), ["vaultkeeper"])).toEqual([
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

describe("best match", () => {
  it("is the default for described searches only", () => {
    expect(defaultSort(parseSearch("sea animal with hologram"))).toBe("relevance")
    expect(defaultSort(parseSearch("flying creature"))).toBe("relevance")
    expect(defaultSort(parseSearch("ashen wyrm"))).toBe("recent")
    expect(defaultSort(parseSearch("holo nvg 10 under 50"))).toBe("recent")
    expect(defaultSort(parseSearch(""))).toBe("recent")
  })

  it("ranks by the words that describe a card, in the order typed", () => {
    expect(describedWords("dragon that guards treasure")).toEqual(["dragon", "that", "guards", "treasure"])
    expect(describedWords("a bird made of lightning")).toEqual(["bird", "made", "lightning"])
    // What is about the slab or the listing is not about the card.
    expect(describedWords("sea animal with hologram, NVG 9+ under $50 @vaultkeeper")).toEqual(["sea", "animal"])
    expect(describedWords("glowing moth glowing")).toEqual(["glowing", "moth"])
    expect(describedWords("holo 1st edition")).toEqual([])
  })
})

describe("writing a search back as text", () => {
  const p = parseSearch
  const back = (x: ParsedSearch) => parseSearch(searchText(x))
  const noIgnored = (x: ParsedSearch) => ({ ...x, ignored: [] })

  it("reads back as the same search", () => {
    for (const q of [
      "",
      "ashen wyrm",
      "sea animal with hologram",
      "glowing sea creatures holo 9+",
      "ashen wyrm NVG 10 1st edition holo under 900 @vaultkeeper",
      "qsg lca 9.5 8 reverse holo unlimited #010 less than $50",
      "non holo emberfall at least 8 cert nvg12345678",
      "holo_harbor big cat outer space",
      "breathes fire wyrm $100",
      "fire, breathing"
    ]) {
      expect(noIgnored(back(p(q))), q).toEqual(noIgnored(p(q)))
    }
  })

  it("keeps tags apart, whatever sits next to them", () => {
    const first = TAGS.map((t) => ({ tag: t.id, words: t.words[0]!.split(" ") }))
    // Words that finish a tag phrase: next to the wrong tag, they would read as another tag.
    const tails = [...new Set(TAGS.flatMap((t) => t.words.flatMap((w) => w.split(" ").slice(1))))]
    for (const a of first) {
      for (const b of first) {
        if (a.tag === b.tag) continue
        const both: ParsedSearch = { ...emptySearch, tags: [a, b] }
        expect(back(both), `${a.tag} ${b.tag}`).toEqual(both)
      }
      for (const w of tails) {
        // A filler word ("creature" in "sea creature") is never a search word of its own.
        if (isStopword(w) || TAGS.some((t) => t.words.some((x) => x === w || x.split(" ")[0] === w))) continue
        const mixed: ParsedSearch = { ...emptySearch, tags: [a], words: [w] }
        expect(back(mixed), `${a.tag} ${w}`).toEqual(mixed)
      }
    }
  })

  it("treats a comma as the end of a phrase, and digits around one as a number", () => {
    expect(p("fire breathing").tags.map((t) => t.tag)).toEqual(["breathes_fire"])
    expect(p("fire, breathing")).toMatchObject({ tags: [{ tag: "fire", words: ["fire"] }], words: ["breathing"] })
    expect(p("under $1,000").maxUsdCents).toBe(100_000)
  })

  it("gives every filter a chip that removes it", () => {
    expect(searchChips(p("sea animal holo under 50"))).toEqual([
      { label: "sea creatures", q: "holo, under 50" },
      { label: "holo", q: "sea animal, under 50" },
      { label: "50 dUSD or less", q: "sea animal, holo" }
    ])
    expect(searchChips(p("ashen wyrm @vaultkeeper"), ["vaultkeeper"])).toEqual([
      { label: "seller @vaultkeeper", q: "ashen wyrm" },
      { label: '"ashen wyrm"', q: "@vaultkeeper" }
    ])
  })
})
