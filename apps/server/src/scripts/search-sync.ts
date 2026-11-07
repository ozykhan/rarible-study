import { NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Schedule } from "effect"
import { migrate } from "../db/Database.ts"
import { ReposLive } from "../layers.ts"
import { LoggingLive } from "../logging.ts"
import { OpenSearch, OpenSearchLive } from "../search/opensearch/OpenSearch.ts"
import { SearchSync, SearchSyncLive } from "../search/opensearch/SearchSync.ts"

/**
 * The copy of market search data in OpenSearch, from the command line.
 * OPENSEARCH_URL picks the node (http://localhost:9200 by default) and
 * DB_SCHEMA the catalog, as for every other script.
 *
 *   pnpm search:sync copy     copy everything into new indexes and switch to them; start recording changes
 *   pnpm search:sync follow   apply recorded changes as they come, until stopped
 *   pnpm search:sync status   documents in each index, and changes waiting
 *   pnpm search:sync stop     stop recording changes, for when the copy is no longer used
 */
const applyAll = Effect.gen(function* () {
  const sync = yield* SearchSync
  let applied = 0
  while (true) {
    const n = yield* sync.applyChanges(5000)
    applied += n
    if (n < 5000) return applied
  }
})

const commands = {
  copy: Effect.gen(function* () {
    const sync = yield* SearchSync
    const run = yield* sync.copyAll
    yield* Effect.logInfo(
      `copied ${run.listings} listings, ${run.cards} cards and ${run.words} words in ${run.seconds.toFixed(1)} s`
    )
    const applied = yield* applyAll
    yield* sync.refresh
    yield* Effect.logInfo(`applied ${applied} changes made while copying`)
  }),
  follow: Effect.gen(function* () {
    yield* Effect.logInfo("applying changes as they come; stop with Ctrl-C")
    yield* applyAll.pipe(
      Effect.tap((n) => (n > 0 ? Effect.logInfo(`applied ${n} changes`) : Effect.void)),
      Effect.repeat(Schedule.spaced("1 second"))
    )
  }),
  status: Effect.gen(function* () {
    const os = yield* OpenSearch
    const sync = yield* SearchSync
    for (const index of Object.values(os.indexes)) {
      const count = yield* os.call("GET", `/${index}/_count`, undefined, { missingOk: true })
      yield* Effect.logInfo(`${index}: ${count === null ? "no copy yet" : `${count.count} documents`}`)
    }
    yield* Effect.logInfo(`${yield* sync.pending} changes waiting`)
  }),
  stop: Effect.gen(function* () {
    const sync = yield* SearchSync
    yield* sync.stopRecording
    yield* Effect.logInfo("stopped recording changes; the indexes are left as they are")
  })
}

const name = process.argv[2] ?? ""
const command = Object.hasOwn(commands, name) ? commands[name as keyof typeof commands] : null
if (command === null) {
  console.error(`usage: pnpm search:sync ${Object.keys(commands).join(" | ")}`)
  process.exit(1)
}

Effect.andThen(migrate, command).pipe(
  Effect.provide(SearchSyncLive.pipe(Layer.provideMerge(OpenSearchLive), Layer.provideMerge(ReposLive))),
  Effect.provide(LoggingLive),
  NodeRuntime.runMain
)
