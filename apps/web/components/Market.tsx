"use client"

import Link from "next/link"
import type { CSSProperties } from "react"
import { cardId, GRADERS, SETS, UNKNOWN_TONE } from "@/lib/art"
import { cx } from "@/lib/cx"
import { count as fmt, dusd } from "@/lib/format"
import { MARKET_SORTS, type MarketFilters, type useMarket } from "@/lib/market"
import type { Listing, SetRef } from "@/lib/types"
import { AgentStrip } from "./AgentStrip"
import { ListingTile } from "./ListingTile"
import { MarketSearch } from "./MarketSearch"
import { Button } from "./ui"

/** Up to this many sets, every set is a tab. Past it the tabs get their own row and show the biggest few; the rest go in a menu. */
const MAX_TABS = 8
const TOP_TABS = 6

const toneOf = (id: string) => SETS.find((s) => s.id === id)?.tone ?? UNKNOWN_TONE

/**
 * The set tabs: every set when there are few, otherwise the ones with the
 * most matches (or, when matches were not counted per set, the most
 * listings) plus the one picked, always in catalog order so tabs do not
 * jump around as counts change.
 */
const splitSets = (sets: ReadonlyArray<SetRef>, rank: (id: string) => number, picked: string) => {
  if (sets.length <= MAX_TABS) return { tabs: sets, rest: [] }
  const top = new Set(
    [...sets]
      .sort((a, b) => rank(b.id) - rank(a.id))
      .slice(0, TOP_TABS)
      .map((s) => s.id)
  )
  top.add(picked)
  return { tabs: sets.filter((s) => top.has(s.id)), rest: sets.filter((s) => !top.has(s.id)) }
}

/** The market URL for a search, keeping the other filters. */
const searchHref = (f: MarketFilters, q: string) => {
  const p = new URLSearchParams()
  if (f.set !== "all") p.set("set", f.set)
  if (f.grader !== "all") p.set("grader", f.grader)
  p.set("q", q)
  if (f.sort !== "recent") p.set("sort", f.sort)
  return `/market?${p.toString()}`
}

/**
 * The whole market: a head with two live numbers, set tabs with counts (from
 * the server, so a catalog of hundreds of sets works), the grader and sort
 * selects, what the search was read as, the grid of ListingTiles with Show
 * more, and the optional agent's line under it. Filtering, search, sort and
 * paging happen on the server, over every active listing. Seller text is not shown here;
 * where it is shown (the listing, a watch's matches), it is plain text,
 * because it is untrusted. Styles: styles/market.css.
 */
export function Market(props: {
  filters: MarketFilters
  onFilter: (key: "set" | "grader" | "sort", value: string) => void
  onClear: () => void
  market: ReturnType<typeof useMarket>
  /** Listing ids the collector bought, and card ids an active watch targets. */
  owned: ReadonlySet<string>
  watching: ReadonlySet<string>
  onBuy: (l: Listing) => void
  onWatch: (l: Listing) => void
  /** Opens the agent drawer. */
  onAgent: () => void
}) {
  const { filters: f, market: m } = props
  const filtered = f.set !== "all" || f.grader !== "all" || f.q.trim() !== ""
  // Past 10,000 matches the server stops counting: "10,000+" overall and no number per set.
  const capped = !m.exact && m.total >= 10_000
  const count = (id: string) =>
    m.counts === null ? "…" : id === "all" ? (m.exact ? fmt(m.counts.all) : "10,000+") : m.exact ? fmt(m.counts.sets[id] ?? 0) : null
  const left = m.listings === null ? 0 : m.total - m.listings.length
  // The four hand-written sets stand in until the server answers; they exist in every catalog.
  const rank = (id: string) => (m.exact ? m.counts?.sets[id] : m.stats?.sets[id]?.count) ?? 0
  const { tabs, rest } = splitSets(m.sets ?? SETS, rank, f.set)

  return (
    <>
      <section className="section market-head">
        <div className="market-head-copy">
          <p className="eyebrow">Live on devnet</p>
          <h1>Graded cards, ready to buy</h1>
          <p className="market-lede">Browse every listing, check the slab, and sign to buy.</p>
        </div>
        <dl className="market-stats">
          <div>
            <dt>listings now</dt>
            <dd>{m.stats ? fmt(m.stats.count) : "…"}</dd>
          </div>
          <div>
            <dt>lowest price</dt>
            <dd>{m.stats?.floorUnits != null ? dusd(m.stats.floorUnits) : "…"}</dd>
          </div>
        </dl>
      </section>

      <section id="market" className="section market">
        <MarketSearch id="market-search" className="market-search" />
        <div className={cx("market-bar", rest.length > 0 && "many-sets")}>
          <nav className="tabs" aria-label="Filter by set">
            {[{ id: "all", name: "All sets" }, ...tabs].map((t) => (
              <button
                key={t.id}
                className={cx("tab", f.set === t.id && "active")}
                aria-pressed={f.set === t.id}
                style={t.id === "all" ? undefined : ({ "--tone": toneOf(t.id) } as CSSProperties)}
                onClick={() => props.onFilter("set", t.id)}
              >
                <span className="set-dot" aria-hidden="true" />
                {t.name} {count(t.id) !== null && <span className="count">{count(t.id)}</span>}
              </button>
            ))}
          </nav>
          <div className="market-selects">
            {rest.length > 0 && (
              <label>
                <span className="select-word">Set</span>
                <select value="" aria-label="More sets" onChange={(e) => props.onFilter("set", e.target.value)}>
                  <option value="">{rest.length} more sets</option>
                  {rest.map((s) => (
                    <option key={s.id} value={s.id}>
                      {m.exact && m.counts !== null ? `${s.name} (${count(s.id)})` : s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="select-word">Grader</span>
              <select value={f.grader} aria-label="Grader" onChange={(e) => props.onFilter("grader", e.target.value)}>
                <option value="all">All graders</option>
                {Object.entries(GRADERS).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="select-word">Sort</span>
              <select value={f.sort} aria-label="Sort" onChange={(e) => props.onFilter("sort", e.target.value)}>
                {MARKET_SORTS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {m.listings !== null && f.q.trim() !== "" && m.understood.length > 0 && (
          <p className="market-understood">Searching for {m.understood.join(" · ")}</p>
        )}
        {m.listings !== null && m.total > 0 && (
          <p className="market-count">
            {filtered ? (
              <>
                <span className="mono">{capped ? "10,000+" : fmt(m.total)}</span> of{" "}
                <span className="mono">{m.stats ? fmt(m.stats.count) : "…"}</span>{" "}
                listings match
              </>
            ) : (
              <>
                <span className="mono">{fmt(m.total)}</span> listings
              </>
            )}
          </p>
        )}

        {m.listings === null && !m.failed && (
          <div className="grid">
            {Array.from({ length: 10 }, (_, i) => (
              <div className="tile skeleton" key={i} />
            ))}
          </div>
        )}
        {m.listings === null && m.failed && <p className="empty">Listings are not reachable right now.</p>}
        {m.listings !== null && m.listings.length === 0 && m.suggestion !== null && (
          <p className="empty">
            Nothing matches &ldquo;{f.q.trim()}&rdquo;. Did you mean{" "}
            <Link href={searchHref(f, m.suggestion)} scroll={false}>
              {m.suggestion}
            </Link>
            ?
          </p>
        )}
        {m.listings !== null && m.listings.length === 0 && m.suggestion === null && (
          <p className="empty">
            Nothing matches right now. New listings arrive about once a minute.{" "}
            {filtered && (
              <Button variant="link" size="inline" onClick={props.onClear}>
                Clear the filters
              </Button>
            )}
          </p>
        )}

        {m.listings !== null && m.listings.length > 0 && (
          <div className="grid">
            {m.listings.map((l) => (
              <ListingTile
                key={l.listingId}
                l={l}
                watching={props.watching.has(cardId(l))}
                owned={props.owned.has(l.listingId)}
                onBuy={props.onBuy}
                onWatch={props.onWatch}
              />
            ))}
          </div>
        )}

        {left > 0 && (
          <div className="market-more">
            <Button variant="secondary" size="lg" onClick={() => void m.more()} disabled={m.loadingMore}>
              {m.loadingMore ? "Loading…" : `Show ${Math.min(left, 40)} more`}
            </Button>
            <span className="muted small">
              <span className="mono">{m.listings?.length}</span> of <span className="mono">{capped ? "10,000+" : fmt(m.total)}</span> shown
            </span>
          </div>
        )}

        <AgentStrip onOpen={props.onAgent} />
      </section>
    </>
  )
}
