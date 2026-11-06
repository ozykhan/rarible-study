import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"
import type { MarketQuery } from "../search/query.ts"
import { SearchService, STATS_TTL } from "../search/SearchService.ts"

/**
 * Times market searches against whatever database DATABASE_URL and DB_SCHEMA
 * point at, through the same SearchService the API uses. Load the large seed
 * first (pnpm db:seed:large) for numbers that mean something.
 *
 *   pnpm bench:search            20 runs of each search, then 50 at once
 *   BENCH_RUNS=50 pnpm bench:search
 */
const searches: ReadonlyArray<readonly [string, Partial<MarketQuery>]> = [
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
  ["deep page", { q: "holo", offset: 5000 }]
]

const percentile = (xs: ReadonlyArray<number>, p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const search = yield* SearchService
  const runs = Number.parseInt(process.env["BENCH_RUNS"] ?? "20", 10)
  const [size] = yield* sql<{ readonly listings: number; readonly cards: number }>`
    SELECT (SELECT count(*)::int FROM listing_search) AS listings, (SELECT count(*)::int FROM cards) AS cards`
  const lines = [
    `${size?.listings} active listings, ${size?.cards} cards. ${runs} runs each after one warm-up; times in ms.`,
    "",
    "| search | matches | p50 | p95 |",
    "| --- | ---: | ---: | ---: |"
  ]
  const query = (over: Partial<MarketQuery>): MarketQuery => ({ set: null, grader: null, q: "", sort: "recent", offset: 0, limit: 40, ...over })
  for (const [name, over] of searches) {
    const first = yield* search.search(query(over))
    const times: Array<number> = []
    for (let i = 0; i < runs; i++) {
      const t = performance.now()
      yield* search.search(query(over))
      times.push(performance.now() - t)
    }
    const shown =
      first.suggestion !== null ? `0 (did you mean "${first.suggestion}")` : first.exact ? String(first.total) : "10,000+"
    lines.push(`| ${name} | ${shown} | ${percentile(times, 50).toFixed(1)} | ${percentile(times, 95).toFixed(1)} |`)
  }
  // The whole-market numbers are cached for STATS_TTL; this is what one refresh costs.
  const statTimes: Array<number> = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    yield* sql`SELECT set_id, count(*)::int AS count, min(usd_cents)::float8 AS floor FROM listing_search GROUP BY set_id`
    statTimes.push(performance.now() - t)
  }
  lines.push("", `Whole-market numbers, recomputed once every ${STATS_TTL}: ${percentile(statTimes, 50).toFixed(0)} ms.`)
  // Every search at once: the pool has 10 connections, as in production.
  const all = Array.from({ length: 50 }, (_, i) => query(searches[i % searches.length]![1]))
  const t = performance.now()
  yield* Effect.forEach(all, (q) => search.search(q), { concurrency: 50 })
  const ms = performance.now() - t
  lines.push("", `50 searches at once: ${ms.toFixed(0)} ms in all, about ${Math.round(50 / (ms / 1000))} searches a second.`)
  yield* Effect.sync(() => console.log(lines.join("\n")))
})

program.pipe(Effect.provide(ReposLive), Effect.provide(LoggingLive), NodeRuntime.runMain)
