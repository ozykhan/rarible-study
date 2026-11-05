import type { CSSProperties } from "react"
import { SETS, setArt, setTheme, type SetTheme } from "@/lib/art"
import type { Listing } from "@/lib/types"
import { Section } from "./ui"

/** The four fictional sets as filter chips and banner cards, with how many of each are listed now. Styles: styles/sets.css. */
export function Sets(props: { listings: ReadonlyArray<Listing> | null; active: string; onPick: (id: string) => void }) {
  const count = (id: string) => props.listings?.filter((l) => setTheme(l)?.id === id).length
  return (
    <Section id="sets" title="Browse by set">
      <div className="chips">
        {SETS.map((s) => (
          <button
            key={s.id}
            className={`chip-btn ${props.active === s.id ? "active" : ""}`}
            style={{ "--tone": s.tone } as CSSProperties}
            onClick={() => props.onPick(s.id)}
          >
            <span className="dot" /> {s.name}
          </button>
        ))}
      </div>
      <div className="set-grid">
        {SETS.map((s) => (
          <SetCard key={s.id} set={s} count={count(s.id)} onPick={() => props.onPick(s.id)} />
        ))}
      </div>
    </Section>
  )
}

/** A set's generated banner, name, year, listing count and one-line blurb. Undefined count means still loading. */
export function SetCard({ set: s, count: n, onPick }: { set: SetTheme; count: number | undefined; onPick: () => void }) {
  return (
    <button className="set-card" style={{ "--tone": s.tone } as CSSProperties} onClick={onPick}>
      <span className="set-media">
        <img src={setArt(s.id)} alt="" loading="lazy" decoding="async" width={768} height={432} />
      </span>
      <span className="set-body">
        <strong>{s.name}</strong>
        <span className="muted small">
          {s.year} · {n === undefined ? "…" : `${n} listing${n === 1 ? "" : "s"}`}
        </span>
        <span className="set-blurb">{s.blurb}</span>
      </span>
    </button>
  )
}
