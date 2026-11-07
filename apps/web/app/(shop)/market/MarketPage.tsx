"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { AgentDrawer } from "@/components/AgentDrawer"
import { Market } from "@/components/Market"
import { AgentIcon } from "@/components/ui"
import { useAccount } from "@/lib/account"
import { watchWant } from "@/lib/format"
import { readFilters, useMarket, useUnderstanding } from "@/lib/market"

/**
 * /market: every listing, filtered by set, grader and search, in the order
 * picked. The filters live in the URL (?set, ?grader, ?q, ?sort, and ?from
 * when ?q is a described search read by the model), so links from the home
 * page land filtered and a filtered view can be shared. Watch
 * on a tile and the agent line open the agent drawer here; buying never
 * needs it.
 */
export function MarketPage() {
  const { owned, watching, buy } = useAccount()
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const filters = readFilters(params)
  const market = useMarket(filters, owned)
  const [drawer, setDrawer] = useState<{ seed: string | null; n: number } | null>(null)

  /** Changes URL parameters, keeping the others; null removes one. */
  const go = (changes: Readonly<Record<string, string | null>>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    router.replace(qs === "" ? path : `${path}?${qs}`, { scroll: false })
  }
  const note = useUnderstanding(filters, market, go)
  // A sort is kept once picked: the default depends on the search, so "Newest" has to be written down too.
  const onFilter = (key: "set" | "grader" | "sort", value: string) => go({ [key]: key !== "sort" && value === "all" ? null : value })
  const onClear = () => go({ set: null, grader: null, q: null, from: null, ask: null })
  const openAgent = (seed: string | null) => setDrawer({ seed, n: Date.now() })

  return (
    <main id="top">
      <Market
        filters={filters}
        onFilter={onFilter}
        onClear={onClear}
        market={market}
        note={note}
        owned={owned}
        watching={watching}
        onBuy={buy}
        onWatch={(l) => openAgent(watchWant(l))}
        onAgent={() => openAgent(null)}
      />
      {drawer === null ? (
        <button type="button" className="btn btn-sm btn-secondary agent-fab" onClick={() => openAgent(null)}>
          <AgentIcon />
          Ask the agent
        </button>
      ) : (
        <AgentDrawer key={drawer.n} seed={drawer.seed} onClose={() => setDrawer(null)} />
      )}
    </main>
  )
}
