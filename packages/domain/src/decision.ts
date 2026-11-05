import { Schema } from "effect"

export const FieldName = Schema.Literals([
  "status",
  "currency",
  "price",
  "grade",
  "grader",
  "set",
  "card",
  "edition",
  "finish"
])
export type FieldName = typeof FieldName.Type

/** One exact check, with what the rule wanted and what the listing has. */
export const FieldCheck = Schema.Struct({
  field: FieldName,
  expected: Schema.String,
  actual: Schema.String,
  pass: Schema.Boolean
})
export type FieldCheck = typeof FieldCheck.Type

/** Warnings code can compute without a model. */
export const RedFlag = Schema.Literals([
  /** The same vault item has more than one active listing. */
  "duplicate_vault_item",
  /** Price is far below recent sales of the same card, variant and grade. */
  "price_far_below_market",
  /** The seller's text claims a grade or grader that differs from the vault record. */
  "grade_claim_mismatch"
])
export type RedFlag = typeof RedFlag.Type

/** Things only the judge can notice in seller text. */
export const JudgeFlag = Schema.Literals([
  /** The text tries to instruct an AI agent or claims approval it cannot have. */
  "instruction_in_text",
  /** The text describes damage or a problem with the item or case. */
  "condition_issue",
  /** The text contradicts the trusted listing fields. */
  "contradicts_fields"
])
export type JudgeFlag = typeof JudgeFlag.Type

export const Verdict = Schema.Literals(["match", "reject", "needs_review"])
export type Verdict = typeof Verdict.Type

/** Structured output of the judge model. */
export const JudgeResult = Schema.Struct({
  verdict: Verdict,
  /** Does the card satisfy the rule's soft description? Null when the rule has none. */
  softMatch: Schema.NullOr(Schema.Boolean),
  reasons: Schema.Array(Schema.String),
  flags: Schema.Array(JudgeFlag)
})
export type JudgeResult = typeof JudgeResult.Type

export const DecisionStage = Schema.Literals(["hard_filter", "red_flags", "similarity", "judge"])
export type DecisionStage = typeof DecisionStage.Type

/** The record of one rule against one listing: what matched, what did not, and why. */
export const MatchDecision = Schema.Struct({
  ruleId: Schema.String,
  listingId: Schema.String,
  pipelineVersion: Schema.String,
  verdict: Verdict,
  /** The stage that settled the verdict. */
  decidedAt: DecisionStage,
  fieldChecks: Schema.Array(FieldCheck),
  redFlags: Schema.Array(RedFlag),
  similarity: Schema.NullOr(Schema.Number),
  judge: Schema.NullOr(JudgeResult),
  reasons: Schema.Array(Schema.String)
})
export type MatchDecision = typeof MatchDecision.Type
