import type { ReactNode } from "react"
import { Shell } from "@/components/Shell"

/** The marketplace routes (/, /market, /agent) share one shell and one account. /design keeps its own. */
export default function ShopLayout({ children }: { children: ReactNode }) {
  return <Shell>{children}</Shell>
}
