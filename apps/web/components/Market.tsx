"use client"

import type { CSSProperties } from "react"
import { useMemo, useState } from "react"
import { ago, GRADERS, SETS, setTheme } from "@/lib/art"
import { label, money } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { Slab } from "./Slab"

type Sort = "recent" | "price_asc" | "price_desc" | "grade"

const SORTS: ReadonlyArray<[Sort, string]> = [
  ["recent", "Recently listed"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["grade", "Highest grade"]
]

/** Prices in different currencies only need a rough order for sorting. */
const roughUsd = (l: Listing) =>
  l.price.currency === "JPY" ? l.price.amountMinor / 150 : l.price.amountMinor / (l.price.currency === "EUR" ? 92 : 100)

/**
 * The newest listings as a card grid. Seller text is not shown here; where it
 * is shown (a rule's matches), it is plain text, because it is untrusted and
 * some of it is written to trick the agent.
 */
export function Market(props: {
  listings: ReadonlyArray<Listing> | null
  failed: boolean
  query: string
  onQuery: (q: string) => void
  set: string
  onSet: (id: string) => void
}) {
  const [sort, setSort] = useState<Sort>("recent")
  const { listings, query, set } = props

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of listings ?? []) {
      const id = setTheme(l)?.id
      if (id) m.set(id, (m.get(id) ?? 0) + 1)
    }
    return m
  }, [listings])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = (listings ?? []).filter((l) => {
      if (set !== "all" && setTheme(l)?.id !== set) return false
      if (q === "") return true
      return [l.cardName, l.setName, l.title, l.grader, GRADERS[l.grader] ?? "", l.sellerHandle].some((s) =>
        s.toLowerCase().includes(q)
      )
    })
    const sorted = [...rows]
    if (sort === "price_asc") sorted.sort((a, b) => roughUsd(a) - roughUsd(b))
    if (sort === "price_desc") sorted.sort((a, b) => roughUsd(b) - roughUsd(a))
    if (sort === "grade") sorted.sort((a, b) => b.grade - a.grade)
    if (sort === "recent") sorted.sort((a, b) => b.listedAt.localeCompare(a.listedAt))
    return sorted
  }, [listings, query, set, sort])

  return (
    <section className="section" id="market">
      <div className="section-head">
        <div>
          <p className="eyebrow">Live on devnet</p>
          <h2>On the market now</h2>
        </div>
      </div>

      <nav className="tabs" aria-label="Filter by set">
        <button className={`tab ${set === "all" ? "active" : ""}`} onClick={() => props.onSet("all")}>
          All <span className="count">{listings?.length ?? 0}</span>
        </button>
        {SETS.map((s) => (
          <button key={s.id} className={`tab ${set === s.id ? "active" : ""}`} onClick={() => props.onSet(s.id)}>
            {s.name} <span className="count">{counts.get(s.id) ?? 0}</span>
          </button>
        ))}
      </nav>

      <div className="toolbar">
        <label className="search">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => props.onQuery(e.target.value)}
            placeholder="Search cards, sets, graders, sellers"
            aria-label="Search listings"
          />
        </label>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort listings">
          {SORTS.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {listings === null && !props.failed && (
        <div className="grid">
          {Array.from({ length: 10 }, (_, i) => (
            <div className="tile skeleton" key={i} />
          ))}
        </div>
      )}
      {listings === null && props.failed && <p className="empty">Listings are not reachable right now.</p>}
      {listings !== null && shown.length === 0 && (
        <p className="empty">
          Nothing matches right now. New listings arrive about once a minute.{" "}
          {(query || set !== "all") && (
            <button
              className="link"
              onClick={() => {
                props.onQuery("")
                props.onSet("all")
              }}
            >
              Clear the filters
            </button>
          )}
        </p>
      )}

      <div className="grid">
        {shown.map((l) => (
          <ListingTile key={l.listingId} l={l} />
        ))}
      </div>
    </section>
  )
}

export function ListingTile({ l }: { l: Listing }) {
  const theme = setTheme(l)
  return (
    <article className="tile" style={{ "--tone": theme?.tone } as CSSProperties}>
      <div className="tile-media">
        <Slab card={l} />
      </div>
      <div className="tile-body">
        <span className="badge">
          {l.grader} {l.grade}
        </span>
        <h3 className="tile-title">{l.cardName}</h3>
        <p className="tile-meta">
          {theme?.year ?? ""} · {l.setName} #{l.cardNumber} · {label(l.edition)}
          {l.finish === "non_holo" ? "" : ` ${label(l.finish)}`}
        </p>
        <div className="tile-price">
          <span className="price">{money(l.price)}</span>
          {l.price.currency !== "USD" && <span className="chip warn">{l.price.currency}</span>}
        </div>
        <p className="tile-foot">
          <span>@{l.sellerHandle}</span>
          <span>{ago(l.listedAt)}</span>
        </p>
      </div>
    </article>
  )
}

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
