import { graderNames, type Grader } from "@slabwatch/domain"
import { MARKET_SORTS, type MarketQuery } from "../search/query.ts"

/**
 * The market's URL parameters. Search, filters, sort and paging run in the
 * database through SearchService; this only reads the request.
 */

export const MARKET_PAGE = 40
export const MARKET_PAGE_MAX = 100
/**
 * The deepest a page may start. Going deeper means counting past every row
 * before it; search engines stop at the same place (a "result window" of
 * 10,000), and nobody pages that far by hand.
 */
export const MARKET_OFFSET_MAX = 10_000

const int = (v: string | null, fallback: number, min: number, max: number) => {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

/**
 * Reads ?set, ?grader, ?q, ?from, ?fit, ?sort, ?offset and ?limit. These come from
 * links people share, so an unknown grader or sort means "any" or "the
 * default" rather than an error; a set id that is not in the catalog is
 * ignored by the search. With no parameters it is the 40 newest, as before.
 */
export const parseMarketQuery = (params: URLSearchParams): MarketQuery => {
  const set = params.get("set")
  const grader = params.get("grader")
  const sort = params.get("sort")
  return {
    set: set !== null && /^[A-Za-z0-9-]{1,16}$/.test(set) ? set : null,
    grader: grader !== null && grader in graderNames ? (grader as Grader) : null,
    q: (params.get("q") ?? "").trim().slice(0, 100),
    sort: MARKET_SORTS.find((s) => s === sort) ?? null,
    from: (params.get("from") ?? "").trim().slice(0, 200),
    fit: (params.get("fit") ?? "").trim().slice(0, 120),
    offset: int(params.get("offset"), 0, 0, MARKET_OFFSET_MAX),
    limit: int(params.get("limit"), MARKET_PAGE, 1, MARKET_PAGE_MAX)
  }
}
