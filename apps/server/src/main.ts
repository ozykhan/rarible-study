/**
 * The backend process: runs migrations, serves HTTP, and keeps new listings
 * arriving, serves the MCP endpoint, and runs the watcher that starts agent runs.
 */
import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql/SqlClient"
import { migrate } from "./db/Database.ts"
import { GeneratorLive } from "./jobs/generator.ts"
import { WatcherLive } from "./jobs/watcher.ts"
import { AppConfigLive } from "./config.ts"
import { AppLive } from "./layers.ts"
import { McpRoute } from "./mcp/McpHttp.ts"
import { TracingLive } from "./tracing.ts"

const Health = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const rows = yield* sql<{ readonly active: number }>`SELECT count(*)::int AS active FROM listings WHERE status = 'active'`
    return HttpServerResponse.jsonUnsafe({ ok: true, activeListings: rows[0]?.active ?? 0 })
  }).pipe(Effect.catchCause(() => Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: false }, { status: 503 }))))
)

const ServerLive = Layer.unwrap(
  Effect.gen(function* () {
    const port = yield* Config.Number("PORT").pipe(Config.withDefault(3001))
    return NodeHttpServer.layer(createServer, { port })
  })
)

const Migrated = Layer.effectDiscard(migrate)

const Routes = Layer.mergeAll(Health, McpRoute)

const Main = Layer.mergeAll(HttpRouter.serve(Routes), GeneratorLive, WatcherLive).pipe(
  Layer.provide(Migrated),
  Layer.provide(ServerLive),
  Layer.provideMerge(AppLive),
  Layer.provide(TracingLive.pipe(Layer.provide(AppConfigLive)))
)

Layer.launch(Main).pipe(NodeRuntime.runMain)
