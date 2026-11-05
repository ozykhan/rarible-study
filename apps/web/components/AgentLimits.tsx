import { money } from "@/lib/format"
import type { Rule, Status } from "@/lib/types"
import { Led, Panel, Pill, type PillTone } from "./ui"

/**
 * What the agent may do right now, read from the server's status and the
 * collector's watches: code checks new listings while a watch is on, agent
 * runs only where the server turns them on, and buying without asking only
 * for watches with a signed approval. Styles: styles/desk.css (.limits).
 */
export function AgentLimits({ status, rules }: { status: Status; rules: ReadonlyArray<Rule> }) {
  const active = rules.filter((r) => r.status === "active")
  const auto = active.filter((r) => r.mode === "auto").length
  const runs = status.agentEnabled && !status.readOnly
  const rows: ReadonlyArray<{ text: string; on: boolean; word: string; tone?: PillTone }> = [
    { text: "Check every new listing against your watches", on: active.length > 0, word: active.length > 0 ? "on" : "no watch on" },
    { text: "Show you each match here", on: true, word: "on" },
    { text: "Run the agent on a new match", on: runs, word: runs ? "on" : "off on this server" },
    {
      text: "Buy without asking",
      on: auto > 0,
      word: auto > 0 ? `approved for ${auto} watch${auto === 1 ? "" : "es"}` : "off",
      ...(auto > 0 ? { tone: "warn" as const } : {})
    }
  ]
  return (
    <Panel title="What the agent may do">
      <ul className="limits">
        {rows.map((r) => (
          <li key={r.text}>
            <Led on={r.on} />
            <span>{r.text}</span>
            <Pill tone={r.tone ?? (r.on ? "ok" : null)}>{r.word}</Pill>
          </li>
        ))}
      </ul>
      <p className="muted small">
        Code checks every purchase before money moves, and this server pays at most{" "}
        <span className="mono">{money({ amountMinor: status.purchaseDailyCapUsd * 100, currency: "USD" })}</span> a day per
        wallet.
      </p>
    </Panel>
  )
}
