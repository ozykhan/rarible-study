import { Config, Context, Layer, Option, Redacted } from "effect"

/** How spans leave the process. See `resolveOtlp` for where each field comes from. */
export interface OtlpSettings {
  /** The full traces URL, usually ending in /v1/traces. */
  readonly tracesUrl: string
  /** Extra exporter headers as k=v pairs separated by commas, values URL-encoded. */
  readonly headers: Redacted.Redacted<string> | null
  /** "http/protobuf" (the OpenTelemetry default) or "http/json". gRPC is not supported. */
  readonly protocol: string
  readonly serviceName: string
}

/** The OpenTelemetry variables that decide where traces go, as read from the environment. */
export interface OtlpEnv {
  readonly tracesEndpoint: string | null
  readonly endpoint: string | null
  readonly tracesHeaders: Redacted.Redacted<string> | null
  readonly headers: Redacted.Redacted<string> | null
  readonly tracesProtocol: string | null
  readonly protocol: string | null
  readonly exporter: string | null
  readonly disabled: boolean
  readonly serviceName: string | null
}

/**
 * Applies the OpenTelemetry rules for the standard variables, which Railway
 * sets when tracing is on for a service and which Langfuse, Jaeger and any
 * collector document too. A traces-specific variable wins over the general
 * one, and the general endpoint gets /v1/traces appended. Nothing is
 * exported without an endpoint, with OTEL_SDK_DISABLED=true, or when
 * OTEL_TRACES_EXPORTER does not list otlp.
 */
export const resolveOtlp = (env: OtlpEnv): OtlpSettings | null => {
  if (env.disabled) return null
  if (env.exporter !== null && !env.exporter.split(",").some((e) => e.trim().toLowerCase() === "otlp")) return null
  const tracesUrl =
    env.tracesEndpoint ?? (env.endpoint === null ? null : `${env.endpoint.replace(/\/+$/, "")}/v1/traces`)
  if (tracesUrl === null) return null
  return {
    tracesUrl,
    headers: env.tracesHeaders ?? env.headers,
    protocol: (env.tracesProtocol ?? env.protocol ?? "http/protobuf").toLowerCase(),
    serviceName: env.serviceName ?? "slabwatch-server"
  }
}

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
    /** Seconds between runs of the card tagger, which tags cards that need it with the model. 0 turns it off. */
    readonly taggerIntervalSeconds: number
    /** Seconds between runs that write search vectors for new and changed cards. 0 turns it off. */
    readonly cardVectorsIntervalSeconds: number
    /** Where spans go over OTLP/HTTP, from the standard OpenTelemetry variables. Null when nothing is set. */
    readonly otlp: OtlpSettings | null
    /** How purchases pay: a simulated ledger, or SPL token transfers on Solana devnet. */
    readonly payments: "simulated" | "devnet"
    /** A Solana devnet RPC URL. Any other cluster is refused before a transaction is sent. */
    readonly solanaRpcUrl: string
    /** 32 random bytes as hex; the server's devnet keypairs are derived from it. Devnet only, never a real key. */
    readonly devnetSeed: Redacted.Redacted<string> | null
    /** Test dUSD a wallet gets from the faucet, at most once a day. */
    readonly faucetUsd: number
    /** Browser origins allowed to call the web API, for example the Vercel URL. */
    readonly webOrigins: ReadonlyArray<string>
    /** Requests per hour per IP to the endpoints that cost a model call or a devnet transaction. */
    readonly costlyRequestsPerHour: number
  }
>()("slabwatch/AppConfig") {}

/** A setting that counts as missing when it is unset or blank. */
const optionalString = (name: string) =>
  Config.String(name).pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && o.value.trim().length > 0 ? o.value.trim() : null))
  )

const optionalRedacted = (name: string) =>
  Config.Redacted(name).pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && Redacted.value(o.value).trim().length > 0 ? o.value : null))
  )

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
  taggerIntervalSeconds: Config.Number("TAGGER_INTERVAL_SECONDS").pipe(Config.withDefault(600)),
  cardVectorsIntervalSeconds: Config.Number("CARD_VECTORS_INTERVAL_SECONDS").pipe(Config.withDefault(60)),
  otlp: Config.all({
    tracesEndpoint: optionalString("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"),
    endpoint: optionalString("OTEL_EXPORTER_OTLP_ENDPOINT"),
    tracesHeaders: optionalRedacted("OTEL_EXPORTER_OTLP_TRACES_HEADERS"),
    headers: optionalRedacted("OTEL_EXPORTER_OTLP_HEADERS"),
    tracesProtocol: optionalString("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL"),
    protocol: optionalString("OTEL_EXPORTER_OTLP_PROTOCOL"),
    exporter: optionalString("OTEL_TRACES_EXPORTER"),
    disabled: Config.Boolean("OTEL_SDK_DISABLED").pipe(Config.withDefault(false)),
    serviceName: optionalString("OTEL_SERVICE_NAME")
  }).pipe(Config.map(resolveOtlp)),
  payments: Config.Literals(["simulated", "devnet"], "PAYMENTS").pipe(Config.withDefault("simulated" as const)),
  solanaRpcUrl: Config.String("SOLANA_RPC_URL").pipe(Config.withDefault("https://api.devnet.solana.com")),
  devnetSeed: Config.Redacted("DEVNET_SEED").pipe(
    Config.option,
    Config.map((o) => (Option.isSome(o) && Redacted.value(o.value).length > 0 ? o.value : null))
  ),
  faucetUsd: Config.Number("FAUCET_USD").pipe(Config.withDefault(2000)),
  webOrigins: Config.String("WEB_ORIGINS").pipe(
    Config.withDefault("http://localhost:3000"),
    Config.map((s) => s.split(",").map((o) => o.trim()).filter((o) => o.length > 0))
  ),
  costlyRequestsPerHour: Config.Number("COSTLY_REQUESTS_PER_HOUR").pipe(Config.withDefault(30))
})

export const AppConfigLive = Layer.effect(AppConfig, config)

/** Embedding width. Fixed by the model (bge-small has 384) and by the vector(384) columns. */
export const EMBEDDING_DIM = 384
