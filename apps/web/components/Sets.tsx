import type { CSSProperties } from "react"
import { SETS, setArt, setTheme } from "@/lib/art"
import type { Listing } from "@/lib/types"

/** The four fictional sets, with generated banners and how many of each are listed now. */
export function Sets(props: { listings: ReadonlyArray<Listing> | null; active: string; onPick: (id: string) => void }) {
  const count = (id: string) => props.listings?.filter((l) => setTheme(l)?.id === id).length
  return (
    <section className="section" id="sets">
      <div className="section-head">
        <h2>Browse by set</h2>
      </div>
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
        {SETS.map((s) => {
          const n = count(s.id)
          return (
            <button
              key={s.id}
              className="set-card"
              style={{ "--tone": s.tone } as CSSProperties}
              onClick={() => props.onPick(s.id)}
            >
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
        })}
      </div>
    </section>
  )
}
