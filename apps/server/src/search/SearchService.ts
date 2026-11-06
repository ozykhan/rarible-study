import type { Grader } from "@slabwatch/domain"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import type { Fragment } from "effect/sql/Statement"
import { toTextArray } from "../db/Database.ts"
import { describeSearch, isEmptySearch, parseSearch, type MarketQuery, type MarketSort, type ParsedSearch } from "./query.ts"

/**
 * Market search as a service: a query in, listing ids and counts out. The web
 * route turns the ids into full listings. This version runs on Postgres over
 * listing_search (see migration 0005_search); a search engine can implement
 * the same interface later without the route changing.
 */

export interface SetRef {
  readonly id: string
  readonly name: string
}

/** How many listings are active and the lowest price in dUSD units, for the whole market and per set. */
export interface MarketStats {
  readonly count: number
  readonly floorUnits: number | null
  /** Sets with at least one active listing. */
  readonly setCount: number
  readonly sets: Readonly<Record<string, { readonly count: number; readonly floorUnits: number | null }>>
}

export interface MarketSearchResult {
  /** One page of listing ids, in order. */
  readonly ids: ReadonlyArray<string>
  /** Listings that match the whole query, exact up to COUNT_LIMIT; see `exact`. */
  readonly total: number
  /**
   * False when more than COUNT_LIMIT listings match the search and grader:
   * then counts.all is COUNT_LIMIT, counts.sets is empty, and total is
   * COUNT_LIMIT unless the one set picked has fewer.
   */
  readonly exact: boolean
  /** What the set tabs count: listings that match the search and grader, in all and per set id (the sets in `sets`). */
  readonly counts: { readonly all: number; readonly sets: Readonly<Record<string, number>> }
  /** Sets to offer as tabs, in catalog order: every set with active listings. */
  readonly sets: ReadonlyArray<SetRef>
  /** The whole market's numbers. Cached for a few seconds. */
  readonly stats: MarketStats
  /** What the search box was read as, one label per filter. */
  readonly understood: ReadonlyArray<string>
  /** A corrected search that has results, when this one has none because of a word we do not know. */
  readonly suggestion: string | null
}

export class SearchService extends Context.Service<
  SearchService,
  {
    readonly search: (query: MarketQuery) => Effect.Effect<MarketSearchResult, SqlError>
    readonly stats: Effect.Effect<MarketStats, SqlError>
  }
>()("slabwatch/SearchService") {}

/** How long the whole-market numbers are reused. They cost a scan of every active listing. */
export const STATS_TTL = "10 seconds"

/**
 * Matches are counted exactly up to this many. Counting every match of a
 * broad word ("holo" is 400,000 listings at a million) costs a read of each
 * one, and nobody needs more than "10,000+". Search engines default to the
 * same cap, and paging stops at the same depth (MARKET_OFFSET_MAX).
 */
export const COUNT_LIMIT = 10_000

/** Search words become a prefix query: 'ashen':* & 'wyrm':*. Words are letters and digits only, so they need no escaping. */
const prefixQuery = (words: ReadonlyArray<string>) => words.map((w) => `'${w}':*`).join(" & ")

/** Every sort ends in the listing id so pages never overlap; each matches an index in 0005_search. */
const orderBy = (sql: SqlClient, sort: MarketSort) => {
  switch (sort) {
    case "recent":
      return sql`listed_at DESC, listing_id`
    case "price_asc":
      return sql`usd_cents, listed_at DESC, listing_id`
    // The price index read backwards: ties come oldest first.
    case "price_desc":
      return sql`usd_cents DESC, listed_at, listing_id DESC`
    case "grade":
      return sql`grade DESC, listed_at DESC, listing_id`
  }
}

interface Resolved {
  readonly parsed: ParsedSearch
  /** Free words after bare handles that are not sellers were turned back into words. */
  readonly words: ReadonlyArray<string>
  readonly sellerIds: ReadonlyArray<string>
  readonly sellerHandles: ReadonlyArray<string>
  /** An "@name" that is no seller: nothing can match. */
  readonly missingSeller: boolean
  /** Words that start no card, kind or set word. */
  readonly unknown: ReadonlyArray<string>
}

export const SearchServicePg = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const sql = yield* SqlClient

    const statsQuery = Effect.gen(function* () {
      const rows = yield* sql<{ readonly setId: string; readonly count: number; readonly floor: number | null }>`
        SELECT set_id, count(*)::int AS count, min(usd_cents)::float8 AS floor FROM listing_search GROUP BY set_id`
      const floors = rows.map((r) => r.floor).filter((f): f is number => f !== null)
      return {
        count: rows.reduce((n, r) => n + r.count, 0),
        floorUnits: floors.length === 0 ? null : Math.min(...floors),
        setCount: rows.filter((r) => r.count > 0).length,
        sets: Object.fromEntries(rows.map((r) => [r.setId, { count: r.count, floorUnits: r.floor }]))
      } satisfies MarketStats
    }).pipe(Effect.withSpan("SearchService.stats"))
    const stats = yield* Effect.cachedWithTTL(statsQuery, STATS_TTL)

    // The catalog's sets change only when the catalog is loaded.
    const allSets = yield* Effect.cachedWithTTL(
      sql<SetRef>`SELECT id, name FROM sets ORDER BY release_year, id`,
      "1 minute"
    )

    /** One round trip: which words we know (as the start of a catalog word) and which handles are sellers. */
    const resolve = Effect.fn("SearchService.resolve")(function* (parsed: ParsedSearch) {
      const handles = parsed.handles.map((h) => h.handle)
      const sellers =
        handles.length === 0
          ? []
          : yield* sql<{ readonly id: string; readonly handle: string }>`
              SELECT id, handle FROM sellers WHERE handle = ANY(${toTextArray(handles)}::text[])`
      const found = new Map(sellers.map((s) => [s.handle, s.id]))
      const words = [...parsed.words]
      for (const h of parsed.handles) {
        if (!found.has(h.handle)) for (const w of h.orWords) if (!words.includes(w)) words.push(w)
      }
      // text_pattern_ops compares bytes: every word that starts with w sorts in [w, w || '{'), since '{' follows 'z'.
      const known =
        words.length === 0
          ? []
          : yield* sql<{ readonly word: string; readonly known: boolean }>`
              SELECT w AS word,
                     EXISTS (SELECT 1 FROM search_vocab v WHERE v.term ~>=~ w AND v.term ~<~ (w || '{')) AS known
              FROM unnest(${toTextArray(words)}::text[]) AS w`
      return {
        parsed,
        words,
        sellerIds: [...found.values()],
        sellerHandles: [...found.keys()],
        missingSeller: parsed.handles.some((h) => h.orWords.length === 0 && !found.has(h.handle)),
        unknown: known.filter((k) => !k.known).map((k) => k.word)
      } satisfies Resolved
    })

    /** The WHERE clauses for a resolved search, the grader picked in the menu, and optionally the set. */
    const where = (r: Resolved, grader: Grader | null, set: string | null): Array<Fragment> => {
      const p = r.parsed
      const c: Array<Fragment> = []
      if (r.words.length > 0) c.push(sql`terms @@ ${prefixQuery(r.words)}::tsquery`)
      if (set !== null) c.push(sql`set_id = ${set}`)
      if (grader !== null) c.push(sql`grader = ${grader}`)
      if (p.graders.length > 0) c.push(sql`grader IN ${sql.in(p.graders)}`)
      if (p.editions.length > 0) c.push(sql`edition IN ${sql.in(p.editions)}`)
      if (p.finishes.length > 0) c.push(sql`finish IN ${sql.in(p.finishes)}`)
      if (p.grades.length > 0) c.push(sql`grade IN ${sql.in(p.grades)}`)
      if (p.minGrade !== null) c.push(sql`grade >= ${p.minGrade}`)
      if (p.maxUsdCents !== null) c.push(sql`usd_cents <= ${p.maxUsdCents}`)
      if (p.cardNumber !== null) c.push(sql`card_number = ${p.cardNumber}`)
      if (p.cert !== null) c.push(sql`cert_number = ${p.cert}`)
      if (r.sellerIds.length > 0) c.push(sql`seller_id IN ${sql.in(r.sellerIds)}`)
      return c
    }

    /** The search with each unknown word swapped for the closest catalog word, if every one has a close match. */
    const correct = Effect.fn("SearchService.correct")(function* (q: string, unknown: ReadonlyArray<string>) {
      const rows = yield* sql<{ readonly word: string; readonly term: string | null }>`
        SELECT w AS word,
               (SELECT v.term FROM search_vocab v WHERE v.term % w
                ORDER BY similarity(v.term, w) DESC, v.term LIMIT 1) AS term
        FROM unnest(${toTextArray(unknown)}::text[]) AS w`
      if (rows.some((r) => r.term === null)) return null
      let fixed = q
      for (const r of rows) {
        fixed = fixed.replace(new RegExp(`(?<![\\p{L}\\p{N}])${r.word}(?![\\p{L}\\p{N}])`, "iu"), r.term!)
      }
      return fixed === q ? null : fixed
    })

    const run = (query: MarketQuery, suggest: boolean): Effect.Effect<MarketSearchResult, SqlError> =>
      Effect.gen(function* () {
        const [market, catalogSets] = yield* Effect.all([stats, allSets])
        const knownSet = query.set !== null && catalogSets.some((s) => s.id === query.set) ? query.set : null
        const parsed = parseSearch(query.q)
        const r = yield* resolve(parsed)
        const tabs = (counts: Readonly<Record<string, number>>) =>
          catalogSets.filter((s) => (market.sets[s.id]?.count ?? 0) > 0 || (counts[s.id] ?? 0) > 0)
        const base = { stats: market, understood: describeSearch(parsed, r.sellerHandles) }

        // A word nothing starts with, or a seller nobody is: no listing can match. Offer a fix instead of querying.
        if (r.unknown.length > 0 || r.missingSeller) {
          let suggestion: string | null = null
          if (suggest && !r.missingSeller) {
            const fixed = yield* correct(query.q, r.unknown)
            if (fixed !== null) {
              const check = yield* run({ ...query, q: fixed, offset: 0, limit: 1 }, false)
              if (check.total > 0) suggestion = fixed
            }
          }
          const sets = tabs({})
          return {
            ...base,
            ids: [],
            total: 0,
            exact: true,
            counts: { all: 0, sets: Object.fromEntries(sets.map((s) => [s.id, 0])) },
            sets,
            suggestion
          }
        }

        // No search and no grader: the counts are the whole market's, already cached.
        const unfiltered = isEmptySearch(parsed) && query.grader === null
        // Otherwise count per set, reading at most COUNT_LIMIT + 1 matches.
        const counted = unfiltered
          ? Object.entries(market.sets).map(([setId, s]) => ({ setId, n: s.count }))
          : yield* sql<{ readonly setId: string; readonly n: number }>`
              SELECT set_id, count(*)::int AS n FROM (
                SELECT set_id FROM listing_search WHERE ${sql.and(where(r, query.grader, null))} LIMIT ${COUNT_LIMIT + 1}
              ) AS m GROUP BY set_id`
        const counts = Object.fromEntries(counted.map((x) => [x.setId, x.n]))
        const sum = counted.reduce((n, x) => n + x.n, 0)
        const exact = unfiltered || sum <= COUNT_LIMIT
        const all = exact ? sum : COUNT_LIMIT
        // Past the cap the per-set numbers are a partial count; the one set picked gets its own capped count.
        const total =
          knownSet === null
            ? all
            : exact
              ? (counts[knownSet] ?? 0)
              : ((yield* sql<{ readonly n: number }>`
                  SELECT count(*)::int AS n FROM (
                    SELECT 1 FROM listing_search WHERE ${sql.and(where(r, query.grader, knownSet))} LIMIT ${COUNT_LIMIT}
                  ) AS m`)[0]?.n ?? 0)
        const page =
          total === 0
            ? []
            : yield* sql<{ readonly listingId: string }>`
                SELECT listing_id FROM listing_search
                WHERE ${sql.and(where(r, query.grader, knownSet))}
                ORDER BY ${orderBy(sql, query.sort)}
                LIMIT ${query.limit} OFFSET ${query.offset}`
        const sets = tabs(exact ? counts : {})
        return {
          ...base,
          ids: page.map((x) => x.listingId),
          total,
          exact,
          counts: { all, sets: exact ? Object.fromEntries(sets.map((s) => [s.id, counts[s.id] ?? 0])) : {} },
          sets,
          suggestion: null
        }
      })

    return SearchService.of({
      search: (query) => run(query, true).pipe(Effect.withSpan("SearchService.search", { attributes: { "search.q": query.q } })),
      stats
    })
  })
)
