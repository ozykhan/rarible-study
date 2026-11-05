import { Config, Context, Layer, Option, Redacted } from "effect"

/**
 * All runtime settings, read once from the environment through Effect Config.
 * Secrets stay wrapped in `Redacted` so they never land in a log line.
 */
export class AppConfig extends Context.Service<
  AppConfig,
  {
    readonly databaseUrl: Redacted.Redacted<string>
    /** Postgres schema to work in. Evals use their own so they never touch demo data. */
    readonly dbSchema: string
    readonly anthropicApiKey: Redacted.Redacted<string> | null
    readonly llmModel: string
    readonly llmPriceInputPerMTok: number
    readonly llmPriceOutputPerMTok: number
    readonly llmDailyCapUsd: number
    readonly embedder: "local" | "hash"
    readonly embeddingModel: string
    readonly generatorIntervalSeconds: number
    /** Server-wide ceiling on purchases per owner per UTC day. A signed approval can only lower it. */
    readonly purchaseDailyCapUsd: number
    /** Read-only demo: every purchase is refused in code, whatever the caller. */
    readonly readOnly: boolean
    /** Let the agent loop run on new matches. Off by default, since it spends model tokens. */
    readonly agentEnabled: boolean
    /** Model calls per agent run, at most. */
    readonly agentMaxSteps: number
    /** Seconds between checks for new listings to match. 0 turns the watcher off. */
    readonly watcherIntervalSeconds: number
    /** OTLP/HTTP traces endpoint, for example a Langfuse or collector URL ending in /v1/traces. */
    readonly otlpTracesUrl: string | null
    /** Extra headers for the OTLP exporter, as k=v pairs separated by commas (the OTEL_EXPORTER_OTLP_HEADERS format). */
    readonly otlpHeaders: Redacted.Redacted<string> | null
  }
>()("slabwatch/AppConfig") {}

const config = Config.all({
  databaseUrl: Config.Redacted("DATABASE_URL"),
  dbSchema: Config.String("DB_SCHEMA").pipe(Config.withDefault("public")),
  anthropicApiKey: Config.Redacted("ANTHROPIC_API_KEY").pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && Redacted.value(o.value).length > 0 ? o.value : null))
  ),
  llmModel: Config.String("LLM_MODEL").pipe(Config.withDefault("claude-haiku-5-5")),
  llmPriceInputPerMTok: Config.Number("LLM_PRICE_INPUT_PER_MTOK").pipe(Config.withDefault(0.1)),
  llmPriceOutputPerMTok: Config.Number("LLM_PRICE_OUTPUT_PER_MTOK").pipe(Config.withDefault(0.5)),
  llmDailyCapUsd: Config.Number("LLM_DAILY_CAP_USD").pipe(Config.withDefault(2)),
  embedder: Config.Literals(["local", "hash"], "EMBEDDER").pipe(Config.withDefault("local" as const)),
  embeddingModel: Config.String("EMBEDDING_MODEL").pipe(Config.withDefault("Xenova/bge-small-en-v1.5")),
  generatorIntervalSeconds: Config.Number("GENERATOR_INTERVAL_SECONDS").pipe(Config.withDefault(45)),
  purchaseDailyCapUsd: Config.Number("PURCHASE_DAILY_CAP_USD").pipe(Config.withDefault(500)),
  readOnly: Config.Boolean("DEMO_READ_ONLY").pipe(Config.withDefault(false)),
  agentEnabled: Config.Boolean("AGENT_ENABLED").pipe(Config.withDefault(false)),
  agentMaxSteps: Config.Number("AGENT_MAX_STEPS").pipe(Config.withDefault(6)),
  watcherIntervalSeconds: Config.Number("WATCHER_INTERVAL_SECONDS").pipe(Config.withDefault(15)),
  otlpTracesUrl: Config.String("OTLP_TRACES_URL").pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && o.value.length > 0 ? o.value : null))
  ),
  otlpHeaders: Config.Redacted("OTLP_HEADERS").pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && Redacted.value(o.value).length > 0 ? o.value : null))
  )
})

export const AppConfigLive = Layer.effect(AppConfig, config)

/** Embedding width. Fixed by the model (bge-small has 384) and by the vector(384) columns. */
export const EMBEDDING_DIM = 384
