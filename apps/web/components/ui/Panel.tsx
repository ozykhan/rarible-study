import type { ReactNode } from "react"
import { cx } from "@/lib/cx"

/**
 * A bordered box on the signed-in desk. Titles are h2; titled blocks inside a
 * panel use h3, which renders as an uppercase label. Styles: styles/ui.css (.panel).
 */
export function Panel({ title, className, children }: { title?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <section className={cx("panel", className)}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  )
}
