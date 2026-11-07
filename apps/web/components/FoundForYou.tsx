"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ago, setTheme } from "@/lib/art"
import { explorerTx, money, variant } from "@/lib/format"
import type { Listing, Money, Purchase, RuleDetail, Status } from "@/lib/types"
import type { RuleState } from "./RuleView"
import { Slab } from "./Slab"
import { Badge, Button, Panel, Pill, type PillTone, SearchIcon } from "./ui"

/** Why a card is in Found for you: a purchase waiting for the collector's signature, a match, or a listing to look at. */
export type FoundKind = "waiting" | "match" | "review"

/** One card in Found for you. */
export interface FoundItem {
  readonly key: string
  readonly listingId: string
  readonly listing: Listing | null
  readonly kind: FoundKind
  readonly reasons: ReadonlyArray<string>
  /** The proposed purchase this card signs, for a card waiting for a signature. */
  readonly waiting: Purchase | null
  /** The executed purchase, once the collector owns it. */
  readonly bought: Purchase | null
  readonly price: Money | null
}

/**
 * The cards in Found for you, in order: purchases waiting for a signature
 * first, then each match and each listing to review. A listing with a
 * waiting purchase shows once, as the purchase.
 */
export function foundItems(detail: RuleDetail): ReadonlyArray<FoundItem> {
  const decisions = new Map(detail.decisions.map((d) => [d.listingId, d]))
  const bought = new Map(detail.purchases.filter((p) => p.status === "executed").map((p) => [p.listingId, p]))
  const items: FoundItem[] = []
  const shown = new Set<string>()
  for (const p of detail.purchases) {
    if (p.status !== "proposed") continue
    const d = decisions.get(p.listingId)
    items.push({
      key: `p:${p.id}`,
      listingId: p.listingId,
      listing: d?.listing ?? null,
      kind: "waiting",
      reasons: d?.reasons ?? [],
      waiting: p,
      bought: null,
      price: p.price
    })
    shown.add(p.listingId)
  }
  for (const d of detail.decisions) {
    if (d.verdict === "reject" || shown.has(d.listingId)) continue
    items.push({
      key: `d:${d.listingId}`,
      listingId: d.listingId,
      listing: d.listing,
      kind: d.verdict === "needs_review" ? "review" : "match",
      reasons: d.reasons,
      waiting: null,
      bought: bought.get(d.listingId) ?? null,
      price: d.listing?.price ?? null
    })
  }
  return items
}

const KIND: Record<FoundKind, { readonly word: string; readonly tone: PillTone | null }> = {
  waiting: { word: "waiting for you", tone: null },
  match: { word: "match", tone: "ok" },
  review: { word: "needs your review", tone: "warn" }
}

/** What a card still needs from the collector: nothing once bought, or once the listing is off the market. */
const open = (i: FoundItem) => i.bought === null && (i.waiting !== null || i.listing?.status === "active")

/** "$40.00 under your top price", when the listing and the watch price in the same currency. */
const underTop = (price: Money | null, top: Money) => {
  if (price === null || price.currency !== top.currency) return null
  const diff = top.amountMinor - price.amountMinor
  return diff >= 0 ? `${money({ amountMinor: diff, currency: top.currency })} under top` : "over your top price"
}

/** The words a search runs over: card, set, grader and grade, seller, why it is here, price and listing id. */
const haystack = (i: FoundItem) => {
  const l = i.listing
  const parts = [KIND[i.kind].word, i.listingId, i.price ? money(i.price) : ""]
  if (l) parts.push(l.cardName, l.setName, l.grader, `${l.grader} ${l.grade}`, String(l.grade), l.sellerHandle, `@${l.sellerHandle}`, variant(l))
  if (i.bought) parts.push("bought")
  return parts.join(" ").toLowerCase()
}

/**
 * One card in Found for you: its slab on a backdrop in the set's tone, why it
 * is here as a pill, the grade badge, name and meta, the reason, the price
 * against the watch's top price, and the actions passed in as children. A
 * listing to review also shows its red flags and the seller's own words as
 * plain text in a well. The name opens the listing page. Styles:
 * styles/desk.css (.found-card).
 */
export function FoundCard({ item, top, children }: { item: FoundItem; top: Money; children?: ReactNode }) {
  const l = item.listing
  const kind = KIND[item.kind]
  const under = underTop(item.price, top)
  const reason =
    item.reasons[0] ?? (item.kind === "waiting" ? "This buy waits for your signature." : "Every field of the watch passes.")
  return (
    <article className="found-card" style={l ? ({ "--tone": setTheme(l)?.tone } as CSSProperties) : undefined}>
      <div className="found-media">
        <span className="found-kind">
          {item.bought ? <Pill tone="ok">bought</Pill> : <Pill tone={kind.tone}>{kind.word}</Pill>}
        </span>
        {l ? <Slab card={l} /> : <span className="found-placeholder" aria-hidden="true" />}
      </div>
      <div className="found-body">
        {l && (
          <Badge>
            {l.grader} {l.grade}
          </Badge>
        )}
        <h3 className="found-title">
          {l ? <Link href={`/listing/${encodeURIComponent(l.listingId)}`}>{l.cardName}</Link> : item.listingId}
        </h3>
        {l && (
          <p className="found-meta">
            {l.setName} #{l.cardNumber} · {variant(l)} · @{l.sellerHandle}
          </p>
        )}
        {item.kind === "review" ? (
          <>
            <p className="found-reason found-warn">{item.reasons.slice(0, 2).join(" ") || "The judge wants you to look at this one."}</p>
            {l && (
              <p className="seller-text small">
                {l.title}
                {"\n"}
                {l.description}
              </p>
            )}
          </>
        ) : (
          <p className="found-reason">{reason}</p>
        )}
        <div className="found-price">
          <span className="price">{item.price ? money(item.price) : ""}</span>
          {under && <span className="found-under">{under}</span>}
        </div>
        {children && <div className="found-actions">{children}</div>}
        {l && (
          <p className="found-foot">
            {l.status === "active" ? `listed ${ago(l.listedAt)}` : l.status} · cert {l.certNumber}
          </p>
        )}
      </div>
    </article>
  )
}

/** A chevron for the carousel's arrows. */
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Found for you on /agent: the selected watch's matches, listings to review
 * and purchases waiting for a signature, as cards in a row that scrolls
 * sideways and snaps card by card. Every card the collector can still buy
 * has Sign and pay: a waiting purchase is signed as it is, and a match or a
 * listing to review is proposed first, then signed. The search filters the
 * cards as you type, and the arrows scroll the row and grey out at its ends.
 * Styles: styles/desk.css (.found).
 */
export function FoundForYou({ state, status }: { state: RuleState; status: Status }) {
  const { detail, busy } = state
  const [query, setQuery] = useState("")
  const track = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: true })
  const items = useMemo(() => (detail === null ? [] : foundItems(detail)), [detail])
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = words.length === 0 ? items : items.filter((i) => words.every((w) => haystack(i).includes(w)))
  const toSign = items.filter(open).length
  const canTrade = !status.readOnly

  /** Which ends of the row are in view; an arrow greys out at its end. */
  const measure = useCallback(() => {
    const el = track.current
    if (el === null) return
    const start = el.scrollLeft <= 2
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
    setEdges((e) => (e.start === start && e.end === end ? e : { start, end }))
  }, [])

  useEffect(() => {
    measure()
    const el = track.current
    if (el === null || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, shown.length])

  const scroll = (dir: -1 | 1) => {
    const el = track.current
    if (el === null) return
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollBy({ left: dir * Math.max(el.clientWidth * 0.8, 240), behavior: smooth ? "smooth" : "auto" })
  }

  if (detail === null) return null
  const top = detail.rule.hard.maxPrice

  return (
    <Panel className="found">
      <div className="panel-head">
        <div className="found-heading">
          <h2>Found for you</h2>
          <span className="mono muted small">{toSign} to sign</span>
        </div>
        <span className="muted small">Matches, and listings the agent wants you to look at. You sign every buy.</span>
      </div>

      {items.length === 0 ? (
        <p className="empty small">Nothing matches yet. New listings arrive about once a minute, and each one is checked as it arrives.</p>
      ) : (
        <>
          <div className="found-toolbar">
            <label className="search found-search">
              <SearchIcon />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search found cards, graders, sellers"
                aria-label="Search found cards"
                autoComplete="off"
              />
            </label>
            <span className="found-count mono muted small">
              {words.length === 0 ? `${items.length} card${items.length === 1 ? "" : "s"}` : `${shown.length} of ${items.length} cards`}
            </span>
            <div className="found-arrows">
              <button type="button" className="btn-arrow" aria-label="Previous cards" onClick={() => scroll(-1)} disabled={edges.start}>
                <Chevron dir="left" />
              </button>
              <button type="button" className="btn-arrow" aria-label="Next cards" onClick={() => scroll(1)} disabled={edges.end}>
                <Chevron dir="right" />
              </button>
            </div>
          </div>

          {shown.length === 0 && (
            <p className="empty">
              No found card matches &ldquo;{query.trim()}&rdquo;.{" "}
              <Button variant="link" size="inline" onClick={() => setQuery("")}>
                Clear the search
              </Button>
            </p>
          )}

          <div className="found-track" ref={track} onScroll={measure} role="region" aria-label="Found for you" tabIndex={0}>
            {shown.map((i) => (
              <FoundCard key={i.key} item={i} top={top}>
                {i.bought ? (
                  i.bought.txSignature && !i.bought.txSignature.startsWith("simulated:") ? (
                    <a className="small" href={explorerTx(i.bought.txSignature)} target="_blank" rel="noreferrer">
                      transfer on devnet
                    </a>
                  ) : null
                ) : open(i) ? (
                  <FoundActions item={i} state={state} busy={busy} canTrade={canTrade} canAsk={status.modelConfigured} />
                ) : null}
              </FoundCard>
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** Sign and pay, and Ask the agent for a card that is not a waiting purchase. Busy labels end in an ellipsis. */
function FoundActions(p: { item: FoundItem; state: RuleState; busy: string | null; canTrade: boolean; canAsk: boolean }) {
  const { item, state, busy } = p
  const key = item.waiting ? `sign:${item.waiting.id}` : `buy:${item.listingId}`
  const pay = () => (item.waiting ? state.sign(item.waiting.id) : state.buy(item.listingId))
  return (
    <>
      <Button onClick={pay} disabled={busy !== null || !p.canTrade}>
        {busy === key ? "Waiting for the wallet…" : "Sign and pay"}
      </Button>
      {p.canAsk && item.waiting === null && (
        <Button variant="link" onClick={() => state.askAgent(item.listingId)} disabled={busy !== null}>
          {busy === `agent:${item.listingId}` ? "The agent is checking…" : "Ask the agent"}
        </Button>
      )}
    </>
  )
}
