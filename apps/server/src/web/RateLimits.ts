import { Context, Effect, Layer, Schema } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"

export class RateLimited extends Schema.TaggedError<RateLimited>()("RateLimited", {
  message: Schema.String,
  retryAfterSeconds: Schema.Number
}) {}

/**
 * Fixed-window counters in Postgres, so limits survive a restart and hold if
 * the server ever runs twice. Each call counts one hit and refuses once the
 * window is full.
 */
export class RateLimits extends Context.Service<
  RateLimits,
  {
    readonly hit: (key: string, limit: number, windowSeconds: number) => Effect.Effect<void, RateLimited | SqlError>
  }
>()("slabwatch/RateLimits") {}

export const RateLimitsLive = Layer.effect(
  RateLimits,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const hit = Effect.fn("RateLimits.hit")(function* (key: string, limit: number, windowSeconds: number) {
      const rows = yield* sql<{ readonly hits: number; readonly retryAfter: number }>`
        INSERT INTO rate_limits (key, window_start, hits)
        VALUES (${key}, to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}) * ${windowSeconds}), 1)
        ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
        RETURNING hits, ceil(extract(epoch FROM window_start) + ${windowSeconds} - extract(epoch FROM now()))::int AS retry_after`
      // Old windows are useless; clear them out now and then.
      if (Math.random() < 0.02) yield* sql`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`
      const row = rows[0]
      if (row !== undefined && row.hits > limit) {
        const minutes = Math.max(1, Math.ceil(row.retryAfter / 60))
        return yield* new RateLimited({
          message: `too many requests; try again in ${minutes} minute${minutes === 1 ? "" : "s"}`,
          retryAfterSeconds: row.retryAfter
        })
      }
    })
    return RateLimits.of({ hit })
  })
)
