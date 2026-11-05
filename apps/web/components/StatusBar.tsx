import type { Status } from "@/lib/types"

export function StatusBar({ status }: { status: Status | null }) {
  return (
    <div className="notice">
      <strong>Solana devnet only.</strong> Every card, seller and grader here is invented, and dUSD is a test token with no
      value. Never use a wallet that holds real funds on mainnet for experiments like this one.
      {status && (
        <div className="status-line">
          <span>Payments: {status.payments === "devnet" ? "SPL transfers on devnet" : "simulated ledger"}</span>
          <span>Agent: {status.agentEnabled ? "on" : "off"}</span>
          <span>
            Model budget today: ${status.llm.spentTodayUsd.toFixed(2)} of ${status.llm.dailyCapUsd.toFixed(2)}
          </span>
          {status.readOnly && <span className="pill warn">read-only demo: no purchases</span>}
        </div>
      )}
    </div>
  )
}
