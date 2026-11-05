import { createHash, randomBytes } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import { toTextArray } from "../db/Database.ts"

/**
 * Bearer tokens for the MCP endpoint. Each token carries its own rule-id
 * allow-list and whether it may execute purchases. Only a SHA-256 of the token
 * is stored, so a database leak does not leak working tokens.
 */
export interface AgentToken {
  readonly id: string
  readonly label: string
  readonly allowedRuleIds: ReadonlyArray<string>
  readonly canExecute: boolean
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

export class AgentTokens extends Context.Service<
  AgentTokens,
  {
    /** Returns the token itself, once. It cannot be read back later. */
    readonly mint: (args: {
      readonly label: string
      readonly allowedRuleIds: ReadonlyArray<string>
      readonly canExecute: boolean
    }) => Effect.Effect<{ readonly id: string; readonly token: string }, SqlError>
    readonly verify: (token: string) => Effect.Effect<AgentToken | null, SqlError>
    readonly revoke: (id: string) => Effect.Effect<void, SqlError>
  }
>()("slabwatch/AgentTokens") {}

export const AgentTokensLive = Layer.effect(
  AgentTokens,
  Effect.gen(function* () {
    const sql = yield* SqlClient

    const mint = Effect.fn("AgentTokens.mint")(function* (args: {
      readonly label: string
      readonly allowedRuleIds: ReadonlyArray<string>
      readonly canExecute: boolean
    }) {
      const id = `T-${randomBytes(6).toString("hex")}`
      const token = `swt_${randomBytes(32).toString("base64url")}`
      yield* sql`
        INSERT INTO agent_tokens (id, label, token_sha256, allowed_rule_ids, can_execute)
        VALUES (${id}, ${args.label}, ${hashToken(token)}, ${toTextArray(args.allowedRuleIds)}::text[], ${args.canExecute})`
      return { id, token }
    })

    const verify = Effect.fn("AgentTokens.verify")(function* (token: string) {
      if (!token.startsWith("swt_") || token.length > 100) return null
      const rows = yield* sql<AgentToken>`
        SELECT id, label, allowed_rule_ids, can_execute FROM agent_tokens
        WHERE token_sha256 = ${hashToken(token)} AND revoked_at IS NULL`
      return rows[0] ?? null
    })

    const revoke = Effect.fn("AgentTokens.revoke")(function* (id: string) {
      yield* sql`UPDATE agent_tokens SET revoked_at = now() WHERE id = ${id}`
    })

    return AgentTokens.of({ mint, verify, revoke })
  })
)
