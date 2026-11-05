import type { ReactNode } from "react"
import { cx } from "@/lib/cx"

export type PillTone = "ok" | "warn" | "bad"

/**
 * An outlined status label: a rule's status and mode, a purchase's state, an
 * agent run's outcome. No tone means neutral. Styles: styles/ui.css (.pill).
 */
export function Pill({ tone, children }: { tone?: PillTone | null; children: ReactNode }) {
  return <span className={cx("pill", tone)}>{children}</span>
}
