"use client"

import Link from "next/link"
import { useState, type CSSProperties } from "react"
import { setTheme } from "@/lib/art"
import { cx } from "@/lib/cx"
import { money, variant } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { Slab } from "./Slab"
import { Badge, Button, Chip, Pill } from "./ui"

/**
 * One listing in the market grid: its slab on a backdrop tinted by the set's
 * tone, then the card name with its grader badge, the meta line, and the
 * price (with a warn chip when it is not in USD) next to the seller.
 *
 * The art and the title open the listing's page. Buy now and Watch sit over
 * the art. They show on hover and when anything in the tile has keyboard
 * focus; on touch screens a tap on the art shows them, and the title opens the
 * page. Each button only renders when the page passes its handler. A listing
 * the collector owns shows "In your wallet" instead. Styles: styles/market.css (.tile).
 */
export function ListingTile(props: {
  l: Listing
  owned?: boolean
  watching?: boolean
  onBuy?: (l: Listing) => void
  onWatch?: (l: Listing) => void
}) {
  const { l, owned = false, watching = false } = props
  const [revealed, setRevealed] = useState(false)
  const theme = setTheme(l)
  const hasActions = !owned && (props.onBuy !== undefined || props.onWatch !== undefined)
  const href = `/listing/${encodeURIComponent(l.listingId)}`
  return (
    <article className={cx("tile", revealed && "revealed")} style={{ "--tone": theme?.tone } as CSSProperties}>
      <div className="tile-media">
        {/* The title is the link for keyboards and screen readers; the art is the same link for the mouse. */}
        <Link className="tile-art" href={href} tabIndex={-1} aria-hidden="true">
          <Slab card={l} />
        </Link>
        {hasActions && (
          <button
            type="button"
            className="tile-reveal"
            aria-label={`Show buying options for ${l.cardName}`}
            aria-expanded={revealed}
            onClick={() => setRevealed(!revealed)}
          />
        )}
        {owned && (
          <span className="tile-owned">
            <Pill tone="ok">In your wallet</Pill>
          </span>
        )}
        {hasActions && (
          <div className="tile-actions">
            {props.onBuy && (
              <Button className="tile-buy" onClick={() => props.onBuy?.(l)}>
                Buy now
              </Button>
            )}
            {props.onWatch && (
              <Button variant="secondary" className="tile-watch" aria-pressed={watching} onClick={() => props.onWatch?.(l)}>
                {watching ? "Watching" : "Watch"}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="tile-body">
        <div className="tile-head">
          <h3 className="tile-title">
            <Link href={href}>{l.cardName}</Link>
          </h3>
          <Badge>
            {l.grader} {l.grade}
          </Badge>
        </div>
        <p className="tile-meta">
          {theme?.year ?? ""} · {l.setName} #{l.cardNumber} · {variant(l)}
        </p>
        <div className="tile-price">
          <span className="price">{money(l.price)}</span>
          {l.price.currency !== "USD" && <Chip tone="warn">{l.price.currency}</Chip>}
          <span className="tile-seller">@{l.sellerHandle}</span>
        </div>
      </div>
    </article>
  )
}
