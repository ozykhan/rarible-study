import type { Status } from "@/lib/types"

/** The safety line under the header. It stays on every view. */
export function DevnetNotice() {
  return (
    <div className="devnet-notice">
      <strong>Solana devnet only.</strong> Every card, seller and grader here is invented, and dUSD is a test token with no value.
      Never use a wallet that holds real funds on mainnet for experiments like this one.
    </div>
  )
}

/** The bar pinned to the bottom of the page: what the backend is doing right now. */
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
              <i className={`led ${status.payments === "devnet" ? "on" : ""}`} />
              {status.payments === "devnet" ? "SPL on devnet" : "Simulated ledger"}
            </span>
            <span>
              <i className={`led ${status.agentEnabled ? "on" : ""}`} />
              Agent {status.agentEnabled ? "on" : "off"}
            </span>
            <span className="mono">
              Model ${status.llm.spentTodayUsd.toFixed(2)} / ${status.llm.dailyCapUsd.toFixed(2)}
            </span>
            {status.readOnly && <span className="chip warn">read-only demo</span>}
          </>
        )}
      </span>
    </footer>
  )
}
