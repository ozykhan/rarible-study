import Link from "next/link"
import type { CSSProperties } from "react"
import { SETS, setArt, setTheme, type SetTheme } from "@/lib/art"
import { dusd } from "@/lib/format"
import type { Listing, MarketStats } from "@/lib/types"
import { Section } from "./ui"

/**
 * Browse by set on the home page: the four fictional sets as banner cards
 * with how many of each are listed and the lowest price. Each card links to
 * the market filtered by its set. Styles: styles/sets.css.
 */
export function Sets(props: { listings: ReadonlyArray<Listing> | null; stats: MarketStats | null }) {
  const count = (id: string) => props.stats?.sets[id]?.count ?? props.listings?.filter((l) => setTheme(l)?.id === id).length
  const floor = (id: string) => props.stats?.sets[id]?.floorUnits ?? null
  return (
    <Section
      id="sets"
      title="Browse by set"
      aside={
        <Link className="section-link" href="/market">
          All sets
        </Link>
      }
    >
      <div className="set-grid">
        {SETS.map((s) => (
          <SetCard key={s.id} set={s} count={count(s.id)} floorUnits={floor(s.id)} href={`/market?set=${s.id}`} />
        ))}
      </div>
    </Section>
  )
}

/**
 * A link to one set on the market: its generated banner, name, year, listing
 * count, lowest price and one-line blurb. Undefined count means still loading.
 */
export function SetCard(props: { set: SetTheme; count: number | undefined; floorUnits?: number | null; href: string }) {
  const { set: s, count: n } = props
  return (
    <Link className="set-card" style={{ "--tone": s.tone } as CSSProperties} href={props.href}>
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
    </Link>
  )
}
