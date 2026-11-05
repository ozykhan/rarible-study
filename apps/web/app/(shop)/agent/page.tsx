import type { Metadata } from "next"
import { Suspense } from "react"
import { AgentDesk } from "./AgentDesk"

export const metadata: Metadata = { title: "Agent · Slabwatch" }

/** /agent: the optional agent's desk. It reads ?watch= on the client, so it renders inside Suspense. */
export default function AgentPage() {
  return (
    <Suspense>
      <AgentDesk />
    </Suspense>
  )
}
