import { cx } from "@/lib/cx"
import { money } from "@/lib/format"
import type { Rule } from "@/lib/types"
import { Led, Panel } from "./ui"

const STATUS_WORD: Record<Rule["status"], string> = { active: "watching", paused: "paused", exhausted: "budget used", draft: "draft" }

/** A box with an arrow leaving it: the Manage link opens something over the page. */
function OpenIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * The collector's watches as a pickable list: a light that is on while the
 * watch is active, the want, and its top price and state. Manage your
 * watches, at the top right, opens ManageWatches, which also counts how many
 * are on. On /agent the list is as tall as the watch beside it and scrolls
 * inside the panel.
 * Styles: styles/desk.css (.rules, .rule-list, .rule-item, .manage-link).
 */
export function RuleList(props: {
  rules: ReadonlyArray<Rule>
  selected: string | null
  onSelect: (id: string) => void
  onManage?: () => void
}) {
  return (
    <Panel className="rules">
      <div className="panel-head">
        <h2>Your watches</h2>
        {props.onManage && (
          <button type="button" className="manage-link" onClick={props.onManage} aria-haspopup="dialog">
            <span>Manage your watches</span>
            <OpenIcon />
          </button>
        )}
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
    </Panel>
  )
}
