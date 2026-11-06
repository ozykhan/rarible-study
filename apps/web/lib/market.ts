"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { GRADERS } from "./art"
import type { Listing, MarketCounts, MarketResponse, MarketStats, SetRef } from "./types"

export const MARKET_SORTS = [
  ["recent", "Newest"],
  ["price_asc", "Price, low to high"],
  ["price_desc", "Price, high to low"],
  ["grade", "Grade, high to low"]
] as const

export type MarketSort = (typeof MARKET_SORTS)[number][0]

/** The market's filters as the URL holds them: "all" and "recent" are the defaults and stay out of the URL. */
export interface MarketFilters {
  readonly set: string
  readonly grader: string
  readonly q: string
  readonly sort: MarketSort
}

/**
 * Reads ?set, ?grader, ?q and ?sort, with unknown values falling back to the
 * defaults. Any set id is taken as written: the catalog is the server's, and
 * the server ignores a set it does not have.
 */
export const readFilters = (params: URLSearchParams): MarketFilters => {
  const set = params.get("set")
  const grader = params.get("grader")
  const sort = params.get("sort")
  return {
    set: set !== null && /^[A-Za-z0-9-]{1,16}$/.test(set) ? set : "all",
    grader: grader !== null && grader in GRADERS ? grader : "all",
    q: params.get("q") ?? "",
    sort: MARKET_SORTS.find(([v]) => v === sort)?.[0] ?? "recent"
  }
}

const PAGE = 40
/** The server sends at most this many in one page, so a refresh covers this many loaded tiles. */
const REFRESH_MAX = 100

const listingsPath = (f: MarketFilters, offset: number, limit: number) => {
  const p = new URLSearchParams()
  if (f.set !== "all") p.set("set", f.set)
  if (f.grader !== "all") p.set("grader", f.grader)
  if (f.q.trim() !== "") p.set("q", f.q.trim())
  if (f.sort !== "recent") p.set("sort", f.sort)
  if (offset > 0) p.set("offset", String(offset))
  p.set("limit", String(limit))
  return `/listings?${p.toString()}`
}

/** Fresh rows, with any kept listing that left the market put back where it was. */
const mergeKept = (fresh: ReadonlyArray<Listing>, before: ReadonlyArray<Listing>, keep: ReadonlySet<string>) => {
  const ids = new Set(fresh.map((l) => l.listingId))
  const out = [...fresh]
  before.forEach((l, i) => {
    if (keep.has(l.listingId) && !ids.has(l.listingId)) out.splice(Math.min(i, out.length), 0, l)
  })
  return out
}

interface MarketState {
  readonly key: string
  readonly listings: ReadonlyArray<Listing> | null
  readonly total: number
  readonly exact: boolean
  readonly counts: MarketCounts | null
  readonly stats: MarketStats | null
  readonly sets: ReadonlyArray<SetRef> | null
  readonly understood: ReadonlyArray<string>
  readonly suggestion: string | null
  readonly failed: boolean
}

/**
 * One filtered view of the market from the server: the listings loaded so
 * far, how many match, the set tabs and their counts, the whole market's
 * stats, what the search was read as and a suggested fix for a typo.
 * `more` loads the next 40. Every 20 seconds the loaded rows are fetched
 * again, keeping listings in `keep` (bought on this visit) in place after they
 * leave the market.
 */
export function useMarket(filters: MarketFilters, keep: ReadonlySet<string>) {
  const key = JSON.stringify([filters.set, filters.grader, filters.q.trim(), filters.sort])
  const [state, setState] = useState<MarketState>({
    key,
    listings: null,
    total: 0,
    exact: true,
    counts: null,
    stats: null,
    sets: null,
    understood: [],
    suggestion: null,
    failed: false
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const latest = useRef({ filters, keep, state })
  latest.current = { filters, keep, state }

  // A new filter starts from the first page; answers to an older filter are dropped.
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, key, listings: null, failed: false }))
    const load = (limit: number) =>
      api<MarketResponse>(listingsPath(latest.current.filters, 0, limit))
        .then((r) => {
          if (!live) return
          setState((s) => ({
            key,
            listings: mergeKept(r.listings, s.key === key ? (s.listings ?? []) : [], latest.current.keep),
            total: r.total,
            exact: r.exact,
            counts: r.counts,
            stats: r.stats,
            sets: r.sets,
            understood: r.understood,
            suggestion: r.suggestion,
            failed: false
          }))
        })
        .catch(() => live && setState((s) => ({ ...s, failed: s.listings === null })))
    void load(PAGE)
    const t = setInterval(() => {
      const loaded = latest.current.state.listings?.length ?? 0
      if (loaded <= REFRESH_MAX) void load(Math.max(PAGE, loaded))
    }, 20_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [key])

  const more = useCallback(async () => {
    const { filters: f, state: s } = latest.current
    if (s.listings === null) return
    setLoadingMore(true)
    try {
      const r = await api<MarketResponse>(listingsPath(f, s.listings.length, PAGE))
      setState((now) => {
        if (now.key !== s.key || now.listings === null) return now
        const ids = new Set(now.listings.map((l) => l.listingId))
        return {
          ...now,
          listings: [...now.listings, ...r.listings.filter((l) => !ids.has(l.listingId))],
          total: r.total,
          exact: r.exact,
          counts: r.counts
        }
      })
    } catch {
      // The button stays; the next try or the next refresh picks it up.
    } finally {
      setLoadingMore(false)
    }
  }, [])

  const current = state.key === key ? state : { ...state, listings: null }
  return { ...current, loadingMore, more }
}
