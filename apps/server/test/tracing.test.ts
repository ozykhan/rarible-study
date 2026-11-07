/**
 * With the standard OpenTelemetry variables set (Railway sets them when
 * tracing is on), spans leave the process over OTLP/HTTP with their
 * attributes, the service name and the configured headers. A small local
 * receiver stands in for Railway, Langfuse or a collector.
 */
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Redacted } from "effect"
import { AppConfigLive, type OtlpEnv, resolveOtlp } from "../src/config.ts"
import { currentTraceId, parseHeaders, TracingLive } from "../src/tracing.ts"

const noEnv: OtlpEnv = {
  tracesEndpoint: null,
  endpoint: null,
  tracesHeaders: null,
  headers: null,
  tracesProtocol: null,
  protocol: null,
  exporter: null,
  disabled: false,
  serviceName: null
}

interface Received {
  readonly url: string
  readonly headers: IncomingHttpHeaders
  readonly body: Buffer
}

/** Starts a receiver, points the OTEL variables at it, and runs one traced effect through TracingLive. */
const exportOneSpan = (env: Record<string, string>) =>
  Effect.gen(function* () {
    const received: Array<Received> = []
    const server = createServer((req, res) => {
      const chunks: Array<Buffer> = []
      req.on("data", (chunk: Buffer) => chunks.push(chunk))
      req.on("end", () => {
        received.push({ url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) })
        res.writeHead(200, { "content-type": "application/json" }).end("{}")
      })
    })
    yield* Effect.acquireRelease(
      Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
      () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
    )
    const port = (server.address() as AddressInfo).port
    // The default provider reads process.env once, so each run gets its own.
    const Env = ConfigProvider.layer(
      ConfigProvider.fromEnv({
        env: {
          DATABASE_URL: "postgres://unused@localhost/unused",
          OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
          ...env
        }
      })
    )

    const traced = Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan({ "rule.id": "R1" })
      return yield* currentTraceId
    }).pipe(Effect.withSpan("test.span"))
    // Closing the tracer layer flushes what is buffered.
    const traceId = yield* traced.pipe(
      Effect.provide(TracingLive.pipe(Layer.provide(AppConfigLive), Layer.provide(Env)))
    )
    return { traceId, received }
  })

describe("tracing", () => {
  it("parses OTLP header lists", () => {
    expect(parseHeaders("Authorization=Basic%20abc, x-team = study ,broken")).toEqual({
      Authorization: "Basic abc",
      "x-team": "study"
    })
  })

  it("follows the OpenTelemetry rules for the standard variables", () => {
    expect(resolveOtlp(noEnv)).toBeNull()

    const general = resolveOtlp({ ...noEnv, endpoint: "https://otel.example/base/" })
    expect(general).toEqual({
      tracesUrl: "https://otel.example/base/v1/traces",
      headers: null,
      protocol: "http/protobuf",
      serviceName: "slabwatch-server"
    })

    const specific = resolveOtlp({
      ...noEnv,
      endpoint: "https://otel.example",
      tracesEndpoint: "https://traces.example/custom",
      headers: Redacted.make("a=1"),
      tracesHeaders: Redacted.make("b=2"),
      protocol: "grpc",
      tracesProtocol: "HTTP/JSON",
      serviceName: "backend"
    })
    expect(specific?.tracesUrl).toBe("https://traces.example/custom")
    expect(specific?.headers === null ? null : Redacted.value(specific!.headers)).toBe("b=2")
    expect(specific?.protocol).toBe("http/json")
    expect(specific?.serviceName).toBe("backend")

    expect(resolveOtlp({ ...noEnv, endpoint: "https://otel.example///" })?.tracesUrl).toBe(
      "https://otel.example/v1/traces"
    )

    const withEndpoint = { ...noEnv, endpoint: "https://otel.example" }
    expect(resolveOtlp({ ...withEndpoint, disabled: true })).toBeNull()
    expect(resolveOtlp({ ...withEndpoint, exporter: "none" })).toBeNull()
    expect(resolveOtlp({ ...withEndpoint, exporter: "console, otlp" })).not.toBeNull()
  })

  it.live("exports protobuf spans to Railway's endpoint by default", () =>
    Effect.gen(function* () {
      const { traceId, received } = yield* exportOneSpan({
        OTEL_EXPORTER_OTLP_HEADERS: "x-test-key=secret",
        OTEL_SERVICE_NAME: "backend"
      })
      expect(traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(received[0]?.url).toBe("/v1/traces")
      expect(received[0]?.headers["content-type"]).toBe("application/x-protobuf")
      expect(received[0]?.headers["x-test-key"]).toBe("secret")
      const body = Buffer.concat(received.map((r) => r.body))
      expect(body.includes("test.span")).toBe(true)
      expect(body.includes("backend")).toBe(true)
      expect(body.includes(Buffer.from(traceId ?? "", "hex"))).toBe(true)
    }).pipe(Effect.scoped))

  it.live("exports JSON spans when the protocol is http/json", () =>
    Effect.gen(function* () {
      const { traceId, received } = yield* exportOneSpan({ OTEL_EXPORTER_OTLP_PROTOCOL: "http/json" })
      expect(received[0]?.url).toBe("/v1/traces")
      expect(received[0]?.headers["content-type"]).toContain("application/json")
      const body = received.map((r) => r.body.toString("utf8")).join("\n")
      expect(body).toContain("test.span")
      expect(body).toContain("slabwatch-server")
      expect(body).toContain("rule.id")
      expect(body).toContain(traceId ?? "missing")
    }).pipe(Effect.scoped))
})
