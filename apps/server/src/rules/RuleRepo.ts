import type { MatchDecision, WatchRule } from "@slabwatch/domain"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import { toTextArray, toVector } from "../db/Database.ts"

/** A stored rule plus the embedding of its soft description, if it has one. */
export interface StoredRule {
  readonly rule: WatchRule
  readonly softEmbedding: ReadonlyArray<number> | null
}

interface RuleRowDb {
  readonly id: string
  readonly ownerWallet: string | null
  readonly rawWant: string
  readonly setId: string | null
  readonly cardId: string | null
  readonly edition: WatchRule["hard"]["edition"]
  readonly finish: WatchRule["hard"]["finish"]
  readonly graders: ReadonlyArray<WatchRule["hard"]["graders"][number]>
  readonly minGrade: number
  readonly maxPriceMinor: number
  readonly currency: WatchRule["budget"]["currency"]
  readonly softDescription: string | null
  readonly softEmbedding: string | null
  readonly budgetMinor: number
  readonly mode: WatchRule["mode"]
  readonly status: WatchRule["status"]
}

const toStored = (r: RuleRowDb): StoredRule => ({
  rule: {
    id: r.id,
    ownerWallet: r.ownerWallet,
    rawWant: r.rawWant,
    hard: {
      setId: r.setId,
      cardId: r.cardId,
      edition: r.edition,
      finish: r.finish,
      graders: r.graders,
      minGrade: r.minGrade,
      maxPrice: { amountMinor: r.maxPriceMinor, currency: r.currency }
    },
    softDescription: r.softDescription,
    budget: { amountMinor: r.budgetMinor, currency: r.currency },
    mode: r.mode,
    status: r.status
  },
  softEmbedding: r.softEmbedding === null ? null : (JSON.parse(r.softEmbedding) as Array<number>)
})

export class RuleRepo extends Context.Service<
  RuleRepo,
  {
    readonly insert: (stored: StoredRule) => Effect.Effect<void, SqlError>
    readonly get: (id: string) => Effect.Effect<StoredRule | null, SqlError>
    readonly listActive: Effect.Effect<ReadonlyArray<StoredRule>, SqlError>
    readonly listForOwner: (wallet: string) => Effect.Effect<ReadonlyArray<StoredRule>, SqlError>
    readonly setMode: (id: string, mode: WatchRule["mode"]) => Effect.Effect<void, SqlError>
    readonly setStatus: (id: string, status: WatchRule["status"]) => Effect.Effect<void, SqlError>
    readonly saveDecisions: (decisions: ReadonlyArray<MatchDecision>) => Effect.Effect<void, SqlError>
  }
>()("slabwatch/RuleRepo") {}

const selectRule = (sql: SqlClient) => sql`
  SELECT id, owner_wallet, raw_want, set_id, card_id, edition, finish, graders, min_grade::float8 AS min_grade,
         max_price_minor::float8 AS max_price_minor, currency, soft_description, soft_embedding::text AS soft_embedding,
         budget_minor::float8 AS budget_minor, mode, status
  FROM watch_rules`

export const RuleRepoLive = Layer.effect(
  RuleRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient

    const insert = Effect.fn("RuleRepo.insert")(function* ({ rule, softEmbedding }: StoredRule) {
      const h = rule.hard
      yield* sql`
        INSERT INTO watch_rules (id, owner_wallet, raw_want, set_id, card_id, edition, finish, graders, min_grade,
                                 max_price_minor, currency, soft_description, soft_embedding, budget_minor, mode, status)
        VALUES (${rule.id}, ${rule.ownerWallet}, ${rule.rawWant}, ${h.setId}, ${h.cardId}, ${h.edition}, ${h.finish},
                ${toTextArray(h.graders)}::text[], ${h.minGrade}, ${h.maxPrice.amountMinor}, ${h.maxPrice.currency},
                ${rule.softDescription}, ${softEmbedding === null ? null : toVector(softEmbedding)}::vector,
                ${rule.budget.amountMinor}, ${rule.mode}, ${rule.status})`
    })

    const get = Effect.fn("RuleRepo.get")(function* (id: string) {
      const rows = yield* sql<RuleRowDb>`${selectRule(sql)} WHERE id = ${id}`
      const row = rows[0]
      return row ? toStored(row) : null
    })

    const listActive = Effect.map(
      sql<RuleRowDb>`${selectRule(sql)} WHERE status = 'active' ORDER BY created_at`,
      (rows) => rows.map(toStored)
    )

    const listForOwner = Effect.fn("RuleRepo.listForOwner")(function* (wallet: string) {
      const rows = yield* sql<RuleRowDb>`${selectRule(sql)} WHERE owner_wallet = ${wallet} ORDER BY created_at DESC`
      return rows.map(toStored)
    })

    const setMode = Effect.fn("RuleRepo.setMode")(function* (id: string, mode: WatchRule["mode"]) {
      yield* sql`UPDATE watch_rules SET mode = ${mode} WHERE id = ${id}`
    })

    const setStatus = Effect.fn("RuleRepo.setStatus")(function* (id: string, status: WatchRule["status"]) {
      yield* sql`UPDATE watch_rules SET status = ${status} WHERE id = ${id}`
    })

    const saveDecisions = Effect.fn("RuleRepo.saveDecisions")(function* (decisions: ReadonlyArray<MatchDecision>) {
      for (const d of decisions) {
        yield* sql`
          INSERT INTO match_decisions (rule_id, listing_id, pipeline_version, verdict, decided_at, field_checks,
                                       red_flags, similarity, judge, reasons)
          VALUES (${d.ruleId}, ${d.listingId}, ${d.pipelineVersion}, ${d.verdict}, ${d.decidedAt},
                  ${JSON.stringify(d.fieldChecks)}::jsonb, ${toTextArray(d.redFlags)}::text[], ${d.similarity},
                  ${d.judge === null ? null : JSON.stringify(d.judge)}::jsonb, ${toTextArray(d.reasons)}::text[])
          ON CONFLICT (rule_id, listing_id, pipeline_version) DO UPDATE
            SET verdict = excluded.verdict, decided_at = excluded.decided_at, field_checks = excluded.field_checks,
                red_flags = excluded.red_flags, similarity = excluded.similarity, judge = excluded.judge,
                reasons = excluded.reasons, created_at = now()`
      }
    })

    return RuleRepo.of({ insert, get, listActive, listForOwner, setMode, setStatus, saveDecisions })
  })
)
