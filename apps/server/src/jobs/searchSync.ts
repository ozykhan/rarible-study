import { Effect, Layer, Schedule } from "effect"
import { AppConfig } from "../config.ts"
import { OpenSearchLive } from "../search/opensearch/OpenSearch.ts"
import { SearchSync, SearchSyncLive } from "../search/opensearch/SearchSync.ts"

/** Changes applied per round trip. */
const PER_RUN = 5000

/**
 * With SEARCH_ENGINE=opensearch, applies the changes Postgres records to the
 * copy in OpenSearch about once a second, so a new or sold listing shows up
 * in search a second or two later. Run `pnpm search:sync copy` once first:
 * until a copy exists, nothing is recorded. On Postgres this does nothing.
 */
export const SearchSyncJobLive = Layer.unwrap(
  Effect.gen(function* () {
    const { searchEngine } = yield* AppConfig
    if (searchEngine !== "opensearch") return Layer.empty
    return Layer.effectDiscard(
      Effect.gen(function* () {
        const sync = yield* SearchSync
        const tick = Effect.gen(function* () {
          let applied = 0
          while (true) {
            const n = yield* sync.applyChanges(PER_RUN)
            applied += n
            if (n < PER_RUN) break
          }
          if (applied > 0) yield* Effect.logDebug(`search copy: applied ${applied} changes`)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("search copy: applying changes failed", cause)))
        yield* tick.pipe(Effect.repeat(Schedule.spaced("1 second")), Effect.forkScoped)
      })
    ).pipe(Layer.provide(SearchSyncLive), Layer.provide(OpenSearchLive))
  })
)
