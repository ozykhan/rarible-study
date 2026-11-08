"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { count, dusd } from "@/lib/format"
import type { MarketStats } from "@/lib/types"
import type { SlabCard } from "./Slab"
import { Slab } from "./Slab"
import { Button, SearchIcon } from "./ui"

/** Two showcase slabs beside the headline. Fixed picks, so nothing shifts while listings load. */
const SHOWCASE: ReadonlyArray<SlabCard & { pos: string }> = [
  {
    pos: "a",
    setId: "EF",
    setName: "Emberfall",
    cardId: "EF-001",
    cardName: "Ashen Wyrm",
    cardNumber: "001",
    edition: "first",
    finish: "holo",
    grader: "NVG",
    grade: 10
  },
  {
    pos: "b",
    setId: "SE",
    setName: "Starward Expedition",
    cardId: "SE-009",
    cardName: "Solar Lion",
    cardNumber: "009",
    edition: "unlimited",
    finish: "holo",
    grader: "LCA",
    grade: 9.5
  }
]

/** Searches that land on a filtered market. Each one matches real listings. */
const POPULAR: ReadonlyArray<[label: string, href: string]> = [
  ["Ashen Wyrm", "/market?q=Ashen%20Wyrm"],
  ["1st edition holo", "/market?q=1st%20edition%20holo"],
  ["NVG 10", "/market?q=NVG%2010"],
  ["Lowest price first", "/market?sort=price_asc"]
]

/**
 * The home page's opening: the headline and lede, a market search with popular
 * searches under it, three live numbers, and two floating slabs over the
 * generated art. Styles: styles/hero.css.
 */
export function Hero({ stats }: { stats: MarketStats | null }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-bg" aria-hidden="true" />
      <div className="hero-row">
        <div className="hero-copy">
          <p className="eyebrow">Live on devnet</p>
          <h1 id="hero-title">Graded cards, ready to buy.</h1>
          <p className="lede">
            Slabs from Northvale, Quarry and Lantern, with grade and cert from the vault record. Find the card, check the slab, and
            sign to buy.
          </p>
          <form
            className="hero-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              const q = query.trim()
              // Submitted, so words nothing matches may be read as a description.
              router.push(q === "" ? "/market" : `/market?q=${encodeURIComponent(q)}&ask=1`)
            }}
          >
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards, sets, graders, sellers"
              aria-label="Search the market"
            />
            <Button type="submit">Search</Button>
          </form>
          <div className="hero-popular">
            <span>Popular:</span>
            {POPULAR.map(([label, href]) => (
              <Link key={label} className="chip-link" href={href}>
                {label}
              </Link>
            ))}
          </div>
          <dl className="hero-stats">
            <div>
              <dt>listings now</dt>
              <dd>{stats ? count(stats.count) : "…"}</dd>
            </div>
            <div>
              <dt>sets</dt>
              <dd>{stats ? count(stats.setCount) : "…"}</dd>
            </div>
            <div>
              <dt>lowest price</dt>
              <dd>{stats?.floorUnits != null ? dusd(stats.floorUnits) : "…"}</dd>
            </div>
          </dl>
        </div>
        <div className="hero-slabs" aria-hidden="true">
          {SHOWCASE.map(({ pos, ...card }) => (
            <div key={pos} className={`hero-slab hero-slab-${pos}`}>
              <Slab card={card} eager />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
