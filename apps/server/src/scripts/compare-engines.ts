import { execSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { BaseLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"
import { OpenSearch, OpenSearchLive } from "../search/opensearch/OpenSearch.ts"
import { SearchServiceOpenSearch } from "../search/opensearch/SearchServiceOpenSearch.ts"
import { SearchService, SearchServicePg, type MarketSearchResult } from "../search/SearchService.ts"
import { BENCH_SEARCHES, benchQuery, percentile } from "./benchSearches.ts"

/**
 * Runs every benchmark search on Postgres and on the copy in OpenSearch,
 * checks the two give the same answer (the same page of listings in the same
 * order, the same counts, the same chips and "did you mean"), and times both.
 * Also checks the word lookups described search relies on, for every catalog
 * word and a few misspellings of each. Writes evals/results/search-engines.md.
 *
 * Copy the catalog first (pnpm search:sync copy) with the same DB_SCHEMA.
 *
 *   DB_SCHEMA=bench pnpm bench:engines
 */

const here = dirname(fileURLToPath(import.meta.url))
const resultsFile = join(here, "..", "..", "..", "..", "evals", "results", "search-engines.md")

/** Which parts of two answers differ. Stats are compared on their own: each engine caches them. */
const differences = (a: MarketSearchResult, b: MarketSearchResult): ReadonlyArray<string> => {
  const out: Array<string> = []
  for (const key of Object.keys(a) as Array<keyof MarketSearchResult>) {
    if (key === "stats") continue
    if (JSON.stringify(sorted(a[key])) !== JSON.stringify(sorted(b[key]))) out.push(key)
  }
  return out
}

/** Object keys in order, so two records with the same entries compare equal. */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, sorted(x)]))
      : v

/** Misspellings a shopper makes: a letter dropped, two swapped, one doubled, and the first three letters typed so far. */
const probesFor = (term: string): ReadonlyArray<string> => {
  if (term.length < 4) return [term]
  const mid = Math.floor(term.length / 2)
  return [
    term,
    term.slice(0, 3),
    term.slice(0, mid) + term.slice(mid + 1),
    term.slice(0, mid - 1) + term[mid] + term[mid - 1] + term.slice(mid + 1),
    term.slice(0, mid) + term[mid] + term.slice(mid)
  ]
}

const chunks = <A>(xs: ReadonlyArray<A>, n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

const fmt = (ms: number) => (ms < 10 ? ms.toFixed(1) : ms.toFixed(0))

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const engine = yield* OpenSearch
  const pg = Context.get(yield* Layer.build(SearchServicePg), SearchService)
  const os = Context.get(yield* Layer.build(SearchServiceOpenSearch), SearchService)
  const runs = Number.parseInt(process.env["BENCH_RUNS"] ?? "20", 10)

  const [size] = yield* sql<{ readonly listings: number; readonly cards: number; readonly bytes: number }>`
    SELECT (SELECT count(*)::int FROM listing_search) AS listings, (SELECT count(*)::int FROM cards) AS cards,
           pg_total_relation_size('listing_search')::float8 AS bytes`
  const indices = (yield* engine.call("GET", `/_cat/indices/${engine.indexes.listings},${engine.indexes.cards},${engine.indexes.words}?format=json&bytes=b`)) as ReadonlyArray<{
    readonly index: string
    readonly "docs.count": string
    readonly "store.size": string
  }>
  const listingIndex = indices.find((i) => i.index.startsWith(`${engine.indexes.listings}-`))
  const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

  const rows: Array<string> = []
  const mismatches: Array<string> = []
  let agree = 0
  for (const [name, over] of BENCH_SEARCHES) {
    const q = benchQuery(over)
    const a = yield* pg.search(q)
    const b = yield* os.search(q)
    const diff = differences(a, b)
    if (diff.length === 0) agree++
    else {
      const shared = a.ids.filter((id) => b.ids.includes(id)).length
      const firstDiff = a.ids.findIndex((id, i) => b.ids[i] !== id)
      mismatches.push(
        `- ${name}: ${diff.join(", ")} differ` +
          (diff.includes("ids") ? `; ${shared} of ${a.ids.length} listings on both pages, first difference at position ${firstDiff + 1}` : "")
      )
    }
    const time = (s: typeof pg) =>
      Effect.gen(function* () {
        // The whole-market numbers are cached for 10 seconds; read them first so no timed run pays for a refresh.
        yield* s.stats
        const times: Array<number> = []
        for (let i = 0; i < runs; i++) {
          const t = performance.now()
          yield* s.search(q)
          times.push(performance.now() - t)
        }
        return `${fmt(percentile(times, 50))} / ${fmt(percentile(times, 95))}`
      })
    const pgTime = yield* time(pg)
    const osTime = yield* time(os)
    const shown = a.suggestion !== null ? `0 (did you mean "${a.suggestion}")` : a.exact ? a.total.toLocaleString("en-US") : "10,000+"
    rows.push(`| ${name} | ${shown} | ${diff.length === 0 ? "yes" : "no"} | ${pgTime} | ${osTime} |`)
  }
  const statsAgree =
    JSON.stringify(sorted(yield* pg.stats)) === JSON.stringify(sorted(yield* os.stats)) ? "the same" : "different"

  // Every search at once: Postgres has a pool of 10 connections, as in production; OpenSearch one node.
  const burst = (s: typeof pg) =>
    Effect.gen(function* () {
      const all = Array.from({ length: 50 }, (_, i) => benchQuery(BENCH_SEARCHES[i % BENCH_SEARCHES.length]![1]))
      const t = performance.now()
      yield* Effect.forEach(all, (q) => s.search(q), { concurrency: 50 })
      return performance.now() - t
    })
  const pgBurst = yield* burst(pg)
  const osBurst = yield* burst(os)

  // The word lookups a described search makes: known words, and the closest catalog words to the unknown ones.
  const vocab = (yield* sql<{ readonly term: string }>`SELECT term FROM search_vocab ORDER BY term`).map((r) => r.term)
  const probes = [...new Set(vocab.flatMap(probesFor))]
  let wordsAgree = 0
  const wordMismatches: Array<string> = []
  for (const batch of chunks(probes, 100)) {
    const [k1, k2] = [yield* pg.knownWords(batch), yield* os.knownWords(batch)]
    const [c1, c2] = [yield* pg.closeWords(batch, 3, 0.2), yield* os.closeWords(batch, 3, 0.2)]
    const [d1, d2] = [yield* pg.closeWords(batch, 1), yield* os.closeWords(batch, 1)]
    for (const w of batch) {
      const same =
        k1.includes(w) === k2.includes(w) &&
        JSON.stringify(c1[w]) === JSON.stringify(c2[w]) &&
        JSON.stringify(d1[w]) === JSON.stringify(d2[w])
      if (same) wordsAgree++
      else if (wordMismatches.length < 10) wordMismatches.push(`- "${w}": Postgres ${JSON.stringify(c1[w])}, OpenSearch ${JSON.stringify(c2[w])}`)
    }
  }

  let commit: string | null = null
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  } catch {
    commit = null
  }
  const report = [
    "# Postgres and OpenSearch",
    "",
    "Written by `pnpm bench:engines` (apps/server/src/scripts/compare-engines.ts). Each benchmark search runs on both engines through the same SearchService; \"same answer\" means the same page of listings in the same order, the same counts per set, chips and \"did you mean\". Times are one search end to end from Node, warm, in ms.",
    "",
    `Ran at ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC on commit ${commit ?? "unknown"}. ${size?.listings.toLocaleString("en-US")} active listings, ${size?.cards.toLocaleString("en-US")} cards; ${runs} runs of each search after one warm-up. OpenSearch ${(yield* engine.call("GET", "/")).version.number}, one node, one shard.`,
    "",
    "| search | matches | same answer | Postgres p50 / p95 | OpenSearch p50 / p95 |",
    "| --- | ---: | --- | ---: | ---: |",
    ...rows,
    "",
    `${agree} of ${BENCH_SEARCHES.length} searches give the same answer on both.${mismatches.length === 0 ? "" : " The others:"}`,
    ...mismatches,
    "",
    `Whole-market numbers (listing count and floor per set): ${statsAgree}.`,
    "",
    `50 searches at once: Postgres ${fmt(pgBurst)} ms, OpenSearch ${fmt(osBurst)} ms.`,
    "",
    `Word lookups for described search, for ${vocab.length} catalog words and misspellings of each (${probes.length} words): ${wordsAgree} give the same known words and the same closest catalog words on both.${wordMismatches.length === 0 ? "" : " Some that do not:"}`,
    ...wordMismatches,
    "",
    `Size: listing_search with its indexes takes ${mb(size?.bytes ?? 0)} in Postgres; the listings index takes ${listingIndex === undefined ? "unknown" : mb(Number(listingIndex["store.size"]))} in OpenSearch.`,
    ""
  ].join("\n")
  mkdirSync(dirname(resultsFile), { recursive: true })
  writeFileSync(resultsFile, report)
  yield* Effect.sync(() => console.log(report))
}).pipe(Effect.scoped)

program.pipe(Effect.provide(OpenSearchLive.pipe(Layer.provideMerge(BaseLive))), Effect.provide(LoggingLive), NodeRuntime.runMain)
