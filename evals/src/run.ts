/**
 * Runs the labelled eval set through one pipeline version and records the
 * numbers.
 *
 *   pnpm eval                  # v1
 *   pnpm eval -- v2            # another version from pipelines.ts
 *   pnpm eval -- v1 --offline  # plumbing check: no model calls, nothing written
 *
 * Each run uses its own Postgres schema (eval_<version>), rebuilt from
 * scratch, so runs never see demo data or each other.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import { generateSales, sellers } from "@slabwatch/seed"
import {
  AppConfig,
  AppLive,
  CatalogRepo,
  Embedder,
  Llm,
  Matcher,
  migrate,
  RuleParser,
  RuleRepo
} from "@slabwatch/server"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { evalListings, evalRules, type RuleId } from "./dataset.ts"
import { computeMetrics, pairResults } from "./metrics.ts"
import { pipelines } from "./pipelines.ts"
import { checkParse, type ParseCheck } from "./parseCheck.ts"

const args = process.argv.slice(2).filter((a) => a !== "--")
const offline = args.includes("--offline")
const version = args.find((a) => !a.startsWith("--")) ?? "v1"
const chosen = pipelines[version]
if (!chosen) throw new Error(`Unknown pipeline version ${version}. Known: ${Object.keys(pipelines).join(", ")}`)
const pipeline = offline ? { ...chosen, version: `${version}-offline`, judge: "never" as const } : chosen
process.env["DB_SCHEMA"] = `eval_${pipeline.version.replace(/[^a-z0-9_]/g, "_")}`

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, "..", "results")

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const config = yield* AppConfig
  yield* sql`DROP SCHEMA IF EXISTS ${sql(config.dbSchema)} CASCADE`
  yield* migrate

  const catalog = yield* CatalogRepo
  const rules = yield* RuleRepo
  const embedder = yield* Embedder
  const matcher = yield* Matcher
  const parser = yield* RuleParser
  const llm = yield* Llm

  yield* catalog.insertCatalog(sellers)
  yield* catalog.insertSales(generateSales(20261105))
  yield* catalog.insertListings(evalListings.map((e) => e.labelled))
  for (const { rule } of evalRules) {
    const softEmbedding =
      rule.softDescription === null ? null : ((yield* embedder.embed([rule.softDescription], "query"))[0] ?? null)
    yield* rules.insert({ rule, softEmbedding })
  }
  yield* Effect.logInfo(`loaded ${evalListings.length} listings and ${evalRules.length} rules; running ${version}`)

  const started = Date.now()
  const decisions = []
  for (const { rule } of evalRules) {
    const stored = yield* rules.get(rule.id)
    if (stored === null) continue
    const ds = yield* matcher.evaluate(stored, pipeline)
    yield* rules.saveDecisions(ds)
    decisions.push(...ds)
  }
  const ruleIds = evalRules.map((r) => r.rule.id as RuleId)
  const results = pairResults(ruleIds, evalListings, decisions)
  const metrics = computeMetrics(ruleIds, evalListings, results)

  // The want parser, checked against the rules we wrote by hand.
  const parse: Array<ParseCheck> = []
  for (const { rule } of offline ? [] : evalRules) {
    const draft = yield* parser.parse(rule.rawWant)
    parse.push(checkParse(rule, draft))
  }

  const usage = yield* sql<{ purpose: string; calls: number; costUsd: number; meanMs: number; p95Ms: number; tokensIn: number; tokensOut: number }>`
    SELECT purpose, count(*)::int AS calls, (sum(cost_usd_micros) / 1e6)::float8 AS cost_usd,
           avg(latency_ms)::float8 AS mean_ms,
           percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float8 AS p95_ms,
           sum(input_tokens)::int AS tokens_in, sum(output_tokens)::int AS tokens_out
    FROM llm_calls GROUP BY purpose ORDER BY purpose`

  const commit = (() => {
    try {
      return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
    } catch {
      return "unknown"
    }
  })()
  const report = {
    version,
    ranAt: new Date().toISOString(),
    commit,
    model: llm.model,
    embedder: embedder.model,
    pipeline,
    seconds: Math.round((Date.now() - started) / 1000),
    metrics,
    parse,
    usage,
    errors: results.filter((r) => r.expected !== (r.verdict === "match"))
  }
  if (!offline) {
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(join(resultsDir, `${version}.json`), JSON.stringify(report, null, 2) + "\n")
    appendSummary(report)
  }
  yield* Effect.logInfo(
    `${pipeline.version}: precision ${pct(metrics.precision)}, recall ${pct(metrics.recall)}, ` +
      `trap listings matched ${metrics.trapListingsMatched}/${metrics.trapListings}, ` +
      `injection harmful ${metrics.injection.harmful}/${metrics.injection.pairs}, ` +
      `parse fields right ${parse.reduce((s, p) => s + p.correct, 0)}/${parse.reduce((s, p) => s + p.total, 0)}`
  )
})

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const appendSummary = (r: {
  readonly version: string
  readonly ranAt: string
  readonly commit: string
  readonly model: string
  readonly embedder: string
  readonly metrics: ReturnType<typeof computeMetrics>
  readonly parse: ReadonlyArray<ParseCheck>
  readonly usage: ReadonlyArray<{ readonly costUsd: number; readonly calls: number }>
}) => {
  const path = join(resultsDir, "summary.md")
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    text =
      "# Eval runs\n\nOne row per run, newest last. Written by `pnpm eval`; see the JSON next to this file for details.\n\n" +
      "| Version | Ran at (UTC) | Commit | Model | Embedder | Precision | Recall | Needs review | Trap listings wrongly matched | Injection: harmful changes | Want parsing: fields right | Model calls | Cost (USD) |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
  }
  const m = r.metrics
  const calls = r.usage.reduce((s, u) => s + u.calls, 0)
  const cost = r.usage.reduce((s, u) => s + u.costUsd, 0)
  const parseRight = r.parse.reduce((s, p) => s + p.correct, 0)
  const parseTotal = r.parse.reduce((s, p) => s + p.total, 0)
  text +=
    `| ${r.version} | ${r.ranAt.slice(0, 16).replace("T", " ")} | ${r.commit} | ${r.model} | ${r.embedder} | ` +
    `${pct(m.precision)} | ${pct(m.recall)} | ${m.needsReview} | ${m.trapListingsMatched} of ${m.trapListings} | ` +
    `${m.injection.harmful} of ${m.injection.pairs} | ${parseRight} of ${parseTotal} | ${calls} | ${cost.toFixed(4)} |\n`
  writeFileSync(path, text)
}

program.pipe(Effect.provide(AppLive), NodeRuntime.runMain)
