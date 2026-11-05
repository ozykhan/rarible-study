import { cx } from "@/lib/cx"
import { money } from "@/lib/format"
import type { Rule } from "@/lib/types"
import { Button, Panel } from "./ui"

/** The collector's watch rules as a pickable list, with sign out under it. Styles: styles/desk.css (.rule-list, .rule-item). */
export function RuleList(props: {
  rules: ReadonlyArray<Rule>
  selected: string | null
  onSelect: (id: string) => void
  onSignOut: () => void
}) {
  return (
    <Panel title="Your rules">
      {props.rules.length === 0 && <p className="muted small">No rules yet.</p>}
      <ul className="rule-list">
        {props.rules.map((r) => (
          <li key={r.id}>
            <button className={cx("rule-item", props.selected === r.id && "active")} onClick={() => props.onSelect(r.id)}>
              <span>{r.rawWant}</span>
              <span className="muted small">
                {r.status} · {r.mode === "auto" ? "auto-buy" : "confirm"} · budget {money(r.budget)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Button variant="link" onClick={props.onSignOut}>
        Sign out
      </Button>
    </Panel>
  )
}
