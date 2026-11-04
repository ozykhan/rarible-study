import type { RuleDraft, WatchRule } from "@slabwatch/domain"

export interface ParseCheck {
  readonly ruleId: string
  readonly correct: number
  readonly total: number
  readonly wrong: ReadonlyArray<{ readonly field: string; readonly expected: string; readonly got: string }>
  readonly questions: ReadonlyArray<string>
}

/** Field by field: did the want parser produce the rule we wrote by hand? */
export const checkParse = (rule: WatchRule, draft: RuleDraft): ParseCheck => {
  const e = rule.hard
  const g = draft.hard
  const fields: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["setId", e.setId, g.setId],
    ["cardId", e.cardId, g.cardId],
    ["edition", e.edition, g.edition],
    ["finish", e.finish, g.finish],
    ["graders", [...e.graders].sort().join(","), [...g.graders].sort().join(",")],
    ["minGrade", e.minGrade, g.minGrade],
    ["maxPrice", `${e.maxPrice.amountMinor} ${e.maxPrice.currency}`, `${g.maxPrice.amountMinor} ${g.maxPrice.currency}`],
    ["hasSoftDescription", rule.softDescription !== null, draft.softDescription !== null]
  ]
  const wrong = fields
    .filter(([, a, b]) => a !== b)
    .map(([field, a, b]) => ({ field, expected: String(a), got: String(b) }))
  return { ruleId: rule.id, correct: fields.length - wrong.length, total: fields.length, wrong, questions: draft.questions }
}
