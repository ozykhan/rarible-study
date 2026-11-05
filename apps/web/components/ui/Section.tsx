import type { ReactNode } from "react"
import { cx } from "@/lib/cx"

/**
 * A full-width band of the page with a title, an optional eyebrow above it, a
 * line under it and a link or control at the right of the title row. The id
 * is the anchor the header links to. Styles: styles/ui.css (.section).
 */
export function Section(props: {
  id?: string
  eyebrow?: ReactNode
  title: ReactNode
  lede?: ReactNode
  aside?: ReactNode
  className?: string
  children?: ReactNode
}) {
  return (
    <section className={cx("section", props.className)} id={props.id}>
      <div className="section-head">
        {props.eyebrow || props.lede ? (
          <div>
            {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
            <h2>{props.title}</h2>
            {props.lede && <p className="section-lede">{props.lede}</p>}
          </div>
        ) : (
          <h2>{props.title}</h2>
        )}
        {props.aside}
      </div>
      {props.children}
    </section>
  )
}
