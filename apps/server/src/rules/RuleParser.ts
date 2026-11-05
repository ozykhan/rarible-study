import { fromMajor, ParsedWant, type HardCriteria, type RuleDraft } from "@slabwatch/domain"
import { cards, sets, type CardSpec } from "@slabwatch/seed"
import { Context, Effect, Layer } from "effect"
import { Llm, type LlmError, type LlmNotConfigured, type SpendCapReached } from "../llm/Llm.ts"

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

const levenshtein = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j] ?? 0
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = cur
    }
  }
  return row[b.length] ?? 0
}

/** Exact match first, then a small typo tolerance. Returns every candidate that ties. */
const closest = <A>(query: string, items: ReadonlyArray<A>, names: (a: A) => ReadonlyArray<string>): ReadonlyArray<A> => {
  const q = normalize(query)
  const exact = items.filter((a) => names(a).some((n) => normalize(n) === q))
  if (exact.length > 0) return exact
  const scored = items.map((a) => ({ a, d: Math.min(...names(a).map((n) => levenshtein(normalize(n), q))) }))
  const best = Math.min(...scored.map((s) => s.d))
  return best <= 2 ? scored.filter((s) => s.d === best).map((s) => s.a) : []
}

/**
 * Turns the model's names into catalog ids. Code does this, not the model, so
 * an id is never invented; anything unknown or ambiguous becomes a question.
 */
export const resolveWant = (rawWant: string, parsed: ParsedWant): RuleDraft => {
  const questions = [...parsed.unclear]
  let setId: string | null = null
  if (parsed.setName !== null) {
    const found = closest(parsed.setName, sets, (s) => [s.name, s.code])
    if (found.length === 1 && found[0]) setId = found[0].id
    else questions.push(`I could not find a set called "${parsed.setName}". Which set do you mean?`)
  }
  let cardId: string | null = null
  if (parsed.cardName !== null) {
    const pool: ReadonlyArray<CardSpec> = setId === null ? cards : cards.filter((c) => c.setId === setId)
    const found = closest(parsed.cardName, pool, (c) => [c.name])
    const only = found.length === 1 ? found[0] : undefined
    if (only) {
      cardId = only.id
      setId = only.setId
    } else if (found.length > 1) {
      const where = found.map((c) => sets.find((s) => s.id === c.setId)?.name ?? c.setId).join(" or ")
      questions.push(`"${parsed.cardName}" exists in ${where}. Which one do you want?`)
    } else {
      questions.push(`I could not find a card called "${parsed.cardName}". Can you check the name?`)
    }
  }
  if (parsed.maxPrice === null) questions.push("What is the most you want to pay?")
  const hard: HardCriteria = {
    setId,
    cardId,
    edition: parsed.edition,
    finish: parsed.finish,
    graders: parsed.graders,
    minGrade: parsed.minGrade,
    maxPrice: fromMajor(parsed.maxPrice ?? 0, parsed.currency)
  }
  return { rawWant, hard, softDescription: parsed.softDescription, questions }
}

const catalogSummary = sets
  .map((s) => `- ${s.name} (code ${s.code}): ${cards.filter((c) => c.setId === s.id).map((c) => c.name).join(", ")}`)
  .join("\n")

export const PARSE_SYSTEM = `You turn a collector's plain-language want into a structured watch rule for a marketplace of graded trading cards.

The catalog:
${catalogSummary}

Graders, by code: NVG (Northvale Grading), QSG (Quarry Slab Grading), LCA (Lantern Card Authentication). Grades run from 1 to 10 in steps of 0.5.

Rules for each field:
- setName and cardName: copy the names as the collector wrote them, corrected to the catalog spelling when the match is obvious. Use null when the collector did not name one.
- edition: "first" for 1st edition, "unlimited" when they say unlimited, otherwise "any".
- finish: "holo", "non_holo", "reverse_holo", or "any" when they did not say.
- graders: the grader codes they accept. An empty list means any grader.
- minGrade: the lowest grade they accept. "9 or better" is 9. "10 only" is 10. If they gave no grade, use 1.
- maxPrice: the highest price in major units (900 for "$900"), or null if they gave none. currency is the currency of that price; default to USD.
- softDescription: only what code cannot check against these fields, for example "a water creature" or "a dragon". Use null when everything they asked for fits the fields above.
- unclear: short questions about anything ambiguous. Leave it empty when the want is clear.`

export class RuleParser extends Context.Service<
  RuleParser,
  {
    readonly parse: (rawWant: string) => Effect.Effect<RuleDraft, LlmError | SpendCapReached | LlmNotConfigured>
  }
>()("slabwatch/RuleParser") {}

export const RuleParserLive = Layer.effect(
  RuleParser,
  Effect.gen(function* () {
    const llm = yield* Llm
    const parse = Effect.fn("RuleParser.parse")(function* (rawWant: string) {
      const { value } = yield* llm.structured({
        purpose: "parse_want",
        system: PARSE_SYSTEM,
        user: `The collector wrote:\n<want>\n${rawWant}\n</want>`,
        schema: ParsedWant,
        maxTokens: 1024
      })
      return resolveWant(rawWant, value)
    })
    return RuleParser.of({ parse })
  })
)
