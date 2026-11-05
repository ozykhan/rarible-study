"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { AgentDrawer } from "@/components/AgentDrawer"
import { ListingBuy } from "@/components/ListingBuy"
import { ListingDetail } from "@/components/ListingDetail"
import { ListingTile } from "@/components/ListingTile"
import { Section } from "@/components/ui"
import { useAccount } from "@/lib/account"
import { api, ApiError } from "@/lib/api"
import { cardId, setTheme } from "@/lib/art"
import { watchWant } from "@/lib/format"
import type { Listing, MarketResponse } from "@/lib/types"

type Loaded = { readonly kind: "loading" } | { readonly kind: "missing" | "down" } | { readonly kind: "ok"; readonly listing: Listing }

/**
 * One listing's page: ListingDetail with the price panel, then four more
 * listings from the same set. Buy now buys here; Watch, a tile's Watch and
 * "Ask the agent" open the agent drawer. A sold or withdrawn listing keeps its
 * page, which says so.
 */
export function ListingPage({ id }: { id: string }) {
  const { owned, watching, buy } = useAccount()
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" })
  const [more, setMore] = useState<{ listings: ReadonlyArray<Listing>; total: number } | null>(null)
  const [drawer, setDrawer] = useState<{ seed: string | null; n: number } | null>(null)
  const l = loaded.kind === "ok" ? loaded.listing : null
  const setId = l === null ? null : (setTheme(l)?.id ?? null)

  useEffect(() => {
    let live = true
    api<{ listing: Listing }>(`/listings/${encodeURIComponent(id)}`)
      .then((r) => live && setLoaded({ kind: "ok", listing: r.listing }))
      .catch((e) => live && setLoaded({ kind: e instanceof ApiError && e.status === 404 ? "missing" : "down" }))
    return () => {
      live = false
    }
  }, [id])

  useEffect(() => {
    if (l !== null) document.title = `${l.cardName} · Slabwatch`
  }, [l])

  // Four more from the set, newest first: five are asked for in case this one is among them.
  useEffect(() => {
    if (setId === null) return
    let live = true
    api<MarketResponse>(`/listings?set=${setId}&limit=5`)
      .then((r) => live && setMore({ listings: r.listings.filter((x) => x.listingId !== id).slice(0, 4), total: r.total }))
      .catch(() => live && setMore(null))
    return () => {
      live = false
    }
  }, [setId, id])

  const openAgent = (seed: string | null) => setDrawer({ seed, n: Date.now() })

  return (
    <main id="top">
      {loaded.kind === "loading" && (
        <section className="section listing-page" aria-busy="true">
          <div className="listing-detail">
            <div className="listing-stage skeleton" />
            <div className="listing-side">
              <div className="skeleton listing-skeleton" />
            </div>
          </div>
        </section>
      )}
      {loaded.kind === "missing" && (
        <section className="section">
          <p className="empty">
            This listing is not on Slabwatch. <Link href="/market">Browse the market</Link>
          </p>
        </section>
      )}
      {loaded.kind === "down" && (
        <section className="section">
          <p className="empty">Listings are not reachable right now.</p>
        </section>
      )}
      {l !== null && (
        <>
          <ListingDetail l={l} buy={<ListingBuy l={l} onWatch={() => openAgent(watchWant(l))} />} onAgent={() => openAgent(watchWant(l))} />
          {more !== null && more.listings.length > 0 && (
            <Section
              title={`More from ${l.setName}`}
              aside={
                <Link className="section-link" href={`/market?set=${setId}`}>
                  See all {more.total}
                </Link>
              }
            >
              <div className="grid grid-four">
                {more.listings.map((x) => (
                  <ListingTile
                    key={x.listingId}
                    l={x}
                    owned={owned.has(x.listingId)}
                    watching={watching.has(cardId(x))}
                    onBuy={buy}
                    onWatch={(t) => openAgent(watchWant(t))}
                  />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      {drawer !== null && <AgentDrawer key={drawer.n} seed={drawer.seed} onClose={() => setDrawer(null)} />}
    </main>
  )
}
