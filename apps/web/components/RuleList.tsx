import { cx } from "@/lib/cx"
import { money } from "@/lib/format"
import type { Rule } from "@/lib/types"
import { Button, Led, Panel } from "./ui"

const STATUS_WORD: Record<Rule["status"], string> = { active: "watching", paused: "paused", exhausted: "budget used", draft: "draft" }

/**
 * The collector's watches as a pickable list: a light that is on while the
 * watch is active, the want, and its top price and state. New watch and Sign
 * out sit under it. Styles: styles/desk.css (.rule-list, .rule-item).
 */
export function RuleList(props: {
  rules: ReadonlyArray<Rule>
  selected: string | null
  onSelect: (id: string) => void
  onNew?: () => void
  onSignOut: () => void
}) {
  const on = props.rules.filter((r) => r.status === "active").length
  return (
    <Panel className="rules">
      <div className="panel-head">
        <h2>Your watches</h2>
        <span className="mono muted small">
          {on} of {props.rules.length} on
        </span>
      </div>
      {props.rules.length === 0 && <p className="muted small">No watches yet.</p>}
      <ul className="rule-list">
        {props.rules.map((r) => (
          <li key={r.id}>
            <button
              className={cx("rule-item", props.selected === r.id && "active")}
              aria-current={props.selected === r.id ? "true" : undefined}
              onClick={() => props.onSelect(r.id)}
            >
              <Led on={r.status === "active"} />
              <span className="rule-item-text">
                <span>{r.rawWant}</span>
                <span className="mono muted small">
                  up to {money(r.hard.maxPrice)} · {STATUS_WORD[r.status]}
                  {r.mode === "auto" ? " · buys without asking" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        {props.onNew && (
          <Button variant="secondary" size="sm" onClick={props.onNew}>
            New watch
          </Button>
        )}
        <Button variant="link" onClick={props.onSignOut}>
          Sign out
        </Button>
      </div>
    </Panel>
  )
}
