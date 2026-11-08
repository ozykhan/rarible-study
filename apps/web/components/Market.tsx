"use client"

import Link from "next/link"
import { type CSSProperties, useEffect, useRef } from "react"
import { cardId, GRADERS, SETS, UNKNOWN_TONE } from "@/lib/art"
import { cx } from "@/lib/cx"
import { count as fmt, dusd } from "@/lib/format"
import { MARKET_SORTS, type MarketFilters, type ReadNote, type useMarket } from "@/lib/market"
import type { Listing, SetRef } from "@/lib/types"
import { AgentStrip } from "./AgentStrip"
import { ListingTile } from "./ListingTile"
import { MarketSearch } from "./MarketSearch"
import { Button, CloseIcon } from "./ui"

/** Up to this many sets, every set is a tab. Past it the tabs show the biggest few and the rest go in a menu. */
const MAX_TABS = 8
const TOP_TABS = 6
/** Past this many set tabs, the tabs get a row of their own instead of sharing it with the menus. */
const SHARED_ROW_TABS = 4

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

/** The market URL for a search, keeping the other filters. It is searched as written: no reading, no ?from. */
const searchHref = (f: MarketFilters, q: string) => {
  const p = new URLSearchParams()
  if (f.set !== "all") p.set("set", f.set)
  if (f.grader !== "all") p.set("grader", f.grader)
  if (q !== "") p.set("q", q)
  if (f.sort !== null) p.set("sort", f.sort)
  const qs = p.toString()
  return qs === "" ? "/market" : `/market?${qs}`
}

/** The same search without its description's cut: every card the filters match, still ranked by what was typed. */
const withoutFitHref = (f: MarketFilters) => {
  const p = new URLSearchParams()
  if (f.set !== "all") p.set("set", f.set)
  if (f.grader !== "all") p.set("grader", f.grader)
  if (f.q.trim() !== "") p.set("q", f.q.trim())
  if (f.sort !== null) p.set("sort", f.sort)
  if (f.from.trim() !== "") p.set("from", f.from.trim())
  const qs = p.toString()
  return qs === "" ? "/market" : `/market?${qs}`
}

/** Why the cards were not judged against a description; Best match still orders by it. */
const UNCHECKED: Record<Extract<ReadNote, { kind: "unavailable" }>["reason"], string> = {
  no_key: "this server has no model",
  spend_cap: "the demo's daily model budget is used up",
  busy: "too many searches from here this hour",
  slow: "the model took too long; press Enter to try again",
  failed: "the model could not answer; press Enter to try again"
}

/** Why a described search was not read; the keyword results stay either way. */
const UNAVAILABLE: Record<Extract<ReadNote, { kind: "unavailable" }>["reason"], string> = {
  no_key: "Described searches are not read on this server, so only names, sets and the words cards are tagged with match.",
  spend_cap: "Described searches are paused for today: the demo's daily model budget is used up. Names, sets and tag words still match.",
  busy: "Too many described searches from here this hour. Names, sets and tag words still match.",
  slow: "Reading that search took too long. Press Enter to try again.",
  failed: "That search could not be read just now. Press Enter to try again."
}

const quoted = (words: ReadonlyArray<string>) => words.map((w) => `\u201c${w}\u201d`).join(", ")

/**
 * What an empty market says, most specific first: the model is reading the
 * search, read nothing in it, or could not be asked; a likely typo; words
 * nothing matches that Enter would have read; or simply nothing listed.
 */
function EmptyMessage(props: {
  q: string
  note: ReadNote | null
  unread: boolean
  suggestion: string | null
  href: (q: string) => string
  /** The description the listings were cut to, and the same search without the cut. */
  cut: { readonly phrase: string; readonly href: string } | null
}) {
  const { q, note, suggestion, cut } = props
  if (note?.kind === "reading") return <>Reading &ldquo;{q}&rdquo; as a description…</>
  if (cut !== null)
    return (
      <>
        None of the cards checked fit &ldquo;{cut.phrase}&rdquo;.{" "}
        <Link href={cut.href} scroll={false}>
          Show every match
        </Link>
        , best match first.
      </>
    )
  if (note?.kind === "nothing")
    return <>Nothing in &ldquo;{q}&rdquo; could be read as something to search for. Try a card name, a set, a kind of creature or a finish.</>
  const why = note?.kind === "unavailable" ? `${UNAVAILABLE[note.reason]} ` : ""
  if (suggestion !== null)
    return (
      <>
        {why}Nothing matches &ldquo;{q}&rdquo;. Did you mean{" "}
        <Link href={props.href(suggestion)} scroll={false}>
          {suggestion}
        </Link>
        ?{props.unread && " Or press Enter to have it read as a description."}
      </>
    )
  if (note?.kind === "unavailable") return <>{UNAVAILABLE[note.reason]}</>
  if (props.unread) return <>Nothing matches &ldquo;{q}&rdquo;. Press Enter to have it read as a description.</>
  return <>Nothing matches right now. New listings arrive about once a minute.</>
}

/**
 * The whole market: a head with two live numbers, set tabs with counts (from
 * the server, so a catalog of hundreds of sets works), the grader and sort
 * selects, what the search was read as (a removable chip per filter, and the
 * typed words when the model rewrote them), the grid of ListingTiles with Show
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
  /** What the model made of the search, when it was asked. */
  note: ReadNote | null
  /** Listing ids the collector bought, and card ids an active watch targets. */
  owned: ReadonlySet<string>
  watching: ReadonlySet<string>
  onBuy: (l: Listing) => void
  onWatch: (l: Listing) => void
  /** Opens the agent drawer. */
  onAgent: () => void
}) {
  const { filters: f, market: m, note } = props
  const q = f.q.trim()
  const fit = f.fit.trim()
  const filtered = f.set !== "all" || f.grader !== "all" || q !== "" || fit !== ""
  // Listings cut to the cards a model judged to fit the description.
  const cut = m.fit?.applied === true ? { phrase: m.fit.phrase, href: withoutFitHref(f) } : null
  // Words nothing matches, in a search the model has not been asked about.
  const unread = q !== "" && m.unknown.length > 0 && note === null && f.from === ""
  // Past 10,000 matches the server stops counting: "10,000+" overall and no number per set.
  const capped = !m.exact && m.total >= 10_000
  const count = (id: string) =>
    m.counts === null ? "…" : id === "all" ? (m.exact ? fmt(m.counts.all) : "10,000+") : m.exact ? fmt(m.counts.sets[id] ?? 0) : null
  const left = m.listings === null ? 0 : m.total - m.listings.length
  // The hand-written sets stand in until the server answers; they exist in every catalog.
  const rank = (id: string) => (m.exact ? m.counts?.sets[id] : m.stats?.sets[id]?.count) ?? 0
  const { tabs, rest } = splitSets(m.sets ?? SETS, rank, f.set)
  const tabRow = useRef<HTMLElement>(null)
  // The tab row scrolls sideways when it does not fit; keep the picked set in view.
  // Counts arriving change the tab widths, so look again then.
  useEffect(() => {
    const nav = tabRow.current
    const active = nav?.querySelector<HTMLElement>(".tab.active")
    if (!nav || !active) return
    const left = active.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft
    if (left < nav.scrollLeft || left + active.offsetWidth > nav.scrollLeft + nav.clientWidth) {
      nav.scrollLeft = left - (nav.clientWidth - active.offsetWidth) / 2
    }
  }, [f.set, tabs.length, m.counts])

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
        <div className={cx("market-bar", (rest.length > 0 || tabs.length > SHARED_ROW_TABS) && "many-sets")}>
          <nav ref={tabRow} className="tabs" aria-label="Filter by set">
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
              <select value={m.sort} aria-label="Sort" onChange={(e) => props.onFilter("sort", e.target.value)}>
                {/* Best match needs words to rank by. */}
                {MARKET_SORTS.filter(([v]) => v !== "relevance" || q !== "" || fit !== "").map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {m.listings !== null && ((q !== "" && m.chips.length > 0) || cut !== null) && (
          <div className="market-read">
            <span>Searching for</span>
            {q !== "" &&
              m.chips.map((c) => (
                <Link key={c.label} className="read-chip" href={searchHref(f, c.q)} scroll={false} aria-label={`Remove ${c.label}`}>
                  {c.label}
                  <CloseIcon />
                </Link>
              ))}
            {cut !== null && (
              <Link className="read-chip" href={cut.href} scroll={false} aria-label={`Remove fits “${cut.phrase}”`}>
                fits &ldquo;{cut.phrase}&rdquo;
                <CloseIcon />
              </Link>
            )}
          </div>
        )}
        {m.listings !== null && f.from !== "" && (
          <p className="market-from">
            Read from &ldquo;{f.from}&rdquo;.
            {cut !== null && <> Only cards a model judged to fit &ldquo;{cut.phrase}&rdquo; are listed.</>}
            {m.fit !== null && !m.fit.applied && (
              <>
                {" "}
                Not yet checked which cards fit &ldquo;{m.fit.phrase}&rdquo;
                {note?.kind === "read" && note.checked?.status === "unavailable" && <> ({UNCHECKED[note.checked.reason]})</>}
                {m.sort === "relevance" ? "; Best match orders by it." : "."}
              </>
            )}
            {note?.kind === "read" && note.notUnderstood.length > 0 && (
              <>
                {" "}
                No filter for {quoted(note.notUnderstood)}
                {m.sort === "relevance" ? "; Best match still uses those words to order the cards." : "."}
              </>
            )}
          </p>
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
        {m.listings !== null && m.listings.length === 0 && (
          <p className="empty">
            <EmptyMessage
              q={q === "" ? f.from : q}
              note={note}
              unread={unread}
              suggestion={m.suggestion}
              href={(to) => searchHref(f, to)}
              cut={cut}
            />{" "}
            {filtered && note?.kind !== "reading" && (
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
