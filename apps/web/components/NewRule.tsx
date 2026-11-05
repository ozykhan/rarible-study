"use client"

import { useState } from "react"
import { api } from "@/lib/api"
import { label, money, toMajor, toMinor } from "@/lib/format"
import type { Draft, Rule } from "@/lib/types"
import { useAction } from "@/lib/useAction"

const EXAMPLES = [
  "Ashen Wyrm, 1st edition holo, grade 9 or better from NVG or QSG, up to $900",
  "any water creature from Tidewild, holo, grade 8 or better, under $250",
  "an Emberfall dragon in grade 10, any grader, max $1,500"
]

/**
 * Plain language in, a watch rule out. The model fills the fields; code maps
 * names to catalog ids and asks when something is unclear. Nothing is saved
 * until the collector confirms.
 */
export function NewRule(props: { token: string; onCreated: (rule: Rule, note: string) => void }) {
  const [want, setWant] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [budget, setBudget] = useState("")
  const { busy, error, run } = useAction()

  const makeDraft = () =>
    run("draft", async () => {
      const d = await api<Draft>("/rules/draft", { token: props.token, body: { want } })
      setDraft(d)
      const max = d.draft.hard.maxPrice
      setBudget(String(toMajor(max.amountMinor, max.currency) * 2 || ""))
    })

  const create = () =>
    run("create", async () => {
      if (draft === null) return
      const currency = draft.draft.hard.maxPrice.currency
      const r = await api<{ rule: Rule; matches: number; needsReview: number; unjudgedReason: string | null }>("/rules", {
        token: props.token,
        body: {
          rawWant: draft.draft.rawWant,
          hard: draft.draft.hard,
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
  return (
    <section className="card">
      <h2>New watch rule</h2>
      <textarea
        value={want}
        onChange={(e) => setWant(e.target.value)}
        placeholder={EXAMPLES[0]}
        rows={3}
        maxLength={500}
      />
      <div className="row">
        <button onClick={makeDraft} disabled={busy !== null || want.trim().length < 3}>
          {busy === "draft" ? "Reading…" : "Draft the rule"}
        </button>
        <span className="muted small">
          Try: <button className="link" onClick={() => setWant(EXAMPLES[1] ?? "")}>{EXAMPLES[1]}</button>
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
            <dd>at most {money(h.maxPrice)}</dd>
            <dt>Also wants</dt>
            <dd>{draft.draft.softDescription ?? "nothing else"}</dd>
          </dl>
          {draft.draft.questions.length > 0 && (
            <div className="questions">
              <strong>Before you save, the parser asks:</strong>
              <ul>
                {draft.draft.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <p className="muted small">Edit the text above and draft again to answer.</p>
            </div>
          )}
          <div className="row">
            <label>
              Budget for this rule
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" size={8} />{" "}
              {h.maxPrice.currency}
            </label>
            <button onClick={create} disabled={busy !== null || !(Number(budget) > 0) || !(h.maxPrice.amountMinor > 0)}>
              {busy === "create" ? "Saving and matching…" : "Save rule"}
            </button>
          </div>
          <p className="muted small">New rules start in confirm mode: nothing is bought until you sign for it.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}
