import type { ReactNode } from "react"

/** The grader and grade on a listing tile, in mono and the accent. Styles: styles/ui.css (.badge). */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="badge">{children}</span>
}
