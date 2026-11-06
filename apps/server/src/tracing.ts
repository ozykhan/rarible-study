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
 * Exports every Effect span (HTTP requests, rules, matcher stages, model
 * calls, tool calls, purchases, SQL) over OTLP/HTTP when the standard
 * OpenTelemetry variables name an endpoint. Railway sets them when tracing is
 * on for the service, so spans show up in its trace view under the edge's
 * request span. Langfuse, Jaeger and any collector take the same variables.
 * Without them, spans still exist in process and their trace ids are stored
 * in the database and written on log lines.
 */
export const TracingLive = Layer.unwrap(
  Effect.gen(function* () {
    const { otlp } = yield* AppConfig
    if (otlp === null) return Layer.empty
    if (otlp.protocol !== "http/protobuf" && otlp.protocol !== "http/json") {
      yield* Effect.logWarning(
        `traces are not exported: OTLP protocol ${otlp.protocol} is not supported, use http/protobuf or http/json`
      )
      return Layer.empty
    }
    if (!URL.canParse(otlp.tracesUrl)) {
      yield* Effect.logWarning("traces are not exported: the OTLP endpoint is not a valid URL")
      return Layer.empty
    }
    yield* Effect.logInfo(
      `exporting traces to ${new URL(otlp.tracesUrl).host} as ${otlp.serviceName} (${otlp.protocol})`
    )
    return OtlpTracer.layer({
      url: otlp.tracesUrl,
      resource: { serviceName: otlp.serviceName },
      headers: otlp.headers === null ? {} : parseHeaders(Redacted.value(otlp.headers)),
      exportInterval: "2 seconds"
    }).pipe(
      Layer.provide(otlp.protocol === "http/json" ? OtlpSerialization.layerJson : OtlpSerialization.layerProtobuf),
      Layer.provide(FetchHttpClient.layer)
    )
  })
)
