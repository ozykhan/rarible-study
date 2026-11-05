import Anthropic from "@anthropic-ai/sdk"
import { Context, Effect, Layer, Redacted, Schema } from "effect"
import { toCodecAnthropic } from "effect/ai/AnthropicStructuredOutput"
import { SqlClient } from "effect/sql/SqlClient"
import { AppConfig } from "../config.ts"

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
  }
>()("slabwatch/Llm") {}

/** Spend so far today (UTC) in micro-dollars, from the llm_calls ledger. */
const spentTodayMicros = (sql: SqlClient) => Effect.gen(function* () {
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

    const record = (purpose: LlmPurpose, usage: Usage, ok: boolean) =>
      sql`
        INSERT INTO llm_calls (purpose, model, input_tokens, output_tokens, cost_usd_micros, latency_ms, ok)
        VALUES (${purpose}, ${config.llmModel}, ${usage.inputTokens}, ${usage.outputTokens},
                ${usage.costUsdMicros}, ${usage.latencyMs}, ${ok})`.pipe(Effect.orDie)

    const structured = Effect.fn("Llm.structured")(function* <A>(req: StructuredRequest<A>) {
      if (client === null) return yield* new LlmNotConfigured()
      yield* Effect.annotateCurrentSpan({ "llm.purpose": req.purpose, "llm.model": config.llmModel })

      const spent = yield* spentTodayMicros(sql).pipe(Effect.orDie)
      const capMicros = config.llmDailyCapUsd * 1_000_000
      if (spent >= capMicros) {
        return yield* new SpendCapReached({ capUsd: config.llmDailyCapUsd, spentUsd: spent / 1_000_000 })
      }

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
      const usage: Usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        costUsdMicros: Math.round(
          response.usage.input_tokens * config.llmPriceInputPerMTok +
            response.usage.output_tokens * config.llmPriceOutputPerMTok
        ),
        latencyMs: Date.now() - started
      }
      yield* Effect.annotateCurrentSpan({
        "llm.input_tokens": usage.inputTokens,
        "llm.output_tokens": usage.outputTokens,
        "llm.cost_usd_micros": usage.costUsdMicros
      })

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

    return Llm.of({ model: config.llmModel, structured })
  })
)
