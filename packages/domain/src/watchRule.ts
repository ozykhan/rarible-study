import { Schema } from "effect"
import { Edition, Finish, Grade, Grader } from "./catalog.ts"
import { Currency, Money } from "./money.ts"

export const EditionPref = Schema.Literals(["first", "unlimited", "any"])
export type EditionPref = typeof EditionPref.Type

export const FinishPref = Schema.Literals(["holo", "non_holo", "reverse_holo", "any"])
export type FinishPref = typeof FinishPref.Type

/** confirm: the collector signs each purchase. auto: the agent buys within the signed budget. */
export const RuleMode = Schema.Literals(["confirm", "auto"])
export type RuleMode = typeof RuleMode.Type

export const RuleStatus = Schema.Literals(["draft", "active", "paused", "exhausted"])
export type RuleStatus = typeof RuleStatus.Type

/**
 * The part of a rule that code checks exactly. Ids are resolved by code
 * against the catalog; the model never supplies them.
 */
export const HardCriteria = Schema.Struct({
  setId: Schema.NullOr(Schema.String),
  cardId: Schema.NullOr(Schema.String),
  edition: EditionPref,
  finish: FinishPref,
  /** Empty means any grader. */
  graders: Schema.Array(Grader),
  minGrade: Grade,
  maxPrice: Money
})
export type HardCriteria = typeof HardCriteria.Type

export const WatchRule = Schema.Struct({
  id: Schema.String,
  ownerWallet: Schema.NullOr(Schema.String),
  /** The collector's own words, kept for the record and for the judge. */
  rawWant: Schema.String,
  hard: HardCriteria,
  /** What code cannot check, for example "any water creature". Null when the rule is fully hard. */
  softDescription: Schema.NullOr(Schema.String),
  budget: Money,
  mode: RuleMode,
  status: RuleStatus
})
export type WatchRule = typeof WatchRule.Type

/**
 * What the model returns when it reads a want. Names, not ids: code resolves
 * them against the catalog and asks the collector about anything unclear.
 */
export const ParsedWant = Schema.Struct({
  setName: Schema.NullOr(Schema.String),
  cardName: Schema.NullOr(Schema.String),
  edition: EditionPref,
  finish: FinishPref,
  graders: Schema.Array(Grader),
  minGrade: Grade,
  /** In major units (900 means $900), as the collector wrote it. */
  maxPrice: Schema.NullOr(Schema.Number.check(Schema.isGreaterThan(0))),
  currency: Currency,
  softDescription: Schema.NullOr(Schema.String),
  /** Anything the collector should confirm before saving. */
  unclear: Schema.Array(Schema.String)
})
export type ParsedWant = typeof ParsedWant.Type

/** A rule draft as shown to the collector for review, before a budget is set. */
export const RuleDraft = Schema.Struct({
  rawWant: Schema.String,
  hard: HardCriteria,
  softDescription: Schema.NullOr(Schema.String),
  /** Names the model gave that code could not resolve, and other open points. */
  questions: Schema.Array(Schema.String)
})
export type RuleDraft = typeof RuleDraft.Type

export { Edition, Finish }
