import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { migrate } from "../db/Database.ts"
import { BaseLive } from "../layers.ts"

migrate.pipe(Effect.provide(BaseLive), NodeRuntime.runMain)
