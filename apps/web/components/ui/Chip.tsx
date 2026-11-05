import type { ReactNode } from "react"
import { cx } from "@/lib/cx"

/**
 * A tinted tag that flags a condition: "devnet", "read-only demo", a non-USD
 * currency. Only the warn tone exists so far. Styles: styles/ui.css (.chip).
 */
export function Chip({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  return <span className={cx("chip", tone)}>{children}</span>
}
