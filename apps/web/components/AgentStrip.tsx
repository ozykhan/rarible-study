import { AgentIcon, Button } from "./ui"

/**
 * One quiet line that offers the optional agent: under the market's grid
 * ("Not listed yet?") and on a listing page ("Want it cheaper?"). Its button
 * opens the agent drawer. Styles: styles/agent-drawer.css (.agent-strip).
 */
export function AgentStrip({
  onOpen,
  title = "Not listed yet? Let the agent watch for it.",
  text = "Describe the card and your top price. It checks every new listing with code first, and buys only what you sign for.",
  action = "Set up a watch"
}: {
  onOpen: () => void
  title?: string
  text?: string
  action?: string
}) {
  return (
    <div className="agent-strip">
      <span className="agent-strip-icon">
        <AgentIcon size={20} />
      </span>
      <div className="agent-strip-text">
        <strong>{title}</strong>
        <span className="muted small">{text}</span>
      </div>
      <Button variant="secondary" onClick={onOpen}>
        {action}
      </Button>
    </div>
  )
}
