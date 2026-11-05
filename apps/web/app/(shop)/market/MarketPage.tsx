"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Market } from "@/components/Market"
import { Sets } from "@/components/Sets"
import { useAccount } from "@/lib/account"

/**
 * The whole market: set chips and banners, then the grid with tabs, search and
 * sort. The set and the search live in the URL (?set=, ?q=, ?sort=), so links
 * from the home page land filtered.
 */
export function MarketPage() {
  const { listings, listingsFailed, stats, owned, watching, buy, watch } = useAccount()
  const params = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const set = params.get("set") ?? "all"
  const query = params.get("q") ?? ""
  const sort = params.get("sort")

  const update = (key: string, value: string, empty: string) => {
    const next = new URLSearchParams(params.toString())
    if (value === empty) next.delete(key)
    else next.set(key, value)
    const qs = next.toString()
    router.replace(qs === "" ? path : `${path}?${qs}`, { scroll: false })
  }

  return (
    <main id="top">
      <Sets listings={listings} stats={stats} active={set} onPick={(id) => update("set", set === id ? "all" : id, "all")} />
      <Market
        listings={listings}
        failed={listingsFailed}
        query={query}
        onQuery={(q) => update("q", q, "")}
        set={set}
        onSet={(id) => update("set", id, "all")}
        {...(sort ? { initialSort: sort } : {})}
        owned={owned}
        watching={watching}
        onBuy={buy}
        onWatch={watch}
      />
    </main>
  )
}
