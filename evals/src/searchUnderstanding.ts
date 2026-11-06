/**
 * Reading described searches with the model, measured on labelled searches.
 *
 *   pnpm --filter @slabwatch/evals eval:search -- run1           # live, needs ANTHROPIC_API_KEY
 *   pnpm --filter @slabwatch/evals eval:search -- run1 --offline # routing only: no model calls, nothing written
 *
 * Each live run writes results/search-understanding-<label>.json and rewrites
 * results/search-understanding.md, one row per run (--table rewrites it alone).
 *
 * The catalog is the hand-written one, in its own schema. Each search goes
 * through the same reading the market uses, one at a time, so the times are
 * what a shopper waits. Then every search is read again, and each one the
 * model read should now come from the cache.
 *
 * A case passes when code and the model route it as labelled, and the
 * reading holds exactly the labelled names and filters, every labelled tag,
 * and no other tag except the harmless ones the case allows.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import { generateSeed, sellers } from "@slabwatch/seed"
import {
  AppConfig,
  CatalogRepo,
  migrate,
  parseSearch,
  ReposLive,
  SearchUnderstanding,
  SearchUnderstandingLive,
  UNDERSTAND_PROMPT_VERSION,
  type Understanding
} from "@slabwatch/server"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { searchCases, type SearchCase, type SearchCaseKind } from "./searchDataset.ts"

const args = process.argv.slice(2).filter((a) => a !== "--")
const offline = args.includes("--offline")
const label = args.find((a) => !a.startsWith("--")) ?? "latest"
if (!/^[a-z0-9_-]+$/.test(label)) throw new Error(`label ${label} must be lowercase letters, digits, - or _`)
process.env["DB_SCHEMA"] = offline ? "eval_search_offline" : "eval_search"
process.env["EMBEDDER"] ??= "hash"
if (offline) process.env["ANTHROPIC_API_KEY"] = ""

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, "..", "results")

interface Got {
  readonly status: Understanding["status"]
  /** The search the reading was rewritten to. */
  readonly read: string | null
  readonly tags: ReadonlyArray<string>
  readonly names: ReadonlyArray<string>
  readonly notUnderstood: ReadonlyArray<string>
}

const sameSet = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>) =>
  a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x))

/** What is wrong with a reading, by the case's labels; empty when it passes. */
const judge = (c: SearchCase, u: Understanding) => {
  const problems: Array<string> = []
  if (c.route === "code") {
    if (u.status !== "not_needed") problems.push(`asked the model (${u.status})`)
    return problems
  }
  if (u.status === "not_needed") return ["code read it alone, the model was never asked"]
  if (u.status === "unavailable") return [`unavailable: ${u.reason}`]
  if ((c.expect ?? "understood") === "nothing") {
    if (u.status !== "nothing") problems.push(`expected nothing, got "${u.q}"`)
    return problems
  }
  if (u.status === "nothing") return ["found nothing to search for"]
  const p = parseSearch(u.q)
  const tags = p.tags.map((t) => t.tag)
  const want = c.tags ?? []
  const missing = want.filter((t) => !tags.includes(t))
  const extra = tags.filter((t) => !want.includes(t) && !(c.alsoOk ?? []).includes(t))
  if (missing.length > 0) problems.push(`missing tags ${missing.join(", ")}`)
  if (extra.length > 0) problems.push(`extra tags ${extra.join(", ")}`)
  if (!sameSet(p.words, c.names ?? [])) problems.push(`names ${JSON.stringify(p.words)}`)
  if (!sameSet(p.finishes, c.finishes ?? [])) problems.push(`finishes ${JSON.stringify(p.finishes)}`)
  if (!sameSet(p.editions, c.editions ?? [])) problems.push(`editions ${JSON.stringify(p.editions)}`)
  if (!sameSet(p.graders, c.graders ?? [])) problems.push(`graders ${JSON.stringify(p.graders)}`)
  if (!sameSet(p.grades, c.grades ?? [])) problems.push(`grades ${JSON.stringify(p.grades)}`)
  if (p.minGrade !== (c.minGrade ?? null)) problems.push(`min grade ${p.minGrade}`)
  const max = p.maxUsdCents === null ? null : p.maxUsdCents / 100
  if (max !== (c.maxPrice ?? null)) problems.push(`max price ${max}`)
  return problems
}

const got = (u: Understanding): Got => {
  if (u.status !== "understood") {
    return { status: u.status, read: null, tags: [], names: [], notUnderstood: u.status === "nothing" ? u.notUnderstood : [] }
  }
  const p = parseSearch(u.q)
  return { status: u.status, read: u.q, tags: p.tags.map((t) => t.tag), names: p.words, notUnderstood: u.notUnderstood }
}

type Row = SearchCase & {
  readonly got: Got
  readonly source: "model" | "cache" | null
  readonly ms: number
  readonly problems: ReadonlyArray<string>
  readonly pass: boolean
}

const percentile = (xs: ReadonlyArray<number>, p: number) => {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null
}

const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const start = performance.now()
    const value = yield* effect
    return { value, ms: Math.round(performance.now() - start) }
  })

/** One row per run, from every run's JSON, oldest first. */
const writeSummaryTable = () => {
  const runs = readdirSync(resultsDir)
    .filter((f) => /^search-understanding-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(resultsDir, f), "utf8")))
    .sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)))
  const rows = runs.map((r) => {
    const s = r.summary
    return (
      `| ${r.label} | ${String(r.ranAt).slice(0, 16).replace("T", " ")} | ${r.commit ?? ""} | ${r.model} | ${r.promptVersion} | ` +
      `${s.passed} of ${s.cases} | ${s.readingsWithExtraTags} | ${s.readingsMissingTags} | ` +
      `${s.modelReadingMs.p50} / ${s.modelReadingMs.p95} | ${s.cachedReadingMs.p50} | ${s.modelCalls} | ${s.costUsd.toFixed(4)} |`
    )
  })
  writeFileSync(
    join(resultsDir, "search-understanding.md"),
    "# Reading described searches\n\n" +
      "One row per run of `pnpm eval:search`, oldest first; the JSON next to this file has every case. " +
      "Times are for one search read end to end (the word lookups, the cache and the model call).\n\n" +
      "| Run | Ran at (UTC) | Commit | Model | Prompt | Cases passed | Readings with an extra tag | Readings missing a tag | Model reading ms, p50 / p95 | Cached ms, p50 | Model calls | Cost (USD) |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
      rows.join("\n") +
      "\n"
  )
}

const program = Effect.gen(function* () {
  const sql = yield* SqlClient
  const config = yield* AppConfig
  yield* sql`DROP SCHEMA IF EXISTS ${sql(config.dbSchema)} CASCADE`
  yield* migrate
  const catalog = yield* CatalogRepo
  yield* catalog.insertCatalog(sellers)
  yield* catalog.insertListings(generateSeed().listings)
  const reader = yield* SearchUnderstanding

  const first: Array<Row> = []
  for (const c of searchCases) {
    const { value, ms } = yield* timed(reader.understand(c.q, Effect.void))
    const problems = judge(c, value)
    first.push({ ...c, got: got(value), source: "source" in value ? value.source : null, ms, problems, pass: problems.length === 0 })
    yield* Effect.logInfo(`${problems.length === 0 ? "pass" : "FAIL"} ${ms} ms ${c.q} -> ${value.status === "understood" ? value.q : value.status}${problems.length > 0 ? `: ${problems.join("; ")}` : ""}`)
  }
  // Every search again: the ones the model read should come from the cache, unchanged.
  const again = []
  for (const c of searchCases) {
    const { value, ms } = yield* timed(reader.understand(c.q, Effect.void))
    again.push({ q: c.q, source: "source" in value ? value.source : null, ms, same: JSON.stringify(got(value)) === JSON.stringify(first.find((f) => f.q === c.q)?.got) })
  }

  const calls = yield* sql<{ readonly n: number; readonly usd: number; readonly input: number; readonly cached: number; readonly output: number }>`
    SELECT count(*)::int AS n, coalesce(sum(cost_usd_micros), 0)::float8 / 1e6 AS usd,
           coalesce(avg(input_tokens), 0)::float8 AS input, coalesce(avg(cache_read_tokens), 0)::float8 AS cached,
           coalesce(avg(output_tokens), 0)::float8 AS output
    FROM llm_calls WHERE purpose = 'understand_search'`
  const c0 = calls[0]!
  const modelRuns = first.filter((r) => r.source === "model")
  const cacheRuns = again.filter((r, i) => first[i]!.source === "model")
  const kinds = [...new Set(searchCases.map((c) => c.kind))] as Array<SearchCaseKind>
  const tagCases = first.filter((r) => r.route === "model" && (r.expect ?? "understood") === "understood")
  const summary = {
    cases: first.length,
    passed: first.filter((r) => r.pass).length,
    byKind: Object.fromEntries(
      kinds.map((k) => {
        const rows = first.filter((r) => r.kind === k)
        return [k, `${rows.filter((r) => r.pass).length} of ${rows.length}`]
      })
    ),
    readingsWithExtraTags: tagCases.filter((r) => r.problems.some((p) => p.startsWith("extra tags"))).length,
    readingsMissingTags: tagCases.filter((r) => r.problems.some((p) => p.startsWith("missing tags"))).length,
    modelCalls: c0.n,
    costUsd: Number(c0.usd.toFixed(6)),
    costPerReadingUsd: c0.n === 0 ? null : Number((c0.usd / c0.n).toFixed(6)),
    avgInputTokens: Math.round(c0.input),
    avgCachedInputTokens: Math.round(c0.cached),
    avgOutputTokens: Math.round(c0.output),
    modelReadingMs: { p50: percentile(modelRuns.map((r) => r.ms), 50), p95: percentile(modelRuns.map((r) => r.ms), 95) },
    cachedReadingMs: { p50: percentile(cacheRuns.map((r) => r.ms), 50), p95: percentile(cacheRuns.map((r) => r.ms), 95) },
    codeOnlyMs: { p50: percentile(first.filter((r) => r.route === "code").map((r) => r.ms), 50) },
    secondPassFromCache: `${cacheRuns.filter((r) => r.source === "cache").length} of ${cacheRuns.length}`,
    secondPassUnchanged: `${cacheRuns.filter((r) => r.same).length} of ${cacheRuns.length}`
  }
  const report = {
    label,
    ranAt: new Date().toISOString(),
    commit: (() => {
      try {
        return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
      } catch {
        return null
      }
    })(),
    model: config.llmModel,
    promptVersion: UNDERSTAND_PROMPT_VERSION,
    summary,
    cases: first.map(({ q, kind, got: g, ms, problems, pass, source }) => ({ q, kind, pass, problems, ms, source, ...g }))
  }
  if (!offline) {
    mkdirSync(resultsDir, { recursive: true })
    writeFileSync(join(resultsDir, `search-understanding-${label}.json`), JSON.stringify(report, null, 2) + "\n")
    writeSummaryTable()
  }
  yield* Effect.logInfo(JSON.stringify(summary, null, 2))
})

if (args.includes("--table")) writeSummaryTable()
else program.pipe(Effect.provide(SearchUnderstandingLive.pipe(Layer.provideMerge(ReposLive))), NodeRuntime.runMain)
