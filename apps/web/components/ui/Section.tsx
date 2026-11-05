import type { ReactNode } from "react"
import { cx } from "@/lib/cx"

/**
 * A full-width band of the page with a title and an optional eyebrow above it.
 * The id is the anchor the header links to. Styles: styles/ui.css (.section).
 */
export function Section(props: { id?: string; eyebrow?: ReactNode; title: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={cx("section", props.className)} id={props.id}>
      <div className="section-head">
        {props.eyebrow ? (
          <div>
            <p className="eyebrow">{props.eyebrow}</p>
            <h2>{props.title}</h2>
          </div>
        ) : (
          <h2>{props.title}</h2>
        )}
      </div>
      {props.children}
    </section>
  )
}
