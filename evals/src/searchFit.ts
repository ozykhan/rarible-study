/**
 * The rerank and cut measured on the large generated catalog.
 *
 *   ANTHROPIC_API_KEY=... pnpm --filter @slabwatch/evals eval:fit -- run1
 *
 * Needs the same database as eval:rank (pnpm db:seed:large, pnpm tags:run,
 * pnpm vectors:run, in DB_SCHEMA, default "bench") and a model key: one model
 * call per case, about $0.0003 each.
 *
 * Every case of rankingDataset.ts runs as the market runs it after a reading:
 * `q` filters, `from` ranks, and the rest of `from` (what no tag reads) is the
 * description the first 50 cards are judged against. Each habit also runs as
 * a description alone ("sitting on a pile of treasure"), with no filter, so
 * the 50 cards come from the whole catalog by meaning. A card fits when the
 * generator wrote the case's lore phrase into it; the place cases leave the
 * kind to the filter, since the judge is told every card already is one.
 *
 * Judgments for each description are deleted first, so every case calls the
 * model. Reported per case and on average: how many of the 50 fit, how many
 * the model kept, precision and recall of what it kept, precision at 20 of
 * the page before and after the cut, and the time and cost of the call. Each
 * run writes results/search-fit-<label>.json and rewrites results/search-fit.md.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import {
  CardFit,
  CardFitLive,
  CardVectors,
  CardVectorsLive,
  FIT_CANDIDATES,
  FIT_VERSION,
  fitKey,
  ReposLive,
  SearchService,
  type MarketQuery
} from "@slabwatch/server"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { rankingCases } from "./rankingDataset.ts"

const args = process.argv.slice(2).filter((a) => a !== "--")
const label = args.find((a) => !a.startsWith("--")) ?? "latest"
if (!/^[a-z0-9_-]+$/.test(label)) throw new Error(`label ${label} must be lowercase letters, digits, - or _`)
process.env["DB_SCHEMA"] ??= "bench"

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, "..", "results")
const TOP = 20

interface FitCase {
  readonly from: string
  readonly q: string
  readonly fit: string
  readonly lore: string
  readonly scope: "filtered" | "description alone"
}

/** What no tag reads: `from` without the tag phrase, as a reading leaves it. */
const fitOf = (from: string, q: string) => from.replace(q, "").trim()

const cases: ReadonlyArray<FitCase> = [
  ...rankingCases.map((c) => ({ from: c.from, q: c.q, fit: fitOf(c.from, c.q), lore: c.lore, scope: "filtered" as const })),
  ...rankingCases
    .filter((c) => c.kind === undefined)
    .map((c) => ({ from: fitOf(c.from, c.q), q: "", fit: fitOf(c.from, c.q), lore: c.lore, scope: "description alone" as const }))
]

type CaseResult = FitCase & {
  readonly status: string
  readonly candidates: number
  readonly fitting: number
  readonly kept: number
  readonly keptRight: number
  readonly precision: number | null
  readonly recall: number | null
  readonly p20Before: number
  readonly p20After: number
  readonly ms: number
}

const mean = (xs: ReadonlyArray<number>) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)
const round = (x: number, digits = 3) => Math.round(x * 10 ** digits) / 10 ** digits
const percentile = (xs: ReadonlyArray<number>, p: number) => {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
}

/** One row per run and scope, from every run's JSON, oldest first. */
const writeSummaryTable = () => {
  const runs = readdirSync(resultsDir)
    .filter((f) => /^search-fit-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(resultsDir, f), "utf8")))
    .sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)))
  const rows = runs.flatMap((r) =>
    Object.entries(r.summary.byScope as Record<string, any>).map(
      ([scope, s]) =>
        `| ${r.label} | ${String(r.ranAt).slice(0, 16).replace("T", " ")} | ${r.commit ?? ""} | ${scope} | ${s.cases} | ` +
        `${s.fitting.toFixed(1)} of ${s.candidates.toFixed(1)} | ${s.kept.toFixed(1)} | ${s.precision.toFixed(2)} | ${s.recall.toFixed(2)} | ` +
        `${s.p20Before.toFixed(2)} / ${s.p20After.toFixed(2)} | ${s.msP50} / ${s.msP95} | $${r.summary.costUsd.toFixed(4)} |`
    )
  )
  writeFileSync(
    join(resultsDir, "search-fit.md"),
    "# Rerank and cut\n\n" +
      "One row per run of `pnpm eval:fit` and kind of case, oldest first; the JSON next to this file has every case. " +
      "A model judges the first 50 cards Best match shows against what no filter reads. Precision and recall are of the cards it kept, " +
      "against the cards among the 50 whose lore fits. Precision at 20 is of the page's first 20 listings, before / after the cut. " +
      "Cost is the whole run's.\n\n" +
      "| Run | Ran at (UTC) | Commit | Cases | n | Fit, of judged | Kept | Precision | Recall | Precision at 20, before / after | Judge ms, p50 / p95 | Cost |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
      rows.join("\n") +
      "\n"
  )
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const search = yield* SearchService
  const vectors = yield* CardVectors
  const fit = yield* CardFit

  const [size] = yield* sql<{ readonly cards: number; readonly listings: number }>`
    SELECT (SELECT count(*)::int FROM cards) AS cards, (SELECT count(*)::int FROM listing_search) AS listings`
  const queued = yield* vectors.queued
  if ((size?.cards ?? 0) < 10_000 || queued > 0) {
    return yield* Effect.fail(
      new Error(`${size?.cards ?? 0} cards, ${queued} without a current search vector: load the large catalog first (see eval:rank)`)
    )
  }
  const started = new Date()

  /** Which card ids fit the case, by the generator's lore. */
  const fits = (c: FitCase, cardIds: ReadonlyArray<string>) =>
    cardIds.length === 0
      ? Effect.succeed(new Set<string>())
      : sql<{ readonly id: string }>`
          SELECT id FROM cards WHERE id IN ${sql.in([...new Set(cardIds)])} AND strpos(catalog_text, ${c.lore}) > 0`.pipe(
          Effect.map((rows) => new Set(rows.map((r) => r.id)))
        )
  const cardsOf = (ids: ReadonlyArray<string>) =>
    ids.length === 0
      ? Effect.succeed([] as Array<string>)
      : sql<{ readonly listingId: string; readonly cardId: string }>`
          SELECT listing_id, card_id FROM listing_search WHERE listing_id IN ${sql.in(ids)}`.pipe(
          Effect.map((rows) => {
            const m = new Map(rows.map((r) => [r.listingId, r.cardId]))
            return ids.map((id) => m.get(id) ?? "")
          })
        )
  const p20 = (c: FitCase, q: MarketQuery) =>
    Effect.gen(function* () {
      const found = yield* search.search({ ...q, offset: 0, limit: TOP })
      const cards = yield* cardsOf(found.ids)
      const good = yield* fits(c, cards)
      return cards.length === 0 ? 0 : cards.filter((id) => good.has(id)).length / cards.length
    })

  const results: Array<CaseResult> = []
  for (const c of cases) {
    const q: MarketQuery = { set: null, grader: null, q: c.q, from: c.from, fit: c.fit, sort: "relevance", offset: 0, limit: TOP }
    yield* sql`DELETE FROM card_fits WHERE concept = ${fitKey(c.fit)} AND version = ${FIT_VERSION}`
    const before = yield* p20(c, q)
    const candidates = yield* search.fitCandidates(q, FIT_CANDIDATES)
    const good = yield* fits(
      c,
      candidates.map((x) => x.id)
    )
    const t = performance.now()
    const checked = yield* fit.check(q, Effect.void)
    const ms = Math.round(performance.now() - t)
    const kept = yield* sql<{ readonly cardId: string }>`
      SELECT card_id FROM card_fits WHERE concept = ${fitKey(c.fit)} AND version = ${FIT_VERSION} AND fits`
    const keptIds = kept.map((k) => k.cardId)
    const keptRight = keptIds.filter((id) => good.has(id)).length
    const after = checked.status === "checked" ? yield* p20(c, q) : before
    const row: CaseResult = {
      ...c,
      status: checked.status === "unavailable" ? `unavailable: ${checked.reason}` : checked.status,
      candidates: candidates.length,
      fitting: good.size,
      kept: keptIds.length,
      keptRight,
      precision: keptIds.length === 0 ? null : keptRight / keptIds.length,
      recall: good.size === 0 ? null : keptRight / good.size,
      p20Before: before,
      p20After: after,
      ms
    }
    results.push(row)
    yield* Effect.logInfo(
      `${c.scope === "filtered" ? c.from : `"${c.fit}" alone`}: ${good.size} of ${candidates.length} fit, kept ${keptIds.length} ` +
        `(${keptRight} right), P@20 ${before.toFixed(2)} -> ${after.toFixed(2)}, ${ms} ms`
    )
  }

  const calls = yield* sql<{ readonly n: number; readonly cost: number; readonly input: number; readonly output: number }>`
    SELECT count(*)::int AS n, coalesce(sum(cost_usd_micros), 0)::int AS cost,
           coalesce(avg(input_tokens), 0)::float8 AS input, coalesce(avg(output_tokens), 0)::float8 AS output
    FROM llm_calls WHERE purpose = 'fit_cards' AND created_at >= ${started}`
  const scopeSummary = (rows: ReadonlyArray<CaseResult>) => ({
    cases: rows.length,
    candidates: round(mean(rows.map((r) => r.candidates)), 1),
    fitting: round(mean(rows.map((r) => r.fitting)), 1),
    kept: round(mean(rows.map((r) => r.kept)), 1),
    precision: round(mean(rows.filter((r) => r.precision !== null).map((r) => r.precision!))),
    recall: round(mean(rows.filter((r) => r.recall !== null).map((r) => r.recall!))),
    p20Before: round(mean(rows.map((r) => r.p20Before))),
    p20After: round(mean(rows.map((r) => r.p20After))),
    msP50: Math.round(percentile(rows.map((r) => r.ms), 50)),
    msP95: Math.round(percentile(rows.map((r) => r.ms), 95))
  })
  const summary = {
    cases: results.length,
    unavailable: results.filter((r) => r.status.startsWith("unavailable")).length,
    calls: calls[0]?.n ?? 0,
    costUsd: (calls[0]?.cost ?? 0) / 1_000_000,
    inputTokens: Math.round(calls[0]?.input ?? 0),
    outputTokens: Math.round(calls[0]?.output ?? 0),
    byScope: {
      filtered: scopeSummary(results.filter((r) => r.scope === "filtered")),
      "description alone": scopeSummary(results.filter((r) => r.scope === "description alone"))
    }
  }
  let commit: string | null = null
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  } catch {
    commit = null
  }
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(
    join(resultsDir, `search-fit-${label}.json`),
    JSON.stringify(
      { label, ranAt: started.toISOString(), commit, fitVersion: FIT_VERSION, cards: size?.cards, listings: size?.listings, summary, cases: results },
      null,
      2
    ) + "\n"
  )
  writeSummaryTable()
  yield* Effect.logInfo(`summary: ${JSON.stringify(summary)}`)
})

program.pipe(
  Effect.provide(Layer.mergeAll(CardFitLive, CardVectorsLive).pipe(Layer.provideMerge(ReposLive))),
  NodeRuntime.runMain
)
