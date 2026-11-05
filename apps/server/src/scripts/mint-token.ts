/**
 * Mints a bearer token for the MCP endpoint and prints it once.
 *
 *   pnpm --filter @slabwatch/server mint-token --rules R1,R2 [--execute] [--label "my client"]
 *   pnpm --filter @slabwatch/server mint-token --revoke T-abc123
 *
 * Only a hash is stored, so a lost token is revoked and minted again.
 */
import { NodeRuntime } from "@effect/platform-node"
import { Effect } from "effect"
import { parseArgs } from "node:util"
import { AgentTokens } from "../agent/AgentTokens.ts"
import { RuleRepo } from "../rules/RuleRepo.ts"
import { ReposLive } from "../layers.ts"

const { values } = parseArgs({
  options: {
    rules: { type: "string" },
    execute: { type: "boolean", default: false },
    label: { type: "string", default: "mcp client" },
    revoke: { type: "string" }
  }
})

const program = Effect.gen(function* () {
  const tokens = yield* AgentTokens
  if (values.revoke !== undefined) {
    yield* tokens.revoke(values.revoke)
    yield* Effect.log(`revoked ${values.revoke}`)
    return
  }
  const ruleIds = (values.rules ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  if (ruleIds.length === 0) return yield* Effect.fail("pass --rules R1,R2: a token acts for named rules only")
  const rules = yield* RuleRepo
  for (const id of ruleIds) {
    if ((yield* rules.get(id)) === null) return yield* Effect.fail(`no rule ${id}`)
  }
  const minted = yield* tokens.mint({ label: values.label, allowedRuleIds: ruleIds, canExecute: values.execute })
  console.log(`token id: ${minted.id}`)
  console.log(`rules:    ${ruleIds.join(", ")}`)
  console.log(`execute:  ${values.execute ? "yes (auto-mode rules with a signed approval only)" : "no"}`)
  console.log(`token:    ${minted.token}`)
  console.log("This is the only time the token is shown.")
})

program.pipe(Effect.provide(ReposLive), NodeRuntime.runMain)
