import { cx } from "@/lib/cx"

/** A status dot: green with a glow when on, grey when off. Styles: styles/ui.css (.led). */
export function Led({ on }: { on: boolean }) {
  return <i className={cx("led", on && "on")} aria-hidden="true" />
}
