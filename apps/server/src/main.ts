/**
 * The backend process: runs migrations, serves HTTP, and keeps new listings
 * arriving. Day 2 adds the MCP endpoint and the agent loop here.
 */
import { createServer } from "node:http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql/SqlClient"
import { migrate } from "./db/Database.ts"
import { GeneratorLive } from "./jobs/generator.ts"
import { AppLive } from "./layers.ts"

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

const Main = Layer.mergeAll(HttpRouter.serve(Health), GeneratorLive).pipe(
  Layer.provide(Migrated),
  Layer.provide(ServerLive),
  Layer.provideMerge(AppLive)
)

Layer.launch(Main).pipe(NodeRuntime.runMain)
