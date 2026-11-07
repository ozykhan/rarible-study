/**
 * Drafting watch rules from plain-language wants, measured on labelled wants.
 *
 *   pnpm eval:parse -- run1           # the 40-card catalog; needs ANTHROPIC_API_KEY
 *   pnpm eval:parse -- run1 --large   # the same wants against the 20,040-card catalog
 *
 * Each run writes results/rule-parsing-<label>.json and rewrites
 * results/rule-parsing.md, one row per run (--table rewrites it alone).
 *
 * Every want goes through the parser the app uses, one at a time, in its own
 * schema. The large catalog keeps the four hand-written sets and their ids,
 * so the labels hold for both. A case passes when every labelled field is
 * right and the draft asks a question exactly when the case says a careful
 * reader would.
 */
import { execSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { NodeRuntime } from "@effect/platform-node"
import { toMajor } from "@slabwatch/domain"
import { generateLargeCatalog, handWritten, sellers } from "@slabwatch/seed"
import { AppConfig, CatalogRepo, migrate, PARSE_PROMPT_VERSION, ReposLive, RuleParser, RuleParserLive } from "@slabwatch/server"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { parseCases, type ParseCase } from "./ruleParsingDataset.ts"

const args = process.argv.slice(2).filter((a) => a !== "--")
const large = args.includes("--large")
const label = args.find((a) => !a.startsWith("--")) ?? "latest"
if (!/^[a-z0-9_-]+$/.test(label)) throw new Error(`label ${label} must be lowercase letters, digits, - or _`)
process.env["DB_SCHEMA"] = large ? "eval_parse_large" : "eval_parse"
// Card vectors play no part in parsing: the hash embedder loads 20,000 cards in seconds.
process.env["EMBEDDER"] ??= "hash"

const here = dirname(fileURLToPath(import.meta.url))
const resultsDir = join(here, "..", "results")

const sameSet = (a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>) =>
  a.length === b.length && a.every((x) => b.includes(x)) && b.every((x) => a.includes(x))

interface Drafted {
  readonly setId: string | null
  readonly cardId: string | null
  readonly edition: string
  readonly finish: string
  readonly graders: ReadonlyArray<string>
  readonly minGrade: number
  readonly maxPrice: number
  readonly currency: string
  readonly softDescription: string | null
  readonly questions: ReadonlyArray<string>
}

/** What is wrong with a draft, by the case's labels; empty when it passes. */
const judge = (c: ParseCase, d: Drafted) => {
  const problems: Array<string> = []
  const field = (name: string, want: unknown, got: unknown) => {
    if (want !== got) problems.push(`${name}: wanted ${String(want)}, got ${String(got)}`)
  }
  field("setId", c.setId ?? null, d.setId)
  field("cardId", c.cardId ?? null, d.cardId)
  field("edition", c.edition ?? "any", d.edition)
  field("finish", c.finish ?? "any", d.finish)
  if (!sameSet(c.graders ?? [], d.graders)) problems.push(`graders: wanted ${(c.graders ?? []).join(",") || "any"}, got ${d.graders.join(",") || "any"}`)
  field("minGrade", c.minGrade ?? 1, d.minGrade)
  field("maxPrice", `${c.maxPrice} ${c.currency ?? "USD"}`, `${d.maxPrice} ${d.currency}`)
  if (c.soft !== undefined) field("description", c.soft ? "some" : "none", d.softDescription === null ? "none" : "some")
  const asked = d.questions.length > 0
  if (asked && !(c.asks ?? false)) problems.push(`asked: ${d.questions.join(" | ")}`)
  if (!asked && (c.asks ?? false)) problems.push("asked nothing")
  return problems
}

const percentile = (xs: ReadonlyArray<number>, p: number) => {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? null
}

/** One row per run, from every run's JSON, oldest first. */
const writeSummaryTable = () => {
  const runs = readdirSync(resultsDir)
    .filter((f) => /^rule-parsing-.+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(resultsDir, f), "utf8")))
    .sort((a, b) => String(a.ranAt).localeCompare(String(b.ranAt)))
  const rows = runs.map((r) => {
    const s = r.summary
    return (
      `| ${r.label} | ${String(r.ranAt).slice(0, 16).replace("T", " ")} | ${r.commit ?? ""} | ${r.model} | ${r.promptVersion} | ${r.catalog} | ` +
      `${s.passed} of ${s.cases} | ${s.askedWhenClear} | ${s.missedQuestions} | ${s.fieldsRight} of ${s.fields} | ` +
      `${s.avgInputTokens} | ${s.ms.p50} / ${s.ms.p95} | ${s.modelCalls} | ${s.costUsd.toFixed(4)} |`
    )
  })
  writeFileSync(
    join(resultsDir, "rule-parsing.md"),
    "# Drafting watch rules\n\n" +
      "One row per run of `pnpm eval:parse`, oldest first; the JSON next to this file has every draft. " +
      "\"Asked when clear\" counts drafts that put a question to the collector when a careful reader would not; " +
      "times are one draft end to end (the name lookups and the model call).\n\n" +
      "| Run | Ran at (UTC) | Commit | Model | Prompt | Catalog | Cases passed | Asked when clear | Missed questions | Fields right | Input tokens, avg | ms, p50 / p95 | Model calls | Cost (USD) |\n" +
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n" +
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
  const cards = large ? generateLargeCatalog() : handWritten
  yield* catalog.insertCatalog(sellers, cards)
  yield* sql`ANALYZE cards`
  yield* Effect.logInfo(`catalog: ${cards.sets.length} sets, ${cards.cards.length} cards`)
  const parser = yield* RuleParser

  const rows = []
  for (const c of parseCases) {
    const start = performance.now()
    const { draft } = yield* parser.parse(c.want)
    const ms = Math.round(performance.now() - start)
    const d: Drafted = {
      ...draft.hard,
      maxPrice: toMajor(draft.hard.maxPrice),
      currency: draft.hard.maxPrice.currency,
      softDescription: draft.softDescription,
      questions: draft.questions
    }
    const problems = judge(c, d)
    rows.push({ want: c.want, why: c.why, pass: problems.length === 0, problems, ms, draft: d })
    yield* Effect.logInfo(`${problems.length === 0 ? "pass" : "FAIL"} ${ms} ms ${c.want}${problems.length > 0 ? `: ${problems.join("; ")}` : ""}`)
  }

  const calls = yield* sql<{ readonly n: number; readonly usd: number; readonly input: number }>`
    SELECT count(*)::int AS n, coalesce(sum(cost_usd_micros), 0)::float8 / 1e6 AS usd,
           coalesce(avg(input_tokens), 0)::float8 AS input
    FROM llm_calls WHERE purpose = 'parse_want'`
  const c0 = calls[0]!
  const FIELDS = 8
  const summary = {
    cases: rows.length,
    passed: rows.filter((r) => r.pass).length,
    askedWhenClear: rows.filter((r) => r.problems.some((p) => p.startsWith("asked:"))).length,
    missedQuestions: rows.filter((r) => r.problems.includes("asked nothing")).length,
    fields: rows.length * FIELDS,
    fieldsRight: rows.length * FIELDS - rows.reduce((n, r) => n + r.problems.filter((p) => !p.startsWith("asked")).length, 0),
    modelCalls: c0.n,
    costUsd: Number(c0.usd.toFixed(6)),
    avgInputTokens: Math.round(c0.input),
    ms: { p50: percentile(rows.map((r) => r.ms), 50), p95: percentile(rows.map((r) => r.ms), 95) }
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
    promptVersion: PARSE_PROMPT_VERSION,
    catalog: `${cards.cards.length} cards`,
    summary,
    cases: rows
  }
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(join(resultsDir, `rule-parsing-${label}.json`), JSON.stringify(report, null, 2) + "\n")
  writeSummaryTable()
  yield* Effect.logInfo(JSON.stringify(summary, null, 2))
})

if (args.includes("--table")) writeSummaryTable()
else program.pipe(Effect.provide(RuleParserLive.pipe(Layer.provideMerge(ReposLive))), NodeRuntime.runMain)
