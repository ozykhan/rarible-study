import type { CSSProperties } from "react"
import { ago, setTheme } from "@/lib/art"
import { label, money } from "@/lib/format"
import type { Listing } from "@/lib/types"
import { Slab } from "./Slab"
import { Badge, Chip } from "./ui"

/**
 * One listing in the market grid: its slab on a backdrop tinted by the set's
 * tone, then the grader badge, card name, meta line, price (with a warn chip
 * when it is not in USD) and the seller and age in mono. Styles: styles/market.css (.tile).
 */
export function ListingTile({ l }: { l: Listing }) {
  const theme = setTheme(l)
  return (
    <article className="tile" style={{ "--tone": theme?.tone } as CSSProperties}>
      <div className="tile-media">
        <Slab card={l} />
      </div>
      <div className="tile-body">
        <Badge>
          {l.grader} {l.grade}
        </Badge>
        <h3 className="tile-title">{l.cardName}</h3>
        <p className="tile-meta">
          {theme?.year ?? ""} · {l.setName} #{l.cardNumber} · {label(l.edition)}
          {l.finish === "non_holo" ? "" : ` ${label(l.finish).toLowerCase()}`}
        </p>
        <div className="tile-price">
          <span className="price">{money(l.price)}</span>
          {l.price.currency !== "USD" && <Chip tone="warn">{l.price.currency}</Chip>}
        </div>
        <p className="tile-foot">
          <span>@{l.sellerHandle}</span>
          <span>{ago(l.listedAt)}</span>
        </p>
      </div>
    </article>
  )
}
