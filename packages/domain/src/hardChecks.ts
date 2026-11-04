import type { ListingView } from "./catalog.ts"
import type { FieldCheck } from "./decision.ts"
import { formatMoney } from "./money.ts"
import type { HardCriteria } from "./watchRule.ts"

/**
 * The exact checks of a rule against a listing, as plain code.
 *
 * The matcher runs the same checks as a SQL WHERE clause for speed; this
 * version explains each result and is what the purchase policy re-runs right
 * before paying. A test keeps the two in agreement.
 */
export const hardChecks = (hard: HardCriteria, l: ListingView): ReadonlyArray<FieldCheck> => {
  const checks: Array<FieldCheck> = [
    { field: "status", expected: "active", actual: l.status, pass: l.status === "active" },
    {
      field: "currency",
      expected: hard.maxPrice.currency,
      actual: l.price.currency,
      pass: l.price.currency === hard.maxPrice.currency
    },
    {
      field: "price",
      expected: `at most ${formatMoney(hard.maxPrice)}`,
      actual: formatMoney(l.price),
      pass: l.price.currency === hard.maxPrice.currency && l.price.amountMinor <= hard.maxPrice.amountMinor
    },
    { field: "grade", expected: `at least ${hard.minGrade}`, actual: String(l.grade), pass: l.grade >= hard.minGrade }
  ]
  if (hard.graders.length > 0) {
    checks.push({
      field: "grader",
      expected: hard.graders.join(" or "),
      actual: l.grader,
      pass: hard.graders.includes(l.grader)
    })
  }
  if (hard.setId !== null) {
    checks.push({ field: "set", expected: hard.setId, actual: l.setId, pass: l.setId === hard.setId })
  }
  if (hard.cardId !== null) {
    checks.push({ field: "card", expected: hard.cardId, actual: l.cardId, pass: l.cardId === hard.cardId })
  }
  if (hard.edition !== "any") {
    checks.push({ field: "edition", expected: hard.edition, actual: l.edition, pass: l.edition === hard.edition })
  }
  if (hard.finish !== "any") {
    checks.push({ field: "finish", expected: hard.finish, actual: l.finish, pass: l.finish === hard.finish })
  }
  return checks
}

export const passesHardChecks = (hard: HardCriteria, l: ListingView): boolean =>
  hardChecks(hard, l).every((c) => c.pass)
