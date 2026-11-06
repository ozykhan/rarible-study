"use client"

import Link from "next/link"
import { AgentBand } from "@/components/AgentBand"
import { Footer } from "@/components/Footer"
import { Graders } from "@/components/Graders"
import { Hero } from "@/components/Hero"
import { HowItWorks } from "@/components/HowItWorks"
import { ListingTile } from "@/components/ListingTile"
import { Sets } from "@/components/Sets"
import { Section } from "@/components/ui"
import { useAccount } from "@/lib/account"
import { cardId } from "@/lib/art"
import { count } from "@/lib/format"

/**
 * The home page, in the design's order: hero with search, Browse by set, the
 * five newest listings, How buying works, Graders we list, the optional agent
 * band and the footer. Buying never needs the agent: Buy now on a tile opens
 * the checkout right here.
 */
export default function Home() {
  const { listings, listingsFailed, stats, owned, watching, buy, watch, statusLoaded, status } = useAccount()
  const newest = (listings ?? []).slice(0, 5)
  return (
    <>
      <main id="top">
        <Hero stats={stats} />
        {statusLoaded && status === null && (
          <p className="callout error">The backend is not reachable right now. Listings and sign-in will come back with it.</p>
        )}
        <Sets listings={listings} stats={stats} />
        <Section
          id="market"
          title="On the market now"
          lede="Hover a card, or tap it on a phone, to buy it right here."
          aside={
            <Link className="section-link" href="/market">
              {stats ? `See all ${count(stats.count)} listings` : "See all listings"}
            </Link>
          }
        >
          {listings === null && !listingsFailed && (
            <div className="grid grid-five">
              {Array.from({ length: 5 }, (_, i) => (
                <div className="tile skeleton" key={i} />
              ))}
            </div>
          )}
          {listings === null && listingsFailed && <p className="empty">Listings are not reachable right now.</p>}
          {listings !== null && (
            <div className="grid grid-five">
              {newest.map((l) => (
                <ListingTile
                  key={l.listingId}
                  l={l}
                  owned={owned.has(l.listingId)}
                  watching={watching.has(cardId(l))}
                  onBuy={buy}
                  onWatch={watch}
                />
              ))}
            </div>
          )}
        </Section>
        <HowItWorks />
        <Graders />
        <AgentBand />
      </main>
      <Footer />
    </>
  )
}
