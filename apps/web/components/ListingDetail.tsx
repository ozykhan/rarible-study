import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { ago, GRADERS, gradeWord, setTheme, UNKNOWN_TONE } from "@/lib/art"
import { redFlagText, variant } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { AgentStrip } from "./AgentStrip"
import { FLAG_LABEL } from "./Checkout"
import { Slab } from "./Slab"
import { Badge, Pill } from "./ui"

/**
 * One listing in full: the breadcrumb, the slab large on a backdrop in the
 * set's tone, the card's name with its grade and the code's checks, then the
 * price panel the page passes in (`buy`), The slab with its facts and the
 * seller's own words, and the optional agent's line. Seller text is untrusted,
 * so it is plain text in a well. Styles: styles/listing.css.
 */
export function ListingDetail({ l, buy, onAgent }: { l: Listing; buy: ReactNode; onAgent: () => void }) {
  const theme = setTheme(l)
  const flags = l.redFlags ?? []
  const tone = { "--tone": theme?.tone ?? UNKNOWN_TONE } as CSSProperties
  return (
    <section className="section listing-page" style={tone}>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            <Link href="/market">Market</Link>
          </li>
          <li>
            <Link href={theme ? `/market?set=${theme.id}` : "/market"}>{l.setName}</Link>
          </li>
          <li aria-current="page">{l.cardName}</li>
        </ol>
      </nav>

      <div className="listing-detail">
        <div className="listing-stage">
          <div className="listing-slab">
            <Slab card={l} eager />
          </div>
        </div>

        <div className="listing-side">
          <header className="listing-head">
            <p className="listing-set">
              <span className="set-dot" aria-hidden="true" />
              <span>
                {l.setName}
                {theme && (
                  <>
                    {" · "}
                    <span className="mono">{theme.year}</span>
                  </>
                )}
                {" · "}
                <span className="mono">#{l.cardNumber}</span>
              </span>
            </p>
            <h1>
              {l.cardName}, {variant(l)}
            </h1>
            <div className="pills">
              <Badge>
                {l.grader} {l.grade}
              </Badge>
              <Pill>{gradeWord(l.grade)}</Pill>
              {flags.length === 0 ? (
                <Pill tone="ok">No red flags</Pill>
              ) : (
                flags.map((f) => (
                  <Pill key={f} tone="warn">
                    {FLAG_LABEL[f]}
                  </Pill>
                ))
              )}
            </div>
          </header>

          {buy}

          <section className="panel listing-panel" aria-labelledby="listing-slab">
            <h2 id="listing-slab">The slab</h2>
            <dl className="facts listing-facts">
              <dt>Grader</dt>
              <dd>{GRADERS[l.grader] ?? l.grader}</dd>
              <dt>Grade</dt>
              <dd>
                {l.grade}, {gradeWord(l.grade)}
              </dd>
              <dt>Cert</dt>
              <dd>{l.certNumber}</dd>
              <dt>Seller</dt>
              <dd>@{l.sellerHandle}</dd>
              <dt>Listed</dt>
              <dd>{ago(l.listedAt)}</dd>
            </dl>
            <p className="muted small">
              {flags.length === 0
                ? "Grade, grader and cert come from the vault record, and the code checks found no red flags."
                : `${flags.map((f) => redFlagText[f]).join(". ")}.`}
            </p>
            <h3>From the seller</h3>
            <pre className="seller-text">
              {l.title}
              {"\n\n"}
              {l.description}
            </pre>
          </section>

          <AgentStrip
            title="Want it cheaper?"
            text="The agent can watch for this card at a lower price. It checks every new listing with code first, and buys only what you sign for."
            action="Ask the agent"
            onOpen={onAgent}
          />
        </div>
      </div>
    </section>
  )
}
