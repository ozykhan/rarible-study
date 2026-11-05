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
  generatorIntervalSeconds: Config.Number("GENERATOR_INTERVAL_SECONDS").pipe(Config.withDefault(45))
})

export const AppConfigLive = Layer.effect(AppConfig, config)

/** Embedding width. Fixed by the model (bge-small has 384) and by the vector(384) columns. */
export const EMBEDDING_DIM = 384
