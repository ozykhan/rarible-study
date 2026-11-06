/**
 * Log lines come out as one JSON object each, in the shape Railway parses,
 * and a line written inside a span names that span's trace.
 */
import { describe, expect, it } from "@effect/vitest"
import { Cause, Data, Effect, Logger } from "effect"
import { formatJsonLine } from "../src/logging.ts"

class Boom extends Data.TaggedError("Boom")<{ readonly reason: string }> {}

const capture = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const lines: Array<string> = []
    const logger = Logger.make((options) => {
      lines.push(formatJsonLine.log(options))
    })
    yield* effect.pipe(Effect.provide(Logger.layer([logger])))
    return lines
  })

describe("JSON log lines", () => {
  it.effect("carry the message, Railway's level, annotations and the trace id", () =>
    Effect.gen(function* () {
      let traceId = ""
      const lines = yield* capture(
        Effect.gen(function* () {
          traceId = (yield* Effect.currentSpan).traceId
          yield* Effect.logInfo("Sent HTTP response").pipe(
            Effect.annotateLogs({ "http.method": "GET", "http.status": 200 }),
            Effect.withLogSpan("http.span")
          )
          yield* Effect.logWarning("watcher decided without the judge")
        }).pipe(Effect.withSpan("request"))
      )
      expect(lines).toHaveLength(2)
      for (const line of lines) expect(line).not.toContain("\n")
      const first = JSON.parse(lines[0]!)
      expect(first).toMatchObject({
        message: "Sent HTTP response",
        level: "info",
        "http.method": "GET",
        "http.status": 200,
        trace_id: traceId
      })
      expect(typeof first["http.span_ms"]).toBe("number")
      expect(first.span_id).toMatch(/^[0-9a-f]{16}$/)
      expect(JSON.parse(lines[1]!).level).toBe("warn")
    }))

  it.effect("keep errors and causes on the same line", () =>
    Effect.gen(function* () {
      const lines = yield* capture(
        Effect.gen(function* () {
          yield* Effect.logError("web api request failed", new Boom({ reason: "db down" }))
          yield* Effect.logError("agent run crashed", Cause.fail(new Boom({ reason: "timeout" })))
        })
      )
      const [failed, crashed] = lines.map((line) => JSON.parse(line))
      expect(failed).toMatchObject({ message: "web api request failed", level: "error", data: { reason: "db down" } })
      expect(failed.trace_id).toBeUndefined()
      expect(crashed.message).toBe("agent run crashed")
      expect(crashed.cause).toContain("Boom")
    }))

  it.effect("use the cause's first line when a cause is all there is", () =>
    Effect.gen(function* () {
      const lines = yield* capture(Effect.log(Cause.fail(new Boom({ reason: "no route" }))))
      const line = JSON.parse(lines[0]!)
      expect(line.message).toBe(line.cause.split("\n")[0])
      expect(line.message).toContain("Boom")
    }))
})
