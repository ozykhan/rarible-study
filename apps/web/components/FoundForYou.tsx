"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { ago, setTheme } from "@/lib/art"
import { cx } from "@/lib/cx"
import { explorerTx, money, variant } from "@/lib/format"
import type { Listing, Money, Purchase, RuleDetail, Status } from "@/lib/types"
import type { RuleState } from "./RuleView"
import { Slab } from "./Slab"
import { Badge, Button, CloseIcon, Panel, Pill, type PillTone, SearchIcon } from "./ui"

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
 * Whether the collector can still buy a card: not once bought, and not once
 * the listing is off the market (sold, or no longer listed). A waiting
 * purchase whose listing did not come with it stays open.
 */
export const canBuy = (i: FoundItem) =>
  i.bought === null && (i.listing === null ? i.waiting !== null : i.listing.status === "active")

/**
 * The cards in Found for you, in order: purchases waiting for a signature,
 * newest first, then each match and each listing to review. A listing with a
 * waiting purchase shows once, as the purchase. Cards that need nothing more
 * go last, bought before off the market, so a busy watch's old proposals do
 * not crowd out the ones you can still sign. A waiting purchase takes its
 * card from the purchase: the watch sends its 60 newest decisions, and a busy
 * watch has more purchases than that.
 */
export function foundItems(detail: RuleDetail): ReadonlyArray<FoundItem> {
  const decisions = new Map(detail.decisions.map((d) => [d.listingId, d]))
  const executed = new Map(detail.purchases.filter((p) => p.status === "executed").map((p) => [p.listingId, p]))
  const items: FoundItem[] = []
  const shown = new Set<string>()
  for (const p of [...detail.purchases].reverse()) {
    if (p.status !== "proposed") continue
    const d = decisions.get(p.listingId)
    items.push({
      key: `p:${p.id}`,
      listingId: p.listingId,
      listing: p.listing ?? d?.listing ?? null,
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
      bought: executed.get(d.listingId) ?? null,
      price: d.listing?.price ?? null
    })
  }
  const bought = items.filter((i) => i.bought !== null)
  const off = items.filter((i) => i.bought === null && !canBuy(i))
  return [...items.filter(canBuy), ...bought, ...off]
}

/** The band across a card's top: its word, and its tone (none, ok, warn, or off for a card that left the market). */
interface Band {
  readonly word: string
  readonly tone: PillTone | "off" | null
}

const KIND: Record<FoundKind, Band> = {
  waiting: { word: "waiting for you", tone: null },
  match: { word: "match", tone: "ok" },
  review: { word: "needs your review", tone: "warn" }
}

/**
 * Why a card is here while it can still be bought; once it needs nothing
 * more, what became of it: bought, sold, or no longer listed. A card off the
 * market has no Sign and pay, and its band says why.
 */
const band = (i: FoundItem): Band => {
  if (i.bought !== null) return { word: "bought", tone: "ok" }
  if (!canBuy(i)) return { word: i.listing?.status === "sold" ? "sold" : "no longer listed", tone: "off" }
  return KIND[i.kind]
}

/**
 * How far the price is from the watch's top price, as two short lines beside the price ("$40.00" over
 * "under top"), when the listing and the watch price in the same currency.
 */
const underTop = (price: Money | null, top: Money) => {
  if (price === null || price.currency !== top.currency) return null
  const diff = top.amountMinor - price.amountMinor
  return { amount: money({ amountMinor: Math.abs(diff), currency: top.currency }), word: diff >= 0 ? "under top" : "over top" }
}

/** A warning triangle, for a listing the judge wants you to look at. */
function WarnIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" strokeLinejoin="round" />
      <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
    </svg>
  )
}

/** A speech bubble, for what the seller wrote. */
function NoteIcon({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" strokeLinejoin="round" />
    </svg>
  )
}

/** The words a search runs over: card, set, grader and grade, seller, its band, price and listing id. */
const haystack = (i: FoundItem) => {
  const l = i.listing
  const parts = [band(i).word, i.listingId, i.price ? money(i.price) : ""]
  if (l) parts.push(l.cardName, l.setName, l.grader, `${l.grader} ${l.grade}`, String(l.grade), l.sellerHandle, `@${l.sellerHandle}`, variant(l))
  return parts.join(" ").toLowerCase()
}

/**
 * One card in Found for you. Why it is here sits on top of the card as a band
 * in its tone (waiting for you, match, needs your review), or what became of
 * it (bought; sold or no longer listed, with the art greyed out and no
 * actions, so a missing Sign and pay reads as meant). Under it the
 * slab on a backdrop in the set's tone, then the grade badge, name and meta,
 * the reason, the price with how far it is from the watch's top price beside
 * it, and when it was listed over its cert; a bought card links its devnet
 * transfer there. The actions passed in as children (Sign and pay, Ask the
 * agent) sit over the bottom of the art, as Buy now does on a market tile:
 * shown on hover and when anything in the card has keyboard focus, and on touch
 * screens after a tap on the art. A listing to review shows a warning symbol
 * and a seller-note symbol in the art's bottom corners instead of its reasons
 * and the seller's words. Each opens a popup over the art, one at a time, and
 * the same symbol (or Escape) closes it; the symbols stay on top of it. The
 * name opens the listing page. Styles: styles/desk.css (.found-card).
 */
export function FoundCard({ item, top, children }: { item: FoundItem; top: Money; children?: ReactNode }) {
  const [open, setOpen] = useState<"flag" | "note" | null>(null)
  const [revealed, setRevealed] = useState(false)
  const l = item.listing
  const hat = band(item)
  const under = underTop(item.price, top)
  const review = item.kind === "review" && canBuy(item)
  const note = review && l !== null
  const hasActions = children !== undefined && children !== null && children !== false
  const flagged = item.reasons.slice(0, 2).join(" ") || "The judge wants you to look at this one."
  const reason =
    hat.tone === "off"
      ? l?.status === "sold"
        ? "This listing has sold."
        : "This listing is no longer on the market."
      : (item.reasons[0] ?? (item.kind === "waiting" ? "This buy waits for your signature." : "Every field of the watch passes."))
  const tx = item.bought?.txSignature && !item.bought.txSignature.startsWith("simulated:") ? item.bought.txSignature : null
  const toggle = (which: "flag" | "note") => setOpen(open === which ? null : which)
  const closeOnEscape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && open !== null) setOpen(null)
  }
  return (
    <article
      className={cx("found-card", hat.tone === "off" && "off-market", revealed && "revealed", open !== null && "pop-open")}
      style={l ? ({ "--tone": setTheme(l)?.tone } as CSSProperties) : undefined}
      onKeyDown={closeOnEscape}
    >
      <div className={cx("found-hat", hat.tone && `hat-${hat.tone}`)}>{hat.word}</div>
      <div className="found-media">
        {l ? <Slab card={l} /> : <span className="found-placeholder" aria-hidden="true" />}
        {hasActions && (
          <button
            type="button"
            className="found-reveal"
            aria-label={`Show buying options for ${l?.cardName ?? item.listingId}`}
            aria-expanded={revealed}
            onClick={() => setRevealed(!revealed)}
          />
        )}
        {hasActions && <div className="found-actions">{children}</div>}
        {open === "flag" && (
          <div className="found-pop found-pop-flag" role="dialog" aria-label="Why this listing needs your review">
            <strong className="found-pop-title">
              <WarnIcon size={16} />
              Needs your review
            </strong>
            <p className="small">{flagged}</p>
          </div>
        )}
        {open === "note" && l && (
          <div className="found-pop" role="dialog" aria-label="What the seller wrote">
            <strong className="found-pop-title">
              <NoteIcon size={16} />
              The seller wrote
            </strong>
            <p className="seller-text small">
              {l.title}
              {"\n"}
              {l.description}
            </p>
            <p className="muted small">Shown as the seller wrote it. Slabwatch does not check it.</p>
          </div>
        )}
        {note && (
          <button
            type="button"
            className="found-symbol found-symbol-note"
            aria-label="What the seller wrote"
            aria-expanded={open === "note"}
            onClick={() => toggle("note")}
          >
            <span>
              <NoteIcon />
            </span>
          </button>
        )}
        {review && (
          <button
            type="button"
            className="found-symbol found-symbol-flag"
            aria-label="Why this listing needs your review"
            aria-expanded={open === "flag"}
            onClick={() => toggle("flag")}
          >
            <span>
              <WarnIcon />
            </span>
          </button>
        )}
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
        {!review && <p className="found-reason">{reason}</p>}
        <div className="found-price">
          <span className="price">{item.price ? money(item.price) : ""}</span>
          {under && (
            <span className="found-under">
              <span>{under.amount}</span>
              <span>{under.word}</span>
            </span>
          )}
        </div>
        {l && (
          <p className="found-foot">
            <span>listed {ago(l.listedAt)}</span>
            <span>cert {l.certNumber}</span>
          </p>
        )}
        {tx && (
          <a className="found-tx small" href={explorerTx(tx)} target="_blank" rel="noreferrer">
            transfer on devnet
          </a>
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
  const toSign = items.filter(canBuy).length
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
                {canBuy(i) ? (
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
        <Button variant="secondary" onClick={() => state.askAgent(item.listingId)} disabled={busy !== null}>
          {busy === `agent:${item.listingId}` ? "The agent is checking…" : "Ask the agent"}
        </Button>
      )}
    </>
  )
}
