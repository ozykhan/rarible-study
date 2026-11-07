/**
 * Best match measured against newest first, on the large generated catalog.
 *
 *   pnpm --filter @slabwatch/evals eval:rank -- run1
 *
 * Needs a database with the large seed, tags and search vectors, in DB_SCHEMA
 * (default "bench"): pnpm db:seed:large, pnpm tags:run, pnpm vectors:run. No
 * model call: the query vectors come from the local embedder, so a run is free.
 *
 * For every case (rankingDataset.ts) the same search runs in both orders and
 * the first 20 listings are judged by the generator's own lore. Reported:
 * precision at 10 and 20 (the share of those listings whose card fits), the
 * reciprocal rank of the first card that fits, how many different cards the
 * first 20 listings show, and the time per search. Each run writes
 * results/search-ranking-<label>.json and rewrites results/search-ranking.md.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import {
  CardVectors,
  CardVectorsLive,
  Embedder,
  parseSearch,
  ReposLive,
  SearchService,
  termsQuery,
  type MarketQuery,
  type MarketSort
} from "@slabwatch/server"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { rankingCases, type RankingCase } from "./rankingDataset.ts"

const args = process.argv.slice(2).filter((a) => a !== "--")
const label = args.find((a) => !a.startsWith("--")) ?? "latest"
if (!/^[a-z0-9_-]+$/.test(label)) throw new Error(`label ${label} must be lowercase letters, digits, - or _`)
process.env["DB_SCHEMA"] ??= "bench"

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, "..", "results")
const TOP = 20
const RUNS = 5

const SORTS = ["relevance", "recent"] as const satisfies ReadonlyArray<MarketSort>
type Judged = { readonly p10: number; readonly p20: number; readonly rr: number; readonly cards: number; readonly ms: number }
type CaseResult = RankingCase & {
  readonly candidates: number
  readonly fitting: number
  readonly firstSearchMs: number
  readonly relevance: Judged
  readonly recent: Judged
}

const percentile = (xs: ReadonlyArray<number>, p: number) => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
}
const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits

/** One row per run, from every run's JSON, oldest first. */
const writeSummaryTable = () => {
  const runs = readdirSync(resultsDir)
    .filter((f) => /^search-ranking-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(resultsDir, f), "utf8")))
    .sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)))
  const rows = runs.map((r) => {
    const b = r.summary.relevance
    const n = r.summary.recent
    return (
      `| ${r.label} | ${String(r.ranAt).slice(0, 16).replace("T", " ")} | ${r.commit ?? ""} | ${r.listings.toLocaleString("en-US")} | ${r.summary.cases} | ` +
      `${b.p10.toFixed(2)} / ${n.p10.toFixed(2)} | ${b.p20.toFixed(2)} / ${n.p20.toFixed(2)} | ${b.mrr.toFixed(2)} / ${n.mrr.toFixed(2)} | ` +
      `${r.summary.baseRate.toFixed(2)} | ${b.cards.toFixed(1)} / ${n.cards.toFixed(1)} | ${b.msP50} / ${b.msP95} | ${n.msP50} / ${n.msP95} | ${r.summary.firstSearchMsP50} |`
    )
  })
  writeFileSync(
    join(resultsDir, "search-ranking.md"),
    "# Best match\n\n" +
      "One row per run of `pnpm eval:rank`, oldest first; the JSON next to this file has every case. " +
      "Pairs are Best match / newest first, over the first 20 listings of each search. " +
      "The base rate is the share of the cards each search matches that fit, so newest first should land near it. " +
      "Times are one search end to end, warm; the first search also embeds the query.\n\n" +
      "| Run | Ran at (UTC) | Commit | Listings | Cases | Precision at 10 | Precision at 20 | MRR | Base rate | Cards in first 20 | Best match ms, p50 / p95 | Newest ms, p50 / p95 | First search ms, p50 |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
      rows.join("\n") +
      "\n"
  )
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const search = yield* SearchService
  const vectors = yield* CardVectors
  const embedder = yield* Embedder

  const [size] = yield* sql<{ readonly cards: number; readonly listings: number }>`
    SELECT (SELECT count(*)::int FROM cards) AS cards, (SELECT count(*)::int FROM listing_search) AS listings`
  const queued = yield* vectors.queued
  if ((size?.cards ?? 0) < 10_000 || queued > 0) {
    return yield* Effect.fail(
      new Error(
        `${size?.cards ?? 0} cards, ${queued} without a current search vector: load the large catalog first ` +
          "(pnpm db:seed:large, pnpm tags:run, pnpm vectors:run) and point DB_SCHEMA at it"
      )
    )
  }

  /** Whether each card id fits the case, by the generator's lore. */
  const fits = (c: RankingCase, cardIds: ReadonlyArray<string>) =>
    cardIds.length === 0
      ? Effect.succeed(new Set<string>())
      : sql<{ readonly id: string }>`
          SELECT id FROM cards WHERE id IN ${sql.in(cardIds)}
            AND strpos(catalog_text, ${c.lore}) > 0 AND (${c.kind ?? null}::text IS NULL OR kinds[1] = ${c.kind ?? null})`.pipe(
          Effect.map((rows) => new Set(rows.map((r) => r.id)))
        )

  const query = (c: RankingCase, sort: MarketSort): MarketQuery => ({
    set: null, grader: null, q: c.q, from: c.from, fit: "", sort, offset: 0, limit: TOP
  })

  const cases: Array<CaseResult> = []
  for (const c of rankingCases) {
    const p = parseSearch(c.q)
    const terms = termsQuery(p.words, p.tags)
    const [base] = yield* sql<{ readonly candidates: number; readonly fitting: number }>`
      SELECT count(*)::int AS candidates,
             count(*) FILTER (WHERE strpos(catalog_text, ${c.lore}) > 0 AND (${c.kind ?? null}::text IS NULL OR kinds[1] = ${c.kind ?? null}))::int AS fitting
      FROM cards WHERE search_terms @@ ${terms}::tsquery`
    const judged: Record<string, Judged> = {}
    let firstSearchMs = 0
    for (const sort of SORTS) {
      const t0 = performance.now()
      const found = yield* search.search(query(c, sort))
      if (sort === "relevance") firstSearchMs = Math.round(performance.now() - t0)
      if (found.sort !== sort) return yield* Effect.fail(new Error(`${c.from}: asked for ${sort}, got ${found.sort}`))
      const times: Array<number> = []
      for (let i = 0; i < RUNS; i++) {
        const t = performance.now()
        yield* search.search(query(c, sort))
        times.push(performance.now() - t)
      }
      const rows = yield* sql<{ readonly listingId: string; readonly cardId: string }>`
        SELECT listing_id, card_id FROM listing_search WHERE listing_id IN ${sql.in(found.ids)}`
      const cardOf = new Map(rows.map((r) => [r.listingId, r.cardId]))
      const cardIds = found.ids.map((id) => cardOf.get(id) ?? "")
      const good = yield* fits(c, cardIds)
      const hits = cardIds.map((id) => good.has(id))
      const firstHit = hits.indexOf(true)
      judged[sort] = {
        p10: hits.slice(0, 10).filter(Boolean).length / Math.min(10, hits.length || 1),
        p20: hits.filter(Boolean).length / (hits.length || 1),
        rr: firstHit < 0 ? 0 : 1 / (firstHit + 1),
        cards: new Set(cardIds).size,
        ms: percentile(times, 50)
      }
    }
    const row: CaseResult = {
      ...c,
      candidates: base?.candidates ?? 0,
      fitting: base?.fitting ?? 0,
      firstSearchMs,
      relevance: judged["relevance"]!,
      recent: judged["recent"]!
    }
    cases.push(row)
    const b = row.relevance
    const n = row.recent
    yield* Effect.logInfo(
      `${c.from}: P@20 ${b.p20.toFixed(2)} vs ${n.p20.toFixed(2)} newest (base ${(row.fitting / Math.max(1, row.candidates)).toFixed(2)}), ` +
        `${Math.round(b.ms)} ms vs ${Math.round(n.ms)} ms`
    )
  }

  const by = (sort: (typeof SORTS)[number]) => {
    const js = cases.map((c) => c[sort])
    return {
      p10: round(mean(js.map((j) => j.p10))),
      p20: round(mean(js.map((j) => j.p20))),
      mrr: round(mean(js.map((j) => j.rr))),
      cards: round(mean(js.map((j) => j.cards)), 1),
      msP50: Math.round(percentile(js.map((j) => j.ms), 50)),
      msP95: Math.round(percentile(js.map((j) => j.ms), 95))
    }
  }
  const summary = {
    cases: cases.length,
    baseRate: round(mean(cases.map((c) => c.fitting / Math.max(1, c.candidates)))),
    relevance: by("relevance"),
    recent: by("recent"),
    firstSearchMsP50: Math.round(percentile(cases.map((c) => c.firstSearchMs), 50))
  }
  let commit: string | null = null
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  } catch {
    commit = null
  }
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(
    join(resultsDir, `search-ranking-${label}.json`),
    JSON.stringify(
      { label, ranAt: new Date().toISOString(), commit, embedder: embedder.model, cards: size?.cards, listings: size?.listings, summary, cases },
      null,
      2
    ) + "\n"
  )
  writeSummaryTable()
  yield* Effect.logInfo(`summary: ${JSON.stringify(summary)}`)
})

program.pipe(Effect.provide(CardVectorsLive.pipe(Layer.provideMerge(ReposLive))), NodeRuntime.runMain)
