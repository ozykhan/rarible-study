"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { AgentDrawer } from "@/components/AgentDrawer"
import { Market } from "@/components/Market"
import { AgentIcon } from "@/components/ui"
import { useAccount } from "@/lib/account"
import { watchWant } from "@/lib/format"
import { readFilters, useMarket } from "@/lib/market"

/**
 * /market: every listing, filtered by set, grader and search, in the order
 * picked. The filters live in the URL (?set, ?grader, ?q, ?sort), so links
 * from the home page land filtered and a filtered view can be shared. Watch
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

  const go = (next: URLSearchParams) => {
    const qs = next.toString()
    router.replace(qs === "" ? path : `${path}?${qs}`, { scroll: false })
  }
  const onFilter = (key: "set" | "grader" | "sort", value: string) => {
    const next = new URLSearchParams(params.toString())
    if (value === (key === "sort" ? "recent" : "all")) next.delete(key)
    else next.set(key, value)
    go(next)
  }
  const onClear = () => {
    const next = new URLSearchParams(params.toString())
    for (const k of ["set", "grader", "q"]) next.delete(k)
    go(next)
  }
  const openAgent = (seed: string | null) => setDrawer({ seed, n: Date.now() })

  return (
    <main id="top">
      <Market
        filters={filters}
        onFilter={onFilter}
        onClear={onClear}
        market={market}
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
