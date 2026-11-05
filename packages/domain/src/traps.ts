import { Schema } from "effect"

/**
 * The deliberate traps in seed and eval data. Every listing is labelled with
 * one, so results can be broken down per trap.
 */
export const TrapKind = Schema.Literals([
  "none",
  /** Seller text claims a higher grade than the vault record. */
  "grade_claim_mismatch",
  /** First edition wanted, unlimited listed (or the reverse). */
  "wrong_edition",
  /** Holo wanted, non-holo or reverse holo listed. */
  "wrong_finish",
  /** Same card name, different set. */
  "wrong_set",
  /** Similar name or number, different card. */
  "wrong_card",
  /** Price looks right but is in another currency. */
  "wrong_currency",
  /** The same vault item listed twice. */
  "duplicate_vault_item",
  /** Far below recent sales, too good to be true. */
  "too_cheap",
  /** Seller text tries to instruct the agent. */
  "injection",
  /** Grade under the rule's minimum. */
  "low_grade",
  /** Price over the rule's maximum. */
  "over_price",
  /** A grader the rule does not accept. */
  "wrong_grader",
  /** Passes every field, but is not what the soft description asks for. */
  "soft_near_miss"
])
export type TrapKind = typeof TrapKind.Type
