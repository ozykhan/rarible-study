import { graderNames, type ListingView } from "@slabwatch/domain"
import { sets, toUsdCents } from "@slabwatch/seed"

/**
 * The market's filters, search, sort and paging, applied to the active
 * listings in memory. The market is a few hundred listings, so one query for
 * all of them and plain code here keeps the counts, the floors and the page
 * consistent with each other.
 */

export const MARKET_SORTS = ["recent", "price_asc", "price_desc", "grade"] as const
export type MarketSort = (typeof MARKET_SORTS)[number]

export const MARKET_PAGE = 40
export const MARKET_PAGE_MAX = 100

export interface MarketQuery {
  readonly set: string | null
  readonly grader: string | null
  readonly q: string
  readonly sort: MarketSort
  readonly offset: number
  readonly limit: number
}

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

/**
 * Reads ?set, ?grader, ?q, ?sort, ?offset and ?limit. These come from links
 * people share, so an unknown set, grader or sort means "any" rather than an
 * error. With no parameters it is the 40 newest, as before.
 */
export const parseMarketQuery = (params: URLSearchParams): MarketQuery => {
  const set = params.get("set")
  const grader = params.get("grader")
  const sort = params.get("sort")
  return {
    set: set !== null && sets.some((s) => s.id === set) ? set : null,
    grader: grader !== null && grader in graderNames ? grader : null,
    q: (params.get("q") ?? "").trim().slice(0, 100),
    sort: MARKET_SORTS.find((s) => s === sort) ?? "recent",
    offset: int(params.get("offset"), 0, 0, 100_000),
    limit: int(params.get("limit"), MARKET_PAGE, 1, MARKET_PAGE_MAX)
  }
}

const editionWords = { first: "1st first edition", unlimited: "unlimited" } as const
const finishWords = { holo: "holo", reverse_holo: "reverse holo", non_holo: "non-holo nonholo" } as const

/**
 * The words a listing can be found by, all from the vault record and the
 * catalog. The seller's own title is left out on purpose: it can claim a grade
 * the slab does not have, and a search for "NVG 10" should find NVG 10 slabs.
 */
const words = (l: ListingView) =>
  [
    l.cardName,
    l.setName,
    l.setId,
    l.cardNumber,
    `#${l.cardNumber}`,
    editionWords[l.edition],
    finishWords[l.finish],
    l.grader,
    graderNames[l.grader],
    String(l.grade),
    l.sellerHandle,
    `@${l.sellerHandle}`
  ]
    .join(" ")
    .toLowerCase()
    .split(/\s+/)

/** Every word of the search starts one of the listing's words: "wyr" finds Ashen Wyrm, "10" finds grade 10 but not #010. */
export const matchesSearch = (l: ListingView, q: string) => {
  const terms = q.toLowerCase().split(/[\s,]+/).filter((t) => t.length > 0)
  if (terms.length === 0) return true
  const own = words(l)
  return terms.every((t) => own.some((w) => w.startsWith(t)))
}

const byRecent = (a: ListingView, b: ListingView) => b.listedAt.localeCompare(a.listedAt)
const sorters: Record<MarketSort, (a: ListingView, b: ListingView) => number> = {
  recent: byRecent,
  price_asc: (a, b) => toUsdCents(a.price.amountMinor, a.price.currency) - toUsdCents(b.price.amountMinor, b.price.currency) || byRecent(a, b),
  price_desc: (a, b) => toUsdCents(b.price.amountMinor, b.price.currency) - toUsdCents(a.price.amountMinor, a.price.currency) || byRecent(a, b),
  grade: (a, b) => b.grade - a.grade || byRecent(a, b)
}

/** How many listings are active and the lowest price in dUSD units, for the whole market and per set. */
export const marketStats = (all: ReadonlyArray<ListingView>) => {
  const sum = (ls: ReadonlyArray<ListingView>) => ({
    count: ls.length,
    floorUnits: ls.length === 0 ? null : Math.min(...ls.map((l) => toUsdCents(l.price.amountMinor, l.price.currency)))
  })
  return {
    ...sum(all),
    sets: Object.fromEntries(sets.map((s) => [s.id, sum(all.filter((l) => l.setId === s.id))]))
  }
}

/**
 * One page of the market for a query, the number of listings that match it,
 * and per set how many match the search and grader (what the set tabs count).
 */
export const marketPage = (all: ReadonlyArray<ListingView>, query: MarketQuery) => {
  const searched = all.filter((l) => (query.grader === null || l.grader === query.grader) && matchesSearch(l, query.q))
  const matching = query.set === null ? searched : searched.filter((l) => l.setId === query.set)
  const sorted = [...matching].sort(sorters[query.sort])
  return {
    page: sorted.slice(query.offset, query.offset + query.limit),
    total: matching.length,
    counts: {
      all: searched.length,
      sets: Object.fromEntries(sets.map((s) => [s.id, searched.filter((l) => l.setId === s.id).length]))
    }
  }
}
