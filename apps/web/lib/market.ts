"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import { GRADERS } from "./art"
import type { FitCheck, Listing, MarketCounts, MarketResponse, MarketStats, SearchChip, SetRef, Understanding } from "./types"

export const MARKET_SORTS = [
  ["relevance", "Best match"],
  ["recent", "Newest"],
  ["price_asc", "Price, low to high"],
  ["price_desc", "Price, high to low"],
  ["grade", "Grade, high to low"]
] as const

export type MarketSort = (typeof MARKET_SORTS)[number][0]

/** The market's filters as the URL holds them: "all" and the default sort stay out of the URL. */
export interface MarketFilters {
  readonly set: string
  readonly grader: string
  readonly q: string
  /** Null until one is picked: the server then orders a described search best match first, anything else newest first. */
  readonly sort: MarketSort | null
  /** What the shopper typed, when q is the model's rewrite of it. Shown, and best match ranks by it, but never a filter. */
  readonly from: string
  /**
   * What the search says about the card that no filter holds ("guards
   * treasure"). Once a model has judged cards against it, only the ones that
   * fit are listed.
   */
  readonly fit: string
  /** The search was submitted (Enter, or the home page's Search): words nothing matches may be read by the model. */
  readonly ask: boolean
}

/**
 * Reads ?set, ?grader, ?q, ?sort, ?from, ?fit and ?ask, with unknown values falling back to the
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
    sort: MARKET_SORTS.find(([v]) => v === sort)?.[0] ?? null,
    from: (params.get("from") ?? "").slice(0, 200),
    fit: (params.get("fit") ?? "").slice(0, 120),
    ask: params.get("ask") === "1"
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
  if (f.sort !== null) p.set("sort", f.sort)
  if (f.from.trim() !== "") p.set("from", f.from.trim())
  if (f.fit.trim() !== "") p.set("fit", f.fit.trim())
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
  readonly chips: ReadonlyArray<SearchChip>
  readonly unknown: ReadonlyArray<string>
  readonly suggestion: string | null
  /** The order the server put the listings in. */
  readonly sort: MarketSort | null
  readonly fit: MarketResponse["fit"]
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
  const key = JSON.stringify([filters.set, filters.grader, filters.q.trim(), filters.sort, filters.from.trim(), filters.fit.trim()])
  const [state, setState] = useState<MarketState>({
    key,
    listings: null,
    total: 0,
    exact: true,
    counts: null,
    stats: null,
    sets: null,
    understood: [],
    chips: [],
    unknown: [],
    suggestion: null,
    sort: null,
    fit: null,
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
            chips: r.chips,
            unknown: r.unknown,
            suggestion: r.suggestion,
            sort: r.sort,
            fit: r.fit,
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
  // While a new page loads, the menu shows the order picked, or else the one the page was last in.
  const sort: MarketSort = (state.key === key ? state.sort : (filters.sort ?? state.sort)) ?? "recent"
  return { ...current, sort, loadingMore, more }
}

const without = <A>(all: Readonly<Record<string, A>>, key: string) => {
  const { [key]: _, ...rest } = all
  return rest
}

/** What the page says about reading a search with the model, for the search it applies to. */
export type ReadNote =
  | { readonly kind: "reading" }
  /** On the rewritten search: what of the typed search became no filter, and how judging cards against its description went. */
  | { readonly kind: "read"; readonly notUnderstood: ReadonlyArray<string>; readonly checked: FitCheck | null }
  | { readonly kind: "nothing"; readonly notUnderstood: ReadonlyArray<string> }
  | { readonly kind: "unavailable"; readonly reason: Extract<Understanding, { status: "unavailable" }>["reason"] }

/**
 * Reads a submitted search with the model when the server says some of its
 * words match nothing. Only a submitted search (?ask=1) is read, never one
 * that is still being typed. A reading replaces ?q with the rewritten search,
 * which the server reads without a model, and keeps what was typed in ?from:
 * paging, sorting and a shared link never call the model again. When it
 * cannot be read the keyword results stay, and the note says why.
 * `go` changes URL parameters; null removes one.
 */
export function useUnderstanding(
  filters: MarketFilters,
  market: { readonly listings: ReadonlyArray<Listing> | null; readonly unknown: ReadonlyArray<string> },
  go: (changes: Readonly<Record<string, string | null>>) => void
) {
  const [notes, setNotes] = useState<Readonly<Record<string, ReadNote>>>({})
  const q = filters.q.trim()
  const loaded = market.listings !== null
  const unknown = market.unknown.join(" ")
  const goRef = useRef(go)
  goRef.current = go

  useEffect(() => {
    if (!filters.ask || !loaded) return
    if (q === "" || unknown === "") {
      goRef.current({ ask: null })
      return
    }
    let live = true
    const note = (key: string, n: ReadNote) => setNotes((all) => ({ ...without(all, q), [key]: n }))
    note(q, { kind: "reading" })
    // The set and grader picked narrow the cards a description is judged on.
    const scope = new URLSearchParams({ q })
    if (filters.set !== "all") scope.set("set", filters.set)
    if (filters.grader !== "all") scope.set("grader", filters.grader)
    api<Understanding>(`/search/understand?${scope.toString()}`)
      .then((r) => {
        if (!live) return
        live = false
        if (r.status === "understood") {
          // A search that is only a description has no ?q: its notes are kept under what was typed.
          note(r.q === "" ? q : r.q, { kind: "read", notUnderstood: r.notUnderstood, checked: r.checked ?? null })
          goRef.current({ q: r.q === "" ? null : r.q, from: q, fit: r.fit ?? null, ask: null })
          return
        }
        if (r.status === "nothing") note(q, { kind: "nothing", notUnderstood: r.notUnderstood })
        else if (r.status === "unavailable") note(q, { kind: "unavailable", reason: r.reason })
        goRef.current({ ask: null })
      })
      .catch(() => {
        if (!live) return
        live = false
        note(q, { kind: "unavailable", reason: "failed" })
        goRef.current({ ask: null })
      })
    return () => {
      // Left before the answer (typed on, cleared): no "reading" stays behind for this search.
      if (live) setNotes((all) => without(all, q))
      live = false
    }
  }, [filters.ask, q, loaded, unknown, filters.set, filters.grader])

  return notes[q === "" ? filters.from.trim() : q] ?? null
}
