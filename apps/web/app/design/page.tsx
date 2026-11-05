import type { Metadata } from "next"
import { DesignSystem } from "./DesignSystem"
import "./design-page.css"

export const metadata: Metadata = {
  title: "Design system · Slabwatch",
  description: "Every token and component of the Slabwatch web page, with fictional sample data.",
  robots: { index: false }
}

/** /design: a living reference of the design system. It needs no backend. */
export default function DesignPage() {
  return <DesignSystem />
}
