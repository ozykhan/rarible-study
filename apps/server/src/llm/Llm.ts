import Anthropic from "@anthropic-ai/sdk"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { toCodecAnthropic } from "effect/ai/AnthropicStructuredOutput"
import { SqlClient } from "effect/sql/SqlClient"
import { AppConfig } from "../config.ts"
import { currentTraceId } from "../tracing.ts"

export type LlmPurpose = "parse_want" | "judge" | "agent"

export class LlmError extends Schema.TaggedError<LlmError>()("LlmError", {
  message: Schema.String
}) {}

/** The daily spend cap is reached. Callers turn this into a clear "try tomorrow" message. */
export class SpendCapReached extends Schema.TaggedError<SpendCapReached>()("SpendCapReached", {
  capUsd: Schema.Number,
  spentUsd: Schema.Number
}) {}

export class LlmNotConfigured extends Schema.TaggedError<LlmNotConfigured>()("LlmNotConfigured", {}) {}

export interface StructuredRequest<A> {
  readonly purpose: LlmPurpose
  readonly system: string
  readonly user: string
  readonly schema: Schema.Codec<A, any>
  readonly maxTokens?: number
}

/** One turn of a tool-using conversation. History is append-only and passed back unchanged. */
export interface ConverseRequest {
  readonly purpose: LlmPurpose
  readonly system: string
  readonly messages: ReadonlyArray<Anthropic.MessageParam>
  readonly tools: ReadonlyArray<Anthropic.Tool>
  readonly maxTokens?: number
  /** The agent run this call belongs to, stored on the ledger row. */
  readonly runId?: string | null
}

export interface ConverseResponse {
  /** Every block as returned, thinking included, so it can go back into the history as is. */
  readonly content: ReadonlyArray<Anthropic.ContentBlock>
  readonly stopReason: Anthropic.StopReason | null
  readonly usage: Usage
}

export interface Usage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsdMicros: number
  readonly latencyMs: number
}

/**
 * Every model call in the app goes through this service, which gives three
 * guarantees in one place: the daily spend cap is checked before each call,
 * every call's tokens, cost and latency are recorded, and structured output is
 * decoded with Effect Schema before anyone sees it.
 */
export class Llm extends Context.Service<
  Llm,
  {
    readonly model: string
    readonly structured: <A>(
      req: StructuredRequest<A>
    ) => Effect.Effect<{ readonly value: A; readonly usage: Usage }, LlmError | SpendCapReached | LlmNotConfigured>
    readonly converse: (req: ConverseRequest) => Effect.Effect<ConverseResponse, LlmError | SpendCapReached | LlmNotConfigured>
  }
>()("slabwatch/Llm") {}

/** Spend so far today (UTC) in micro-dollars, from the llm_calls ledger. */
export const spentTodayMicros = (sql: SqlClient) => Effect.gen(function* () {
  const rows = yield* sql<{ total: number }>`
    SELECT coalesce(sum(cost_usd_micros), 0)::float8 AS total
    FROM llm_calls
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'`
  return rows[0]?.total ?? 0
})

export const LlmLive = Layer.effect(
  Llm,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const sql = yield* SqlClient
    const client = config.anthropicApiKey
      ? new Anthropic({ apiKey: Redacted.value(config.anthropicApiKey) })
      : null

    const record = (purpose: LlmPurpose, usage: Usage, ok: boolean, runId: string | null = null) =>
      Effect.gen(function* () {
        const traceId = yield* currentTraceId
        yield* sql`
          INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd_micros, latency_ms, ok, trace_id, run_id)
          VALUES (${purpose}, ${config.llmModel}, ${usage.inputTokens}, ${usage.outputTokens},
                  ${usage.costUsdMicros}, ${usage.latencyMs}, ${ok}, ${traceId}, ${runId})`
      }).pipe(Effect.orDie)

    /** Fails with SpendCapReached once today's ledger reaches the cap. Checked before every call. */
    const checkCap = Effect.gen(function* () {
      const spent = yield* spentTodayMicros(sql).pipe(Effect.orDie)
      const capMicros = config.llmDailyCapUsd * 1_000_000
      if (spent >= capMicros) {
        return yield* new SpendCapReached({ capUsd: config.llmDailyCapUsd, spentUsd: spent / 1_000_000 })
      }
    })

    const usageOf = (u: Anthropic.Usage, started: number): Usage => ({
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      costUsdMicros: Math.round(u.input_tokens * config.llmPriceInputPerMTok + u.output_tokens * config.llmPriceOutputPerMTok),
      latencyMs: Date.now() - started
    })

    const annotateUsage = (usage: Usage) =>
      Effect.annotateCurrentSpan({
        "llm.input_tokens": usage.inputTokens,
        "llm.output_tokens": usage.outputTokens,
        "llm.cost_usd_micros": usage.costUsdMicros
      })

    const structured = Effect.fn("Llm.structured")(function* <A>(req: StructuredRequest<A>) {
      if (client === null) return yield* new LlmNotConfigured()
      yield* Effect.annotateCurrentSpan({ "llm.purpose": req.purpose, "llm.model": config.llmModel })

      yield* checkCap

      // Effect Schema to the JSON Schema subset Anthropic accepts, plus the
      // codec that decodes the reply back into our own type.
      const { codec, jsonSchema } = toCodecAnthropic(req.schema)
      const started = Date.now()
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          client.messages.create(
            {
              model: config.llmModel,
              max_tokens: req.maxTokens ?? 2048,
              system: req.system,
              messages: [{ role: "user", content: req.user }],
              output_config: {
                effort: "low",
                format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> }
              }
            },
            { signal }
          ),
        catch: (e) => new LlmError({ message: e instanceof Error ? e.message : String(e) })
      })
      const usage = usageOf(response.usage, started)
      yield* annotateUsage(usage)

      if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") {
        yield* record(req.purpose, usage, false)
        return yield* new LlmError({ message: `model stopped with ${response.stop_reason}` })
      }
      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")
      const value = yield* Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: () => new LlmError({ message: "model returned text that is not JSON" })
      }).pipe(
        Effect.flatMap((json) => Schema.decodeUnknownEffect(codec)(json)),
        Effect.mapError((e) => (e instanceof LlmError ? e : new LlmError({ message: `bad output: ${String(e)}` }))),
        Effect.tapError(() => record(req.purpose, usage, false))
      )
      yield* record(req.purpose, usage, true)
      return { value: value as A, usage }
    })

    /**
     * One model turn with tools. Thinking stays on (the model default) at low
     * effort, tool_choice stays auto, and the caller keeps the loop: it reads
     * blocks by type and appends `content` to the history unchanged.
     */
    const converse = Effect.fn("Llm.converse")(function* (req: ConverseRequest) {
      if (client === null) return yield* new LlmNotConfigured()
      yield* Effect.annotateCurrentSpan({ "llm.purpose": req.purpose, "llm.model": config.llmModel })
      yield* checkCap
      const started = Date.now()
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          client.messages.create(
            {
              model: config.llmModel,
              max_tokens: req.maxTokens ?? 4096,
              system: req.system,
              messages: [...req.messages],
              tools: [...req.tools],
              tool_choice: { type: "auto" },
              output_config: { effort: "low" }
            },
            { signal }
          ),
        catch: (e) => new LlmError({ message: e instanceof Error ? e.message : String(e) })
      })
      const usage = usageOf(response.usage, started)
      yield* annotateUsage(usage)
      yield* Effect.annotateCurrentSpan({ "llm.stop_reason": response.stop_reason ?? "none" })
      const ok = response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens"
      yield* record(req.purpose, usage, ok, req.runId ?? null)
      if (response.stop_reason === "refusal") return yield* new LlmError({ message: "the model declined this request" })
      return { content: response.content, stopReason: response.stop_reason, usage } satisfies ConverseResponse
    })

    return Llm.of({ model: config.llmModel, structured, converse })
  })
)
