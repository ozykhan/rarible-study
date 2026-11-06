import { Context, Formatter, Layer, Logger, Tracer } from "effect"
import type * as LogLevel from "effect/LogLevel"

/** Railway knows four levels: debug, info, warn and error. */
const railwayLevel = (level: LogLevel.LogLevel): string => {
  switch (level) {
    case "Fatal":
    case "Error":
      return "error"
    case "Warn":
      return "warn"
    case "Debug":
    case "Trace":
      return "debug"
    default:
      return "info"
  }
}

/**
 * One JSON object per line, in the shape Railway parses: `message`, `level`,
 * and every other field as an attribute to filter on with `@name:value`.
 * Log annotations (such as `http.status` on request lines) become fields,
 * log spans become `<label>_ms` fields, and a line written inside a span
 * carries `trace_id` and `span_id`, so a log line leads to its trace.
 * Values that are not strings, such as an error object, go under `data`.
 */
export const formatJsonLine: Logger.Logger<unknown, string> = Logger.make((options) => {
  const structured = Logger.formatStructured.log(options)
  const parts: ReadonlyArray<unknown> = Array.isArray(structured.message) ? structured.message : [structured.message]
  const text = parts.filter((p): p is string => typeof p === "string")
  const data = parts.filter((p) => typeof p !== "string")
  const span = Context.getOrUndefined(options.fiber.context, Tracer.ParentSpan)
  const spans = Object.fromEntries(Object.entries(structured.spans).map(([label, ms]) => [`${label}_ms`, ms]))
  return Formatter.formatJson({
    ...structured.annotations,
    ...spans,
    message:
      text.length > 0
        ? text.join(" ")
        : data.length > 0
          ? Formatter.formatJson(data.length === 1 ? data[0] : data)
          : // Effect's request logger passes only the cause for a failed request.
            (structured.cause?.split("\n")[0] ?? ""),
    level: railwayLevel(options.logLevel),
    time: structured.timestamp,
    ...(text.length > 0 && data.length > 0 ? { data: data.length === 1 ? data[0] : data } : {}),
    ...(structured.cause === undefined ? {} : { cause: structured.cause }),
    ...(span === undefined ? {} : { trace_id: span.traceId, span_id: span.spanId }),
    fiber: structured.fiberId
  })
})

/**
 * JSON lines when the output goes to a log collector such as Railway, and
 * Effect's readable default in a terminal. The tracer logger stays on in
 * both, so log lines also land on the current span as events.
 */
export const LoggingLive: Layer.Layer<never> = process.stdout.isTTY
  ? Layer.empty
  : Logger.layer([Logger.withConsoleLog(formatJsonLine), Logger.tracerLogger])
