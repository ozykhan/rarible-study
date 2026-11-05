import Link from "next/link"
import type { CSSProperties } from "react"
import { SETS, setArt, setTheme, type SetTheme } from "@/lib/art"
import { dusd } from "@/lib/format"
import type { Listing, MarketStats } from "@/lib/types"
import { Section } from "./ui"

/**
 * The four fictional sets as banner cards with how many of each are listed and
 * the lowest price. With onPick (the market) there are filter chips above and
 * a card filters the grid; without it (the home page) each card links to the
 * market filtered by its set. Styles: styles/sets.css.
 */
export function Sets(props: {
  listings: ReadonlyArray<Listing> | null
  stats: MarketStats | null
  active?: string
  onPick?: (id: string) => void
}) {
  const count = (id: string) => props.stats?.sets[id]?.count ?? props.listings?.filter((l) => setTheme(l)?.id === id).length
  const floor = (id: string) => props.stats?.sets[id]?.floorUnits ?? null
  const { onPick } = props
  return (
    <Section
      id="sets"
      title="Browse by set"
      aside={
        onPick === undefined && (
          <Link className="section-link" href="/market">
            All sets
          </Link>
        )
      }
    >
      {onPick && (
        <div className="chips">
          {SETS.map((s) => (
            <button
              key={s.id}
              className={`chip-btn ${props.active === s.id ? "active" : ""}`}
              style={{ "--tone": s.tone } as CSSProperties}
              onClick={() => onPick(s.id)}
            >
              <span className="dot" /> {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="set-grid">
        {SETS.map((s) => (
          <SetCard
            key={s.id}
            set={s}
            count={count(s.id)}
            floorUnits={floor(s.id)}
            {...(onPick ? { onPick: () => onPick(s.id) } : { href: `/market?set=${s.id}` })}
          />
        ))}
      </div>
    </Section>
  )
}

/**
 * A set's generated banner, name, year, listing count, lowest price and
 * one-line blurb. Undefined count means still loading. It is a link when given
 * an href, and a button when given onPick.
 */
export function SetCard(props: {
  set: SetTheme
  count: number | undefined
  floorUnits?: number | null
  href?: string
  onPick?: () => void
}) {
  const { set: s, count: n } = props
  const style = { "--tone": s.tone } as CSSProperties
  const body = (
    <>
      <span className="set-media">
        <img src={setArt(s.id)} alt="" loading="lazy" decoding="async" width={768} height={432} />
      </span>
      <span className="set-body">
        <strong>{s.name}</strong>
        <span className="muted small">
          {s.year} · {n === undefined ? "…" : `${n} listed`}
          {props.floorUnits != null && <span className="mono"> · from {dusd(props.floorUnits)}</span>}
        </span>
        <span className="set-blurb">{s.blurb}</span>
      </span>
    </>
  )
  return props.href !== undefined ? (
    <Link className="set-card" style={style} href={props.href}>
      {body}
    </Link>
  ) : (
    <button className="set-card" style={style} onClick={props.onPick}>
      {body}
    </button>
  )
}
