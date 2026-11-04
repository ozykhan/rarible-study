/** Lists a few new random cards now: pnpm --filter @slabwatch/server generate -- 5 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { listOne, makeState } from "../jobs/generator.ts"
import { ReposLive } from "../layers.ts"

const count = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 1)

Effect.gen(function* () {
  const state = yield* makeState
  for (let i = 0; i < count; i++) yield* listOne(state)
}).pipe(Effect.provide(ReposLive), NodeRuntime.runMain)
