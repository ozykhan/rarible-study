import type { CSSProperties } from "react"
import { cardArt, gradeWord, setTheme } from "@/lib/art"
import { label } from "@/lib/format"
import type { Listing } from "@/lib/types"

export type SlabCard = Pick<
  Listing,
  "setName" | "cardName" | "cardNumber" | "edition" | "finish" | "grader" | "grade" | "setId" | "cardId"
>

/**
 * A graded card in its case, drawn in CSS: the grader's label on top and the
 * card with its generated art inside. Holo finishes get a moving sheen.
 */
export function Slab({ card, className = "", eager = false }: { card: SlabCard; className?: string; eager?: boolean }) {
  const theme = setTheme(card)
  const style = { "--tone": theme?.tone ?? "#9aa1ab" } as CSSProperties
  return (
    <div className={`slab grader-${card.grader} ${className}`} style={style} aria-hidden="true">
      <div className="slab-case">
        <div className="slab-label">
          <div className="slab-label-text">
            <span className="slab-grader">{card.grader}</span>
            <span>
              {theme?.year ?? ""} {card.setName}
            </span>
            <span>
              {card.cardName} #{card.cardNumber}
            </span>
            <span>
              {label(card.edition)} {card.finish === "non_holo" ? "" : label(card.finish)}
            </span>
          </div>
          <div className="slab-grade">
            <span>{gradeWord(card.grade)}</span>
            <strong>{card.grade}</strong>
          </div>
        </div>
        <div className="slab-window">
          <div className={`tcg finish-${card.finish}`}>
            <img
              src={cardArt(card)}
              alt=""
              loading={eager ? "eager" : "lazy"}
              decoding="async"
              width={384}
              height={528}
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
            <div className="tcg-name">{card.cardName}</div>
            <div className="tcg-foot">
              <span>{theme?.id ?? ""}</span>
              <span>{card.cardNumber}</span>
            </div>
            {card.edition === "first" && <span className="tcg-first">1st</span>}
            {card.finish !== "non_holo" && <span className="tcg-holo" />}
          </div>
        </div>
      </div>
    </div>
  )
}
