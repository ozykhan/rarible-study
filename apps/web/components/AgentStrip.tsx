import { AgentIcon, Button } from "./ui"

/**
 * One quiet line under the market's grid: when the card is not listed, the
 * optional agent can watch for it. Styles: styles/agent-drawer.css (.agent-strip).
 */
export function AgentStrip({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="agent-strip">
      <span className="agent-strip-icon">
        <AgentIcon size={20} />
      </span>
      <div className="agent-strip-text">
        <strong>Not listed yet? Let the agent watch for it.</strong>
        <span className="muted small">
          Describe the card and your top price. It checks every new listing with code first, and buys only what you sign for.
        </span>
      </div>
      <Button variant="secondary" onClick={onOpen}>
        Set up a watch
      </Button>
    </div>
  )
}
