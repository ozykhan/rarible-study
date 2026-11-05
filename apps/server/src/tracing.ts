import { FetchHttpClient } from "effect/http"
import { Effect, Layer, Redacted } from "effect"
import * as OtlpSerialization from "effect/observability/OtlpSerialization"
import * as OtlpTracer from "effect/observability/OtlpTracer"
import { AppConfig } from "./config.ts"

/** The trace id of the current span, to store next to rows the span produced. */
export const currentTraceId: Effect.Effect<string | null> = Effect.currentSpan.pipe(
  Effect.map((span) => span.traceId),
  Effect.orElseSucceed(() => null)
)

/** Parses OTEL_EXPORTER_OTLP_HEADERS style "k1=v1,k2=v2" into a record. */
export const parseHeaders = (raw: string): Record<string, string> =>
  Object.fromEntries(
    raw
      .split(",")
      .map((pair) => pair.trim())
      .filter((pair) => pair.includes("="))
      .map((pair) => {
        const i = pair.indexOf("=")
        return [pair.slice(0, i).trim(), decodeURIComponent(pair.slice(i + 1).trim())] as const
      })
  )

/**
 * Exports every Effect span (rules, matcher stages, model calls, tool calls,
 * purchases) over OTLP/HTTP when OTLP_TRACES_URL is set. Langfuse, Jaeger and
 * any OpenTelemetry collector accept this. Without the setting, spans still
 * exist in process and their trace ids are stored in the database.
 */
export const TracingLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig
    if (config.otlpTracesUrl === null) return Layer.empty
    return OtlpTracer.layer({
      url: config.otlpTracesUrl,
      resource: { serviceName: "slabwatch-server" },
      headers: config.otlpHeaders === null ? {} : parseHeaders(Redacted.value(config.otlpHeaders)),
      exportInterval: "2 seconds"
    }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer))
  })
)
