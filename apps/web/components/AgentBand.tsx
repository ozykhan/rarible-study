import Link from "next/link"
import { AgentIcon, Pill } from "./ui"

/**
 * A quiet band near the bottom of the home page: the agent is optional, and
 * buying never needs it. Styles: styles/home.css (.agent-band).
 */
export function AgentBand() {
  return (
    <section id="agent" className="section">
      <div className="agent-band">
        <span className="agent-band-icon">
          <AgentIcon size={24} />
        </span>
        <div className="agent-band-text">
          <div className="agent-band-title">
            <h2>Can't find it? Let the agent watch for it.</h2>
            <Pill>optional</Pill>
          </div>
          <p>
            Describe the card, the grade and your top price. The agent checks every new listing with code first, and buys only what
            you sign for: each buy, or a budget you approve.
          </p>
        </div>
        <Link className="btn btn-lg btn-secondary agent-band-link" href="/agent">
          Set up a watch
        </Link>
      </div>
    </section>
  )
}
