import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, String as Str } from "effect"
import * as Migrator from "effect/sql/Migrator"
import { SqlClient } from "effect/sql/SqlClient"
import { AppConfig } from "../config.ts"
import { migrations } from "./migrations.ts"

/**
 * The Postgres client as an Effect layer. Column names come back in
 * camelCase, and the search_path is set per connection so evals can run in
 * their own schema with the same code.
 */
export const DatabaseLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return PgClient.layer({
      url: config.databaseUrl,
      transformResultNames: Str.snakeToCamel,
      startupParameters: { search_path: `${config.dbSchema}, public` },
      maxConnections: 10
    })
  })
)

/** Creates the schema if needed and runs pending migrations. Safe to run on every start. */
export const migrate = Effect.gen(function* () {
  const sql = yield* SqlClient
  const config = yield* AppConfig
  if (config.dbSchema !== "public") {
    yield* sql`CREATE SCHEMA IF NOT EXISTS ${sql(config.dbSchema)}`
  }
  const run = Migrator.make({})
  // Schema-qualified on purpose: an unqualified name would find public's
  // table through the search_path, and a fresh schema would never migrate.
  const applied = yield* run({
    loader: Migrator.fromRecord(migrations),
    table: `${config.dbSchema}.slabwatch_migrations`
  })
  for (const [id, name] of applied) yield* Effect.logInfo(`applied migration ${id} ${name}`)
  return applied
})

/** Formats a vector for a pgvector parameter: '[0.1,0.2,...]'. Cast it with ::vector in SQL. */
export const toVector = (v: ReadonlyArray<number>): string => `[${v.join(",")}]`

/** Formats a string array for a text[] parameter, null as NULL. Cast it with ::text[] in SQL. */
export const toTextArray = (items: ReadonlyArray<string | null>): string =>
  `{${items.map((s) => (s === null ? "NULL" : `"${s.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)).join(",")}}`
