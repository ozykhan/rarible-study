"use client"

import type { CSSProperties } from "react"
import { cardId, GRADERS, SETS } from "@/lib/art"
import { cx } from "@/lib/cx"
import { dusd } from "@/lib/format"
import { MARKET_SORTS, type MarketFilters, type useMarket } from "@/lib/market"
import type { Listing } from "@/lib/types"
import { AgentStrip } from "./AgentStrip"
import { ListingTile } from "./ListingTile"
import { MarketSearch } from "./MarketSearch"
import { Button } from "./ui"

const TABS: ReadonlyArray<{ id: string; name: string; tone?: string }> = [{ id: "all", name: "All sets" }, ...SETS]

/**
 * The whole market: a head with two live numbers, set tabs with counts, the
 * grader and sort selects, the grid of ListingTiles with Show more, and the
 * optional agent's line under it. Filtering, search, sort and paging happen
 * on the server, over every active listing. Seller text is not shown here;
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
  const count = (id: string) => (m.counts === null ? "…" : id === "all" ? m.counts.all : (m.counts.sets[id] ?? 0))
  const left = m.listings === null ? 0 : m.total - m.listings.length

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
            <dd>{m.stats ? m.stats.count : "…"}</dd>
          </div>
          <div>
            <dt>lowest price</dt>
            <dd>{m.stats?.floorUnits != null ? dusd(m.stats.floorUnits) : "…"}</dd>
          </div>
        </dl>
      </section>

      <section id="market" className="section market">
        <MarketSearch id="market-search" className="market-search" />
        <div className="market-bar">
          <nav className="tabs" aria-label="Filter by set">
            {TABS.map((t) => (
              <button
                key={t.id}
                className={cx("tab", f.set === t.id && "active")}
                aria-pressed={f.set === t.id}
                style={t.tone ? ({ "--tone": t.tone } as CSSProperties) : undefined}
                onClick={() => props.onFilter("set", t.id)}
              >
                <span className="set-dot" aria-hidden="true" />
                {t.name} <span className="count">{count(t.id)}</span>
              </button>
            ))}
          </nav>
          <div className="market-selects">
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

        {m.listings !== null && m.total > 0 && (
          <p className="market-count">
            {filtered ? (
              <>
                <span className="mono">{m.total}</span> of <span className="mono">{m.stats?.count ?? "…"}</span> listings match
              </>
            ) : (
              <>
                <span className="mono">{m.total}</span> listings
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
        {m.listings !== null && m.listings.length === 0 && (
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
              <span className="mono">{m.listings?.length}</span> of <span className="mono">{m.total}</span> shown
            </span>
          </div>
        )}

        <AgentStrip onOpen={props.onAgent} />
      </section>
    </>
  )
}
