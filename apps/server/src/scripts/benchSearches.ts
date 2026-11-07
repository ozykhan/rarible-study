import type { MarketQuery } from "../search/query.ts"

/** The searches the benchmarks time: every kind of search the market page makes, on the large catalog's words. */
export const BENCH_SEARCHES: ReadonlyArray<readonly [string, Partial<MarketQuery>]> = [
  ["home page (newest)", {}],
  ["cheapest first", { sort: "price_asc" }],
  ["highest grade first", { sort: "grade" }],
  ["one set", { set: "X050" }],
  ["card name", { q: "ashen wyrm" }],
  ["half a word", { q: "wyr" }],
  ["kind", { q: "dragon" }],
  ["finish (a third of the market)", { q: "holo" }],
  ["grader and grade", { q: "NVG 10" }],
  ["kind, finish, price", { q: "dragon holo under 200" }],
  ["set name and min grade", { q: "emberfall 9+" }],
  ["word, cheapest first", { q: "tide", sort: "price_asc" }],
  ["seller", { q: "@vaultkeeper" }],
  ["typo (did you mean)", { q: "ashen wyrn" }],
  ["described: tag", { q: "sea animal" }],
  ["described: two tags and a finish", { q: "glowing sea creature holo" }],
  ["described: tags, grade, price", { q: "flying fire 9+ under 300" }],
  ["described: tag and a name word", { q: "flying owl" }],
  ["deep page", { q: "holo", offset: 5000 }],
  ["best match: tag", { q: "sea animal", sort: "relevance" }],
  ["best match: tag, ranked by typed words", { q: "dragon", from: "dragon sitting on a pile of treasure", sort: "relevance" }],
  ["best match: two tags and a finish", { q: "glowing sea creature holo", sort: "relevance" }],
  ["best match: tags, grade, price", { q: "flying fire 9+ under 300", sort: "relevance" }],
  ["best match: deep page", { q: "dragon", sort: "relevance", offset: 5000 }]
]


export const percentile = (xs: ReadonlyArray<number>, p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0
}

export const benchQuery = (over: Partial<MarketQuery>): MarketQuery => ({
  set: null,
  grader: null,
  q: "",
  sort: "recent",
  from: "",
  fit: "",
  offset: 0,
  limit: 40,
  ...over
})
