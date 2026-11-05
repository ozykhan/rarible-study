/**
 * With OTLP_TRACES_URL set, spans leave the process as OTLP/HTTP JSON, with
 * their attributes and the configured headers. A small local receiver
 * stands in for Langfuse or a collector.
 */
import { createServer, type IncomingHttpHeaders } from "node:http"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { AppConfigLive } from "../src/config.ts"
import { currentTraceId, parseHeaders, TracingLive } from "../src/tracing.ts"

describe("tracing", () => {
  it("parses OTLP header lists", () => {
    expect(parseHeaders("Authorization=Basic%20abc, x-team = study ,broken")).toEqual({
      Authorization: "Basic abc",
      "x-team": "study"
    })
  })

  it.live("exports spans to the configured OTLP endpoint", () =>
    Effect.gen(function* () {
      const received: Array<{ readonly headers: IncomingHttpHeaders; readonly body: string }> = []
      const server = createServer((req, res) => {
        let body = ""
        req.on("data", (chunk) => (body += chunk))
        req.on("end", () => {
          received.push({ headers: req.headers, body })
          res.writeHead(200, { "content-type": "application/json" }).end("{}")
        })
      })
      yield* Effect.acquireRelease(
        Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
        () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
      )
      const port = (server.address() as AddressInfo).port
      process.env["DATABASE_URL"] ??= "postgres://unused@localhost/unused"
      process.env["OTLP_TRACES_URL"] = `http://127.0.0.1:${port}/v1/traces`
      process.env["OTLP_HEADERS"] = "x-test-key=secret"

      const traced = Effect.gen(function* () {
        yield* Effect.annotateCurrentSpan({ "rule.id": "R1" })
        return yield* currentTraceId
      }).pipe(Effect.withSpan("test.span"))
      // Closing the tracer layer flushes what is buffered.
      const traceId = yield* traced.pipe(Effect.provide(TracingLive.pipe(Layer.provide(AppConfigLive))))

      expect(traceId).toMatch(/^[0-9a-f]{32}$/)
      const body = received.map((r) => r.body).join("\n")
      expect(body).toContain("test.span")
      expect(body).toContain("slabwatch-server")
      expect(body).toContain(traceId ?? "missing")
      expect(received[0]?.headers["x-test-key"]).toBe("secret")
      delete process.env["OTLP_TRACES_URL"]
      delete process.env["OTLP_HEADERS"]
    }).pipe(Effect.scoped))
})
