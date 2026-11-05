/**
 * Database tests run against a real Postgres with pgvector (docker compose
 * locally, a service container in CI), each file in its own throwaway schema,
 * with the hash embedder so no model is downloaded.
 */
import { generateSeed, sellers } from "@slabwatch/seed"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { migrate } from "../src/db/Database.ts"
import { makeAppLive } from "../src/layers.ts"
import type { Chain } from "../src/solana/Chain.ts"
import { chainLiteSvm } from "./litesvmChain.ts"

export const seed = generateSeed()

/** Tests never reach a real cluster: with PAYMENTS=devnet the chain is an in-process VM. */
export const testLayer = (name: string, env: Record<string, string> = {}, chain: Layer.Layer<Chain> = chainLiteSvm()) => {
  const schema = `test_${name}_${process.pid}`
  process.env["DB_SCHEMA"] = schema
  process.env["EMBEDDER"] = "hash"
  process.env["DATABASE_URL"] ??= "postgres://slabwatch:slabwatch@localhost:5432/slabwatch"
  delete process.env["ANTHROPIC_API_KEY"]
  for (const [k, v] of Object.entries(env)) process.env[k] = v

  const Seeded = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient
      yield* sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`
      yield* Effect.addFinalizer(() => sql`DROP SCHEMA IF EXISTS ${sql(schema)} CASCADE`.pipe(Effect.ignore))
      yield* migrate
      const catalog = yield* CatalogRepo
      yield* catalog.insertCatalog(sellers)
      yield* catalog.insertSales(seed.sales)
      yield* catalog.insertListings(seed.listings)
    })
  )
  return Seeded.pipe(Layer.provideMerge(makeAppLive(chain)))
}
