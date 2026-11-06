import { cardById, sellers, setById, toUsdCents } from "@slabwatch/seed"
import { expect, layer } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { parseSearch, searchWords, type MarketQuery, type MarketSort } from "../src/search/query.ts"
import { SearchService } from "../src/search/SearchService.ts"
import { seed, testLayer } from "./db.ts"

const TestLive = testLayer("search")

const query = (over: Partial<MarketQuery> = {}): MarketQuery => ({
  set: null,
  grader: null,
  q: "",
  sort: "recent",
  offset: 0,
  limit: 100,
  ...over
})

/** The seed's active listings with what search sees, worked out in plain TypeScript. */
const rows = seed.listings
  .filter((x) => x.listing.status === "active")
  .map(({ listing: l, vaultItem: v }) => {
    const card = cardById(v.cardId)
    const set = setById(card.setId)
    return {
      id: l.id,
      setId: set.id,
      cardNumber: card.number,
      edition: v.edition,
      finish: v.finish,
      grader: v.grader,
      grade: v.grade,
      cert: v.certNumber,
      sellerId: l.sellerId,
      usd: toUsdCents(l.priceMinor, l.currency),
      minutesAgo: l.listedMinutesAgo,
      words: [...searchWords(card.name), ...card.kinds, ...searchWords(set.name), set.code.toLowerCase()]
    }
  })
type Row = (typeof rows)[number]
const handleToId = new Map(sellers.map((s) => [s.handle, s.id]))

/** What a search should return, by the rules in search/query.ts, without SQL. */
const oracle = (q: string, grader: string | null = null): Array<Row> => {
  const p = parseSearch(q)
  const sellerIds: Array<string> = []
  const words = [...p.words]
  for (const h of p.handles) {
    const id = handleToId.get(h.handle)
    if (id !== undefined) sellerIds.push(id)
    else if (h.orWords.length === 0) return []
    else words.push(...h.orWords.filter((w) => !words.includes(w)))
  }
  return rows.filter(
    (r) =>
      words.every((w) => r.words.some((x) => x.startsWith(w))) &&
      // No card is tagged in this file (tags.db.test.ts covers tags), so a tag word matches by its words alone.
      p.tags.every((t) => t.words.every((w) => r.words.some((x) => x.startsWith(w)))) &&
      (grader === null || r.grader === grader) &&
      (p.graders.length === 0 || p.graders.includes(r.grader)) &&
      (p.editions.length === 0 || p.editions.includes(r.edition)) &&
      (p.finishes.length === 0 || p.finishes.includes(r.finish)) &&
      (p.grades.length === 0 || p.grades.includes(r.grade)) &&
      (p.minGrade === null || r.grade >= p.minGrade) &&
      (p.maxUsdCents === null || r.usd <= p.maxUsdCents) &&
      (p.cardNumber === null || r.cardNumber === p.cardNumber) &&
      (p.cert === null || r.cert === p.cert) &&
      (sellerIds.length === 0 || sellerIds.includes(r.sellerId))
  )
}

const by = (sort: MarketSort) => (a: Row, b: Row) => {
  const recent = a.minutesAgo - b.minutesAgo || a.id.localeCompare(b.id)
  switch (sort) {
    case "recent":
      return recent
    case "price_asc":
      return a.usd - b.usd || recent
    case "price_desc":
      return b.usd - a.usd || b.minutesAgo - a.minutesAgo || b.id.localeCompare(a.id)
    case "grade":
      return b.grade - a.grade || recent
  }
}

const underscoreSeller = sellers.find((s) => s.handle.includes("_"))!
const plainSeller = sellers.find((s) => !s.handle.includes("_"))!
const someCert = rows[17]!.cert

const SEARCHES = [
  "ashen wyrm",
  "wyr",
  "holo",
  "reverse holo",
  "non-holo",
  "1st edition holo",
  "NVG 10",
  "northvale card grading",
  "dragon",
  "water holo",
  "emberfall 9+",
  "under 100",
  "dragon NVG under 500",
  "#010",
  "010",
  "ef",
  `@${plainSeller.handle}`,
  underscoreSeller.handle,
  `${underscoreSeller.handle} holo`,
  someCert,
  "unlimited reverse 8 and up"
]

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("market search against Postgres", (it) => {
  it.effect("returns exactly the listings the rules describe, counted per set", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      let nonEmpty = 0
      for (const q of SEARCHES) {
        for (const grader of [null, "QSG"] as const) {
          const want = oracle(q, grader)
          const got = yield* search.search(query({ q, grader }))
          expect(got.total, `${q} / ${grader}`).toBe(want.length)
          expect(got.ids, `${q} / ${grader}`).toEqual([...want].sort(by("recent")).slice(0, 100).map((r) => r.id))
          const perSet: Record<string, number> = {}
          for (const r of want) perSet[r.setId] = (perSet[r.setId] ?? 0) + 1
          for (const [id, n] of Object.entries(got.counts.sets)) expect(n, `${q} ${id}`).toBe(perSet[id] ?? 0)
          if (want.length > 0) nonEmpty++
        }
      }
      // Guard against a test that passes because every search matches nothing.
      expect(nonEmpty).toBeGreaterThan(SEARCHES.length)
    }))

  it.effect("sorts and pages in a stable order, one set at a time", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      for (const sort of ["recent", "price_asc", "price_desc", "grade"] as const) {
        for (const [q, set] of [["", null], ["holo", null], ["", "EF"], ["dragon", "TW"]] as const) {
          const want = oracle(q)
            .filter((r) => set === null || r.setId === set)
            .sort(by(sort))
            .map((r) => r.id)
          const pages: Array<string> = []
          for (let offset = 0; offset < want.length; offset += 30) {
            pages.push(...(yield* search.search(query({ q, set, sort, offset, limit: 30 }))).ids)
          }
          expect(pages, `${sort} ${q} ${set}`).toEqual(want)
        }
      }
    }))

  it.effect("says what it understood, and suggests a fix for a misspelled word", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      const typo = yield* search.search(query({ q: "Ashen Wyrn NVG" }))
      expect(typo.total).toBe(0)
      expect(typo.suggestion).toBe("Ashen wyrm NVG")
      expect((yield* search.search(query({ q: "Ashen wyrm NVG" }))).total).toBeGreaterThan(0)
      expect(typo.understood).toEqual(["Northvale Grading", '"ashen wyrn"'])

      // Nothing close enough: no suggestion. A seller nobody is: nothing, and nothing to suggest.
      expect((yield* search.search(query({ q: "qqqxz" }))).suggestion).toBeNull()
      const nobody = yield* search.search(query({ q: "@nobody_here" }))
      expect([nobody.total, nobody.suggestion]).toEqual([0, null])

      // A known word with no listing right now is not a typo.
      const quiet = yield* search.search(query({ q: "ashen wyrm reverse holo 1" }))
      expect([quiet.total, quiet.suggestion]).toEqual([0, null])

      // An unknown set id is ignored rather than refused.
      expect((yield* search.search(query({ set: "NOPE" }))).total).toBe(rows.length)
    }))

  it.effect("the whole market's numbers and the set tabs", () =>
    Effect.gen(function* () {
      const search = yield* SearchService
      const all = yield* search.search(query())
      expect(all.total).toBe(rows.length)
      expect(all.stats.count).toBe(rows.length)
      expect(all.stats.setCount).toBe(4)
      expect(all.stats.floorUnits).toBe(Math.min(...rows.map((r) => r.usd)))
      expect(all.sets.map((s) => s.id)).toEqual(["OS", "TW", "EF", "SE"])
      expect(all.sets[0]).toEqual({ id: "OS", name: "Origin Set" })
      for (const s of all.sets) expect(all.stats.sets[s.id]!.count).toBe(rows.filter((r) => r.setId === s.id).length)
    }))

  it.effect("triggers keep the search table in step with listings", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient
      const search = yield* SearchService
      const catalog = yield* CatalogRepo
      // A vault item listed once: the seed also lists some twice, and those share a cert.
      const target = rows.find((r) => r.usd > 200 && rows.filter((x) => x.cert === r.cert).length === 1)!
      const byCert = (cert: string) => search.search(query({ q: cert }))

      // A price change moves the listing in price order; the trigger recomputes its dUSD amount.
      yield* sql`UPDATE listings SET price_minor = 100, currency = 'USD' WHERE id = ${target.id}`
      expect((yield* search.search(query({ q: `${target.cert} under 1.00` }))).ids).toEqual([target.id])

      // Sold or withdrawn: gone from search, still readable by id.
      yield* sql`UPDATE listings SET status = 'sold' WHERE id = ${target.id}`
      expect((yield* byCert(target.cert)).total).toBe(0)
      expect((yield* catalog.getListing(target.id))?.status).toBe("sold")

      // A new listing is searchable as soon as it is written.
      const fresh = seed.listings[0]!
      const copy = {
        ...fresh,
        vaultItem: { ...fresh.vaultItem, id: "VLT-900001", certNumber: "QSG99990001" },
        listing: { ...fresh.listing, id: "G-900001", vaultItemId: "VLT-900001", source: "generator" as const }
      }
      yield* catalog.insertListings([copy])
      expect((yield* byCert("QSG99990001")).ids).toEqual(["G-900001"])

      // A renamed card carries its new name to its listings.
      yield* sql`UPDATE cards SET name = 'Glasswing Test' WHERE id = ${copy.vaultItem.cardId}`
      expect((yield* search.search(query({ q: "glasswing" }))).ids).toContain("G-900001")
    }))
})
