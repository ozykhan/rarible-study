import type { Grader } from "@slabwatch/domain"
import { Cache, Context, Effect, Exit, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import type { Fragment } from "effect/sql/Statement"
import { toTextArray, toVector } from "../db/Database.ts"
import { Embedder } from "../embeddings/Embedder.ts"
import {
  defaultSort,
  describedWords,
  describeSearch,
  FIT_VERSION,
  fitKey,
  isEmptySearch,
  parseSearch,
  searchChips,
  type MarketQuery,
  type MarketSort,
  type ParsedSearch,
  type SearchChip,
  type TagFilter
} from "./query.ts"

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
  /** The same filters as chips, each with the search text that drops it. */
  readonly chips: ReadonlyArray<SearchChip>
  /**
   * Words no card, kind or set word starts with. While there are any nothing
   * matches; they are what a model can read when the search is submitted.
   */
  readonly unknown: ReadonlyArray<string>
  /** A corrected search that has results, when this one has none because of a word we do not know. */
  readonly suggestion: string | null
  /**
   * The order the page is in: the one asked for, or the search's default
   * (defaultSort). Best match falls back to newest when the search describes
   * no card to rank by.
   */
  readonly sort: MarketSort
  /**
   * The description in ?fit, and whether a model has judged cards against it:
   * then only the cards it judged to fit match. Null without ?fit.
   */
  readonly fit: { readonly phrase: string; readonly applied: boolean } | null
}

/** A card to judge against a description: the text it is judged on, and the catalog text that came from. */
export interface FitCandidate {
  readonly id: string
  readonly text: string
  readonly catalogText: string
}

/**
 * What a card is judged on: its kinds and lore, the part of its catalog text
 * that says what the creature is and does. The set's name describes the set,
 * not the creature (a lizard from a set called Hidden Ruins does not lurk in
 * ruins), and a name like Crystalborn Wyvern reads as glassy to a model; a
 * search for a name is read as a name filter before this. Rarity and tags add
 * nothing a description could ask.
 */
export const fitText = (catalogText: string, name: string): string => {
  const at = catalogText.indexOf(`${name}. `)
  return (at === -1 ? catalogText : catalogText.slice(at + name.length + 2)).replace(/\s*Rarity: [a-z ]+\./i, "").trim()
}

export class SearchService extends Context.Service<
  SearchService,
  {
    readonly search: (query: MarketQuery) => Effect.Effect<MarketSearchResult, SqlError>
    /**
     * The first `limit` cards a search shows best match first, ignoring any
     * judgments for its ?fit: the cards CardFit asks a model about.
     */
    readonly fitCandidates: (query: MarketQuery, limit: number) => Effect.Effect<ReadonlyArray<FitCandidate>, SqlError>
    readonly stats: Effect.Effect<MarketStats, SqlError>
    /** The words that start some card, kind or set word, in the order given. */
    readonly knownWords: (words: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<string>, SqlError>
    /**
     * For each word, the catalog words spelled most like it (trigram
     * similarity at least `threshold`, Postgres's 0.3 by default), closest first.
     */
    readonly closeWords: (
      words: ReadonlyArray<string>,
      limit: number,
      threshold?: number
    ) => Effect.Effect<Readonly<Record<string, ReadonlyArray<string>>>, SqlError>
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

/**
 * Best match, the "relevance" sort. Each card has a vector of its trusted text
 * and tags (CardVectors); the words a search describes a card with
 * (describedWords, from ?from when a model read the search) become a query
 * vector, and the cards the search matches are ordered by cosine distance to
 * it, each card's listings newest first. Filters still decide what matches;
 * the order only decides what comes first, so words no filter can express
 * ("that guards treasure") still count. No model call: the query vector comes
 * from the local embedder and is cached.
 */
const QUERY_VECTORS = { capacity: 2000, timeToLive: "1 hour" } as const

/** Search words become a prefix query: 'ashen':* & 'wyrm':*. Words are letters and digits only, so they need no escaping. */
const prefixQuery = (words: ReadonlyArray<string>) => words.map((w) => `'${w}':*`).join(" & ")

/**
 * A tag is the lexeme '#id' in the card's terms (migration 0006), or else the
 * words that asked for it: ('#sea_creature' | 'sea':* & 'animal':*). Tag ids
 * are lowercase letters and underscores, so they need no escaping either.
 */
const tagQuery = (t: TagFilter) => `('#${t.tag}' | ${prefixQuery(t.words)})`

/** Everything the words and tags ask of a card, as one tsquery, or null when they ask nothing. */
export const termsQuery = (words: ReadonlyArray<string>, tags: ReadonlyArray<TagFilter>): string | null => {
  const parts = [...(words.length === 0 ? [] : [prefixQuery(words)]), ...tags.map(tagQuery)]
  return parts.length === 0 ? null : parts.join(" & ")
}

/** Every sort ends in the listing id so pages never overlap; each matches an index in 0005_search. Best match has its own queries. */
const orderBy = (sql: SqlClient, sort: Exclude<MarketSort, "relevance">) => {
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
  /** A description cards were judged against: only the cards judged to fit match. */
  readonly fit: string | null
}

export const SearchServicePg = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const embedder = yield* Embedder

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

    const queryVectors = yield* Cache.makeWith(
      (text: string) =>
        embedder.embed([text], "query").pipe(
          Effect.map((vs) => toVector(vs[0] ?? [])),
          Effect.withSpan("SearchService.queryVector")
        ),
      // A failure is tried again next time rather than remembered.
      { capacity: QUERY_VECTORS.capacity, timeToLive: (exit) => (Exit.isSuccess(exit) ? QUERY_VECTORS.timeToLive : 0) }
    )

    const knownWords = Effect.fn("SearchService.knownWords")(function* (words: ReadonlyArray<string>) {
      if (words.length === 0) return []
      // text_pattern_ops compares bytes: every word that starts with w sorts in [w, w || '{'), since '{' follows 'z'.
      const rows = yield* sql<{ readonly word: string; readonly known: boolean }>`
        SELECT w AS word,
               EXISTS (SELECT 1 FROM search_vocab v WHERE v.term ~>=~ w AND v.term ~<~ (w || '{')) AS known
        FROM unnest(${toTextArray(words)}::text[]) AS w`
      return rows.filter((r) => r.known).map((r) => r.word)
    })

    const closeWords = Effect.fn("SearchService.closeWords")(function* (
      words: ReadonlyArray<string>,
      limit: number,
      threshold?: number
    ) {
      if (words.length === 0) return {}
      const query = sql<{ readonly word: string; readonly terms: ReadonlyArray<string> }>`
        SELECT w AS word,
               array(SELECT v.term FROM search_vocab v WHERE v.term % w
                     ORDER BY similarity(v.term, w) DESC, v.term LIMIT ${limit}) AS terms
        FROM unnest(${toTextArray(words)}::text[]) AS w`
      // % keeps the trigram index; its cutoff is a setting, changed for this transaction only.
      const rows =
        threshold === undefined
          ? yield* query
          : yield* sql.withTransaction(
              Effect.andThen(sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(threshold)}, true)`, query)
            )
      return Object.fromEntries(rows.map((r) => [r.word, r.terms]))
    })

    /** Which words we know (as the start of a catalog word) and which handles are sellers. */
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
      const known = yield* knownWords(words)
      return {
        parsed,
        words,
        sellerIds: [...found.values()],
        sellerHandles: [...found.keys()],
        missingSeller: parsed.handles.some((h) => h.orWords.length === 0 && !found.has(h.handle)),
        unknown: words.filter((w) => !known.includes(w)),
        fit: null
      } satisfies Resolved
    })

    /** The WHERE clauses for a resolved search, the grader picked in the menu, and optionally the set. */
    const where = (r: Resolved, grader: Grader | null, set: string | null): Array<Fragment> => {
      const p = r.parsed
      const c: Array<Fragment> = []
      const terms = termsQuery(r.words, p.tags)
      if (terms !== null) c.push(sql`terms @@ ${terms}::tsquery`)
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
      if (r.fit !== null) c.push(sql`card_id IN (${fitting(r.fit)})`)
      return c
    }

    /** The cards a model judged to fit a description (see CardFit). */
    const fitting = (key: string) =>
      sql`SELECT card_id FROM card_fits WHERE concept = ${key} AND version = ${FIT_VERSION} AND fits`

    /** What a search asks of the card, on the cards table: Best match ranks these cards before it reads their listings. */
    const cardWhere = (r: Resolved, set: string | null): Array<Fragment> => {
      const p = r.parsed
      const c: Array<Fragment> = []
      const terms = termsQuery(r.words, p.tags)
      if (terms !== null) c.push(sql`search_terms @@ ${terms}::tsquery`)
      if (set !== null) c.push(sql`set_id = ${set}`)
      if (p.cardNumber !== null) c.push(sql`number = ${p.cardNumber}`)
      if (r.fit !== null) c.push(sql`id IN (${fitting(r.fit)})`)
      return c
    }

    /** What a search asks of the slab and the listing, on listing_search: the rest of `where`. */
    const listingWhere = (r: Resolved, grader: Grader | null): Array<Fragment> => {
      const p = r.parsed
      const c: Array<Fragment> = []
      if (grader !== null) c.push(sql`grader = ${grader}`)
      if (p.graders.length > 0) c.push(sql`grader IN ${sql.in(p.graders)}`)
      if (p.editions.length > 0) c.push(sql`edition IN ${sql.in(p.editions)}`)
      if (p.finishes.length > 0) c.push(sql`finish IN ${sql.in(p.finishes)}`)
      if (p.grades.length > 0) c.push(sql`grade IN ${sql.in(p.grades)}`)
      if (p.minGrade !== null) c.push(sql`grade >= ${p.minGrade}`)
      if (p.maxUsdCents !== null) c.push(sql`usd_cents <= ${p.maxUsdCents}`)
      if (p.cert !== null) c.push(sql`cert_number = ${p.cert}`)
      if (r.sellerIds.length > 0) c.push(sql`seller_id IN ${sql.in(r.sellerIds)}`)
      return c
    }

    /**
     * The query vector for Best match, or null when there are no words to rank
     * by or the embedder failed: then the page is newest first, never an error.
     */
    const rankVector = (text: string) =>
      text === ""
        ? Effect.succeed(null)
        : Cache.get(queryVectors, text).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("search: no query vector, so newest first", cause).pipe(Effect.as(null))
            )
          )

    /** The search with each unknown word swapped for the closest catalog word, if every one has a close match. */
    const correct = Effect.fn("SearchService.correct")(function* (q: string, unknown: ReadonlyArray<string>) {
      const close = yield* closeWords(unknown, 1)
      const rows = unknown.map((word) => ({ word, term: close[word]?.[0] ?? null }))
      if (rows.some((r) => r.term === null)) return null
      let fixed = q
      for (const r of rows) {
        fixed = fixed.replace(new RegExp(`(?<![\\p{L}\\p{N}])${r.word}(?![\\p{L}\\p{N}])`, "iu"), r.term!)
      }
      return fixed === q ? null : fixed
    })

    interface PageOf {
      readonly r: Resolved
      readonly grader: Grader | null
      readonly set: string | null
      readonly limit: number
      readonly offset: number
    }

    /**
     * One page in a fixed order. A search counted in full has at most COUNT_LIMIT matches (`materialize`): fetch them all
     * and sort, which costs at most that many rows. Walking a sort index instead pays for every row it skips, and the
     * planner guesses how many that is from per-word statistics. "glowing sea creature holo" (1,492 matches) skipped
     * 60,000 rows that way: 165 ms instead of 20. Past the cap, matches are common enough that walking the index finds a
     * page quickly.
     */
    const sortedPage = (o: PageOf & { readonly sort: Exclude<MarketSort, "relevance">; readonly materialize: boolean }) => {
      const filters = sql.and(where(o.r, o.grader, o.set))
      return o.materialize
        ? sql<{ readonly listingId: string }>`
            WITH m AS MATERIALIZED (
              SELECT listing_id, listed_at, usd_cents, grade FROM listing_search WHERE ${filters}
            )
            SELECT listing_id FROM m ORDER BY ${orderBy(sql, o.sort)}
            LIMIT ${o.limit} OFFSET ${o.offset}`
        : sql<{ readonly listingId: string }>`
            SELECT listing_id FROM listing_search WHERE ${filters}
            ORDER BY ${orderBy(sql, o.sort)}
            LIMIT ${o.limit} OFFSET ${o.offset}`
    }

    /**
     * One page best match first. Matches are ordered by their card's distance to the query vector, in two rounds:
     * first the newest listing of each card, then every other listing, card by card. At marketplace size a card has
     * dozens of listings, and the first page should show the cards that fit best, not one card's whole stock.
     *
     * Counted in full (at most COUNT_LIMIT matches), every match is fetched and sorted, as in sortedPage. Past the cap,
     * the matching cards are ranked first and each one's newest listing is read with one index probe, best card
     * first, stopping once the page is full; the second round is read only for pages beyond the first round.
     */
    const bestMatchPage = Effect.fn("SearchService.bestMatchPage")(function* (
      o: PageOf & { readonly vector: string; readonly exact: boolean }
    ) {
      if (o.exact) {
        const rows = yield* sql<{ readonly listingId: string }>`
          WITH m AS MATERIALIZED (
            SELECT listing_id, listed_at, card_id FROM listing_search WHERE ${sql.and(where(o.r, o.grader, o.set))}
          ), r AS (
            SELECT id, search_vector <=> ${o.vector}::vector AS d FROM cards WHERE id IN (SELECT card_id FROM m)
          )
          SELECT m.listing_id FROM m JOIN r ON r.id = m.card_id
          ORDER BY row_number() OVER (PARTITION BY m.card_id ORDER BY m.listed_at DESC, m.listing_id) > 1,
                   r.d, m.listed_at DESC, m.listing_id
          LIMIT ${o.limit} OFFSET ${o.offset}`
        return rows.map((x) => x.listingId)
      }
      const cards = sql`SELECT id, search_vector <=> ${o.vector}::vector AS d FROM cards WHERE ${sql.and(cardWhere(o.r, o.set))}`
      const listings = sql.and(listingWhere(o.r, o.grader))
      const end = o.offset + o.limit
      const firsts = (yield* sql<{ readonly listingId: string }>`
        SELECT l.listing_id
        FROM (${cards} ORDER BY d) AS r
        CROSS JOIN LATERAL (
          SELECT listing_id, listed_at FROM listing_search WHERE card_id = r.id AND ${listings}
          ORDER BY listed_at DESC, listing_id LIMIT 1
        ) AS l
        ORDER BY r.d, l.listed_at DESC, l.listing_id
        LIMIT ${end}`).map((x) => x.listingId)
      const page = firsts.slice(o.offset, end)
      // Fewer than asked for: the first round is complete, and the page carries on into the second.
      if (firsts.length >= end) return page
      const second = sql<{ readonly listingId: string }>`
        SELECT ls.listing_id
        FROM (${cards}) AS r
        JOIN listing_search ls ON ls.card_id = r.id
        WHERE ${listings} AND ls.listing_id NOT IN (SELECT unnest(${toTextArray(firsts)}::text[]))
        ORDER BY r.d, ls.listed_at DESC, ls.listing_id
        LIMIT ${o.limit - page.length} OFFSET ${Math.max(0, o.offset - firsts.length)}`
      // Planned for its own values every time: after five runs Postgres would reuse one plan for every search, made
      // without knowing how many cards the words match, and that plan sorts every match (200 ms instead of 65).
      const rest = yield* sql.withTransaction(
        Effect.andThen(sql`SELECT set_config('plan_cache_mode', 'force_custom_plan', true)`, second)
      )
      return [...page, ...rest.map((x) => x.listingId)]
    })

    /** Whether a model has judged any card against a description, under the current judging prompt. */
    const judged = (key: string) =>
      sql<{ readonly any: boolean }>`
        SELECT EXISTS (SELECT 1 FROM card_fits WHERE concept = ${key} AND version = ${FIT_VERSION}) AS any`.pipe(
        Effect.map((rows) => rows[0]?.any === true)
      )

    /** `cut` false ignores judgments for ?fit, which still ranks: how CardFit finds the cards to judge. */
    const run = (query: MarketQuery, suggest: boolean, cut = true): Effect.Effect<MarketSearchResult, SqlError> =>
      Effect.gen(function* () {
        const [market, catalogSets] = yield* Effect.all([stats, allSets])
        const knownSet = query.set !== null && catalogSets.some((s) => s.id === query.set) ? query.set : null
        const parsed = parseSearch(query.q)
        const key = fitKey(query.fit)
        const applied = key !== "" && cut && (yield* judged(key))
        const r = { ...(yield* resolve(parsed)), fit: applied ? key : null }
        const tabs = (counts: Readonly<Record<string, number>>) =>
          catalogSets.filter((s) => (market.sets[s.id]?.count ?? 0) > 0 || (counts[s.id] ?? 0) > 0)
        const wanted = query.sort ?? defaultSort(parsed, query.fit)
        // Best match ranks the cards a search asks for by the words that describe them. A description alone
        // ("something that guards treasure") asks for every card, so it ranks the whole catalog.
        const described = [query.from, query.q, query.fit].map(describedWords).find((ws) => ws.length > 0) ?? []
        const rankText =
          wanted === "relevance" && (termsQuery(r.words, parsed.tags) !== null || key !== "") ? described.join(" ") : ""
        const base = {
          stats: market,
          understood: describeSearch(parsed, r.sellerHandles),
          chips: searchChips(parsed, r.sellerHandles),
          unknown: r.unknown,
          sort: wanted === "relevance" && rankText === "" ? ("recent" as const) : wanted,
          fit: key === "" ? null : { phrase: query.fit, applied }
        }

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

        // No search, no grader and no judged description: the counts are the whole market's, already cached.
        const unfiltered = isEmptySearch(parsed) && query.grader === null && r.fit === null
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
        const vector = total === 0 || base.sort !== "relevance" ? null : yield* rankVector(rankText)
        const sort = base.sort === "relevance" && total > 0 && vector === null ? "recent" : base.sort
        const pageOf = { r, grader: query.grader, set: knownSet, limit: query.limit, offset: query.offset }
        const page =
          total === 0
            ? []
            : vector !== null
              ? // The whole market is counted exactly from stats, but fetching it all to sort would read every listing.
                yield* bestMatchPage({ ...pageOf, vector, exact: !unfiltered && exact })
              : (yield* sortedPage({ ...pageOf, sort: sort === "relevance" ? "recent" : sort, materialize: !unfiltered && exact })).map(
                  (x) => x.listingId
                )
        const sets = tabs(exact ? counts : {})
        return {
          ...base,
          sort,
          ids: page,
          total,
          exact,
          counts: { all, sets: exact ? Object.fromEntries(sets.map((s) => [s.id, counts[s.id] ?? 0])) : {} },
          sets,
          suggestion: null
        }
      })

    const fitCandidates = Effect.fn("SearchService.fitCandidates")(function* (query: MarketQuery, limit: number) {
      // Best match's first round is one listing per card, best card first.
      const found = yield* run({ ...query, sort: "relevance", offset: 0, limit }, false, false)
      if (found.ids.length === 0) return []
      const rows = yield* sql<{
        readonly listingId: string
        readonly cardId: string
        readonly catalogText: string
        readonly name: string
      }>`
        SELECT ls.listing_id, c.id AS card_id, c.catalog_text, c.name
        FROM listing_search ls JOIN cards c ON c.id = ls.card_id
        WHERE ls.listing_id IN ${sql.in(found.ids)}`
      const byListing = new Map(rows.map((x) => [x.listingId, x]))
      const out: Array<FitCandidate> = []
      for (const id of found.ids) {
        const row = byListing.get(id)
        if (row === undefined || out.some((c) => c.id === row.cardId)) continue
        out.push({ id: row.cardId, text: fitText(row.catalogText, row.name), catalogText: row.catalogText })
      }
      return out
    })

    return SearchService.of({
      search: (query) => run(query, true).pipe(Effect.withSpan("SearchService.search", { attributes: { "search.q": query.q } })),
      fitCandidates,
      stats,
      knownWords,
      closeWords
    })
  })
)
