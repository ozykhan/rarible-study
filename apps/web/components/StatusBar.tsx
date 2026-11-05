import type { Status } from "@/lib/types"
import { Chip } from "./ui"

/** The bar pinned to the bottom of the page: what the backend is doing right now. Styles: styles/status-bar.css. */
export function StatusBar({ status, loaded }: { status: Status | null; loaded: boolean }) {
  return (
    <footer className="statusbar">
      <span className="statusbar-left">
        <span className="brand-mini">Slabwatch</span>
        <span className="hide-sm">A study project. Everything here is fictional.</span>
      </span>
      <span className="statusbar-right">
        {!loaded && <span>Connecting…</span>}
        {loaded && status === null && <span className="error">Backend not reachable</span>}
        {status && (
          <>
            <span>
              <Led on={status.payments === "devnet"} />
              {status.payments === "devnet" ? "SPL on devnet" : "Simulated ledger"}
            </span>
            <span>
              <Led on={status.agentEnabled} />
              Agent {status.agentEnabled ? "on" : "off"}
            </span>
            <span className="mono">
              Model ${status.llm.spentTodayUsd.toFixed(2)} / ${status.llm.dailyCapUsd.toFixed(2)}
            </span>
            {status.readOnly && <Chip tone="warn">read-only demo</Chip>}
          </>
        )}
      </span>
    </footer>
  )
}

/** A status dot: green with a glow when on, grey when off. */
function Led({ on }: { on: boolean }) {
  return <i className={on ? "led on" : "led"} />
}
