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
import { LoggingLive } from "./logging.ts"
import { Payments } from "./purchases/Payments.ts"
import { Treasury } from "./solana/Treasury.ts"
import { TracingLive } from "./tracing.ts"
import { AppConfig } from "./config.ts"
import { WebApiRoutes } from "./web/WebApi.ts"

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

/** Browsers may call /api from the web app's origins only. */
const Cors = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return HttpRouter.cors({
      allowedOrigins: config.webOrigins,
      allowedMethods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["authorization", "content-type"],
      maxAge: 600
    })
  })
)

/**
 * On devnet, makes sure the dUSD mint and the escrow account exist, in the
 * background so a slow RPC never holds up the server.
 */
/**
 * Creates the dUSD mint and the escrow account on the first boot. When the
 * treasury has no SOL for fees and the faucet refuses, it logs the address to
 * fund once and checks again every minute, so funding it needs no restart.
 */
const DevnetSetup = Layer.effectDiscard(
  Effect.gen(function* () {
    const payments = yield* Payments
    if (payments.kind !== "devnet") return
    const treasury = yield* Treasury
    const attempt = (warned: boolean): Effect.Effect<void> =>
      treasury.setup.pipe(
        Effect.flatMap((r) =>
          r.needsFunding === null
            ? Effect.logInfo(`${r.cluster === "devnet" ? "devnet" : "in-memory chain"} ready: mint ${r.mint}, escrow ${r.escrowAccount}, treasury ${r.treasury} (${r.treasuryLamports} lamports); created: ${r.created.join(", ") || "nothing"}`)
            : (warned ? Effect.void : Effect.logWarning(`devnet treasury needs SOL: ${r.needsFunding}. Checking again every minute.`)).pipe(
                Effect.andThen(Effect.sleep("1 minute")),
                Effect.andThen(Effect.suspend(() => attempt(true)))
              )
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning("devnet setup failed; trying again in a minute", cause).pipe(
            Effect.andThen(Effect.sleep("1 minute")),
            Effect.andThen(Effect.suspend(() => attempt(warned)))
          )
        )
      )
    yield* Effect.forkScoped(attempt(false))
  })
)

const Routes = Layer.mergeAll(Health, McpRoute, WebApiRoutes).pipe(Layer.provide(Cors))

const Main = Layer.mergeAll(HttpRouter.serve(Routes), GeneratorLive, WatcherLive, DevnetSetup).pipe(
  Layer.provide(Migrated),
  Layer.provide(ServerLive),
  Layer.provideMerge(AppLive),
  Layer.provide(TracingLive.pipe(Layer.provide(AppConfigLive)))
)

Layer.launch(Main).pipe(Effect.provide(LoggingLive), NodeRuntime.runMain)
