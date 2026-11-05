import { GRADERS } from "@/lib/art"
import { Section } from "./ui"

/** What each grader's slab label looks like. The colors are the --grader-<code>-* tokens. */
const LABELS: Record<string, string> = {
  NVG: "Red stripe on a white label",
  QSG: "Gold stripe on a black label",
  LCA: "Teal stripe on a cream label"
}

/**
 * The three fictional graders, each with a small label in its own colors.
 * Styles: styles/home.css (.graders), with the label colors from styles/slab.css.
 */
export function Graders() {
  return (
    <Section id="graders" title="Graders we list">
      <div className="graders">
        {Object.entries(GRADERS).map(([code, name]) => (
          <div className="grader" key={code}>
            <span className={`grader-label grader-${code}`}>{code}</span>
            <span className="grader-text">
              <strong>{name}</strong>
              <span className="muted small">{LABELS[code]}</span>
            </span>
          </div>
        ))}
      </div>
    </Section>
  )
}
