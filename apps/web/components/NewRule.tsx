"use client"

import { useState } from "react"
import { api } from "@/lib/api"
import { label, toMajor, toMinor } from "@/lib/format"
import type { Draft, Rule } from "@/lib/types"
import { useAction } from "@/lib/useAction"
import { Button, Panel } from "./ui"

/** The parser's question when a want names no price; typing one below answers it. */
const PRICE_QUESTION = "What is the most you want to pay?"

const EXAMPLES = [
  "Ashen Wyrm, 1st edition holo, grade 9 or better from NVG or QSG, up to $900",
  "any water creature from Tidewild, holo, grade 8 or better, under $250",
  "an Emberfall dragon in grade 10, any grader, max $1,500"
]

/**
 * Plain language in, a watch rule out. The model fills the fields; code maps
 * names to catalog ids and asks when something is unclear. Nothing is saved
 * until the collector confirms. Styles: styles/desk.css (.draft, .facts, .questions).
 */
export function NewRule(props: { token: string; onCreated: (rule: Rule, note: string) => void }) {
  const [want, setWant] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [maxPrice, setMaxPrice] = useState("")
  const [budget, setBudget] = useState("")
  const [budgetEdited, setBudgetEdited] = useState(false)
  const { busy, error, run } = useAction()

  // The budget follows twice the price until the collector sets it.
  const changePrice = (value: string) => {
    setMaxPrice(value)
    if (!budgetEdited) setBudget(Number(value) > 0 ? String(Number(value) * 2) : "")
  }

  const makeDraft = () =>
    run("draft", async () => {
      const d = await api<Draft>("/rules/draft", { token: props.token, body: { want } })
      setDraft(d)
      const max = d.draft.hard.maxPrice
      const major = toMajor(max.amountMinor, max.currency)
      setMaxPrice(major > 0 ? String(major) : "")
      setBudget(major > 0 ? String(major * 2) : "")
      setBudgetEdited(false)
    })

  const create = () =>
    run("create", async () => {
      if (draft === null) return
      const currency = draft.draft.hard.maxPrice.currency
      const r = await api<{ rule: Rule; matches: number; needsReview: number; unjudgedReason: string | null }>("/rules", {
        token: props.token,
        body: {
          rawWant: draft.draft.rawWant,
          hard: { ...draft.draft.hard, maxPrice: { amountMinor: toMinor(Number(maxPrice), currency), currency } },
          softDescription: draft.draft.softDescription,
          budget: { amountMinor: toMinor(Number(budget), currency), currency }
        }
      })
      const note =
        `${r.matches} match${r.matches === 1 ? "" : "es"} and ${r.needsReview} to review among the listings right now.` +
        (r.unjudgedReason ? ` (Model review skipped: ${r.unjudgedReason}.)` : "")
      setDraft(null)
      setWant("")
      props.onCreated(r.rule, note)
    })

  const h = draft?.draft.hard
  const priceGiven = Number(maxPrice) > 0
  const questions = (draft?.draft.questions ?? []).filter((q) => !(priceGiven && q === PRICE_QUESTION))
  return (
    <Panel title="New watch rule">
      <textarea
        value={want}
        onChange={(e) => setWant(e.target.value)}
        placeholder={EXAMPLES[0]}
        rows={3}
        maxLength={500}
      />
      <div className="row">
        <Button onClick={makeDraft} disabled={busy !== null || want.trim().length < 3}>
          {busy === "draft" ? "Reading…" : "Draft the rule"}
        </Button>
        <span className="muted small">
          Try:{" "}
          <Button variant="link" onClick={() => setWant(EXAMPLES[1] ?? "")}>
            {EXAMPLES[1]}
          </Button>
        </span>
      </div>

      {draft && h && (
        <div className="draft">
          <h3>Check the rule</h3>
          <dl className="facts">
            <dt>Set</dt>
            <dd>{draft.setName ?? "any"}</dd>
            <dt>Card</dt>
            <dd>{draft.cardName ?? "any"}</dd>
            <dt>Edition</dt>
            <dd>{label(h.edition)}</dd>
            <dt>Finish</dt>
            <dd>{label(h.finish)}</dd>
            <dt>Graders</dt>
            <dd>{h.graders.length === 0 ? "any" : h.graders.join(", ")}</dd>
            <dt>Grade</dt>
            <dd>{h.minGrade} or better</dd>
            <dt>Price</dt>
            <dd>
              <label>
                at most{" "}
                <input
                  value={maxPrice}
                  onChange={(e) => changePrice(e.target.value)}
                  inputMode="decimal"
                  size={8}
                  placeholder="missing"
                  aria-label="Most you will pay"
                />{" "}
                {h.maxPrice.currency}
              </label>
              {!priceGiven && <span className="muted small"> Type the most you will pay.</span>}
            </dd>
            <dt>Also wants</dt>
            <dd>{draft.draft.softDescription ?? "nothing else"}</dd>
          </dl>
          {questions.length > 0 && (
            <div className="questions">
              <strong>Before you save, the parser asks:</strong>
              <ul>
                {questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="muted small">
                {questions.includes(PRICE_QUESTION)
                  ? "Type the price in the rule above, or edit the text and draft again."
                  : "Edit the text above and draft again to answer."}
              </p>
            </div>
          )}
          <div className="row">
            <label>
              Budget for this rule
              <input
                value={budget}
                onChange={(e) => {
                  setBudget(e.target.value)
                  setBudgetEdited(true)
                }}
                inputMode="decimal"
                size={8}
              />{" "}
              {h.maxPrice.currency}
            </label>
            <Button onClick={create} disabled={busy !== null || !(Number(budget) > 0) || !priceGiven}>
              {busy === "create" ? "Saving and matching…" : "Save rule"}
            </Button>
          </div>
          <p className="muted small">New rules start in confirm mode: nothing is bought until you sign for it.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Panel>
  )
}
