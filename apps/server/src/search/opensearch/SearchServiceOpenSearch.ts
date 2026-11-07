import type { Grader } from "@slabwatch/domain"
import { Cache, Effect, Exit, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { toTextArray } from "../../db/Database.ts"
import { Embedder } from "../../embeddings/Embedder.ts"
import { searchVector } from "../CardVectors.ts"
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
  type TagFilter
} from "../query.ts"
import {
  COUNT_LIMIT,
  fitText,
  QUERY_VECTORS,
  SearchService,
  STATS_TTL,
  type FitCandidate,
  type MarketSearchResult,
  type MarketStats,
  type SearchError,
  type SetRef
} from "../SearchService.ts"
import { OpenSearch, trigrams, type Hit } from "./OpenSearch.ts"

/**
 * Market search answered by OpenSearch, behind the same SearchService the
 * route uses. It reads the copy SearchSync keeps (OpenSearch.ts has the
 * indexes) and gives the same answers as SearchServicePg, page for page: the
 * parity test checks every kind of search against both.
 *
 * What moves to the engine is the heavy part: matching words and filters
 * over every active listing, counting per set, sorting and paging, ranking
 * cards by meaning, and the catalog words. Small lookups stay in Postgres,
 * the source of truth: the set list, seller handles, the cards a model judged
 * to fit a description, and card text for the judge.
 *
 * The main difference in shape: Postgres counts and pages with separate
 * queries, while one engine request returns the page and the per-set counts
 * together, the counts from an aggregation over the whole search and the
 * page narrowed to the chosen set by a post filter.
 */

/** More sets than the catalog will hold, so the per-set counts are never cut off. */
const SETS_MAX = 10_000

/** Cards ranked per round trip in Best match, at first. Each round asks for four times as many as the last. */
const CARD_BATCH = 200

/** The most hits one engine request returns, its default result window. */
const WINDOW = 10_000

/**
 * A card's score in Best match: its vector's dot product with the query's,
 * plus 2^23 so that no score is negative. Search vectors are whole numbers of
 * length 2048 (searchVector), so the dot product is a whole number between
 * minus and plus 2048 squared, and the score a whole number below 2^24: a
 * float holds it exactly, and the engine sums it exactly whatever order its
 * vector instructions add in. The distance pgvector's <#> orders by is 2^23
 * minus the score, the same number to the last digit. A card with no vector
 * yet scores 0 and ranks last, as a null distance does in Postgres.
 */
const SCORE_OFFSET = 2 ** 23
export const VECTOR_SCORE = `doc['search_vector'].size() == 0 ? 0 : ${SCORE_OFFSET} + innerProduct(params.v, doc['search_vector'])`
export const distance = (score: number) => (score === 0 ? Number.POSITIVE_INFINITY : SCORE_OFFSET - score)

/**
 * pg_trgm's similarity, worked out in the engine: the bool query scores a
 * word by how many trigrams it shares with the one typed, and this divides
 * that by how many the two have between them. Float, as pg_trgm computes it.
 */
const TRIGRAM_SIMILARITY = "float s = (float) _score; return s / ((float) params.n + (float) doc['trigram_count'].value - s);"

/** The words a search asks a card to start with, each one a prefix query on its terms. */
const prefixes = (words: ReadonlyArray<string>) => words.map((w) => ({ prefix: { terms: w } }))

/** A tag, or else every word that asked for it, as in termsQuery for Postgres. */
const tagClause = (t: TagFilter) =>
  t.words.length === 0
    ? { term: { terms: `#${t.tag}` } }
    : { bool: { should: [{ term: { terms: `#${t.tag}` } }, { bool: { filter: prefixes(t.words) } }], minimum_should_match: 1 } }

const sortClause = (sort: Exclude<MarketSort, "relevance">): ReadonlyArray<object> => {
  switch (sort) {
    case "recent":
      return [{ listed_at: "desc" }, { listing_id: "asc" }]
    case "price_asc":
      return [{ usd_cents: "asc" }, { listed_at: "desc" }, { listing_id: "asc" }]
    case "price_desc":
      return [{ usd_cents: "desc" }, { listed_at: "asc" }, { listing_id: "desc" }]
    case "grade":
      return [{ grade: "desc" }, { listed_at: "desc" }, { listing_id: "asc" }]
  }
}

const bool = (filter: ReadonlyArray<object>) => (filter.length === 0 ? { match_all: {} } : { bool: { filter } })

interface Resolved {
  readonly parsed: ParsedSearch
  readonly words: ReadonlyArray<string>
  readonly sellerIds: ReadonlyArray<string>
  readonly sellerHandles: ReadonlyArray<string>
  readonly missingSeller: boolean
  readonly unknown: ReadonlyArray<string>
  /** The cards judged to fit the search's description, when it was judged: only they match. */
  readonly fitIds: ReadonlyArray<string> | null
}

/** A card's first listing in Best match: its newest one that matches. */
interface First {
  readonly cardId: string
  readonly d: number
  readonly listingId: string
  readonly listedAt: number
}

/** The first round's order: closest card first, then newest listing, then listing id. Cards with no vector are all at Infinity, and Infinity minus Infinity is NaN, which counts as a tie. */
const firstOrder = (a: First, b: First) =>
  a.d - b.d || b.listedAt - a.listedAt || (a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0)

export const SearchServiceOpenSearch = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const os = yield* OpenSearch
    const embedder = yield* Embedder
    const { indexes } = os

    const statsQuery = Effect.gen(function* () {
      const res = yield* os.search(indexes.listings, {
        size: 0,
        track_total_hits: false,
        aggs: { sets: { terms: { field: "set_id", size: SETS_MAX }, aggs: { floor: { min: { field: "usd_cents" } } } } }
      })
      const rows = (res.aggregations?.["sets"]?.buckets ?? []) as ReadonlyArray<{
        readonly key: string
        readonly doc_count: number
        readonly floor: { readonly value: number | null }
      }>
      const floors = rows.map((r) => r.floor.value).filter((f): f is number => f !== null)
      return {
        count: rows.reduce((n, r) => n + r.doc_count, 0),
        floorUnits: floors.length === 0 ? null : Math.min(...floors),
        setCount: rows.filter((r) => r.doc_count > 0).length,
        sets: Object.fromEntries(rows.map((r) => [r.key, { count: r.doc_count, floorUnits: r.floor.value }]))
      } satisfies MarketStats
    }).pipe(Effect.withSpan("SearchService.stats"))
    const stats = yield* Effect.cachedWithTTL(statsQuery, STATS_TTL)

    const allSets = yield* Effect.cachedWithTTL(sql<SetRef>`SELECT id, name FROM sets ORDER BY release_year, id`, "1 minute")

    const queryVectors = yield* Cache.makeWith(
      (text: string) =>
        embedder.embed([text], "query").pipe(
          Effect.map((vs) => searchVector(vs[0] ?? [])),
          Effect.withSpan("SearchService.queryVector")
        ),
      { capacity: QUERY_VECTORS.capacity, timeToLive: (exit) => (Exit.isSuccess(exit) ? QUERY_VECTORS.timeToLive : 0) }
    )

    const knownWords = Effect.fn("SearchService.knownWords")(function* (words: ReadonlyArray<string>) {
      if (words.length === 0) return []
      // One request: a filter per word, each counting the catalog words it starts.
      const res = yield* os.search(indexes.words, {
        size: 0,
        track_total_hits: false,
        aggs: { known: { filters: { filters: Object.fromEntries(words.map((w, i) => [String(i), { prefix: { term: w } }])) } } }
      })
      const buckets = (res.aggregations?.["known"]?.buckets ?? {}) as Readonly<Record<string, { readonly doc_count: number }>>
      return words.filter((_, i) => (buckets[String(i)]?.doc_count ?? 0) > 0)
    })

    const closeWords = Effect.fn("SearchService.closeWords")(function* (
      words: ReadonlyArray<string>,
      limit: number,
      threshold?: number
    ) {
      if (words.length === 0) return {}
      const unique = [...new Set(words)]
      const res = yield* os.msearch(
        unique.map((w) => {
          const t = trigrams(w)
          return {
            index: indexes.words,
            body: {
              size: limit,
              track_total_hits: false,
              _source: false,
              query: {
                script_score: {
                  query: {
                    bool: { should: t.map((x) => ({ constant_score: { filter: { term: { trigrams: x } } } })), minimum_should_match: 1 }
                  },
                  script: { source: TRIGRAM_SIMILARITY, params: { n: t.length } }
                }
              },
              // pg_trgm's default cutoff.
              min_score: threshold ?? 0.3,
              sort: [{ _score: "desc" }, { term: "asc" }]
            }
          }
        })
      )
      return Object.fromEntries(unique.map((w, i) => [w, res[i]!.hits.hits.map((h) => h._id)]))
    })

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
        fitIds: null
      } satisfies Resolved
    })

    /** What the search asks of the card itself: its words and tags, set, number, and the cards judged to fit. */
    const cardFilters = (r: Resolved, set: string | null, on: "listings" | "cards"): Array<object> => {
      const p = r.parsed
      const c: Array<object> = [...prefixes(r.words), ...p.tags.map(tagClause)]
      if (set !== null) c.push({ term: { set_id: set } })
      if (p.cardNumber !== null) c.push({ term: { [on === "listings" ? "card_number" : "number"]: p.cardNumber } })
      if (r.fitIds !== null) c.push({ terms: { card_id: r.fitIds } })
      return c
    }

    /** What the search asks of the slab and the listing. */
    const listingFilters = (r: Resolved, grader: Grader | null): Array<object> => {
      const p = r.parsed
      const c: Array<object> = []
      if (grader !== null) c.push({ term: { grader } })
      if (p.graders.length > 0) c.push({ terms: { grader: p.graders } })
      if (p.editions.length > 0) c.push({ terms: { edition: p.editions } })
      if (p.finishes.length > 0) c.push({ terms: { finish: p.finishes } })
      if (p.grades.length > 0) c.push({ terms: { grade: p.grades } })
      if (p.minGrade !== null) c.push({ range: { grade: { gte: p.minGrade } } })
      if (p.maxUsdCents !== null) c.push({ range: { usd_cents: { lte: p.maxUsdCents } } })
      if (p.cert !== null) c.push({ term: { cert_number: p.cert } })
      if (r.sellerIds.length > 0) c.push({ terms: { seller_id: r.sellerIds } })
      return c
    }

    /** The cards a model judged against a description, or null when none was judged under the current prompt. */
    const verdicts = (key: string) =>
      sql<{ readonly cardId: string; readonly fits: boolean }>`
        SELECT card_id, fits FROM card_fits WHERE concept = ${key} AND version = ${FIT_VERSION}`.pipe(
        Effect.map((rows) => (rows.length === 0 ? null : rows.filter((x) => x.fits).map((x) => x.cardId)))
      )

    const rankVector = (text: string) =>
      text === ""
        ? Effect.succeed(null)
        : Cache.get(queryVectors, text).pipe(
            Effect.catchCause((cause) => Effect.logWarning("search: no query vector, so newest first", cause).pipe(Effect.as(null)))
          )

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

    /**
     * One page best match first, in the order SearchServicePg defines: the
     * newest matching listing of each card, best card first, then every other
     * listing, card by card, newest first.
     *
     * Cards come from the cards index, scored exactly against the query vector
     * and filtered by what the search asks of the card, a batch at a time. For
     * each batch, one aggregation over the listings finds each card's newest
     * matching listing and how many it has. Batches stop once the first round
     * fills the page; pages past the first round read each card's other
     * listings directly, since the counts say which cards the page spans.
     */
    const bestMatchPage = Effect.fn("SearchService.bestMatchPage")(function* (o: {
      readonly r: Resolved
      readonly grader: Grader | null
      readonly set: string | null
      readonly vector: ReadonlyArray<number>
      readonly offset: number
      readonly limit: number
    }) {
      const cardQuery = bool(cardFilters(o.r, o.set, "cards"))
      const listingFilter = listingFilters(o.r, o.grader)
      const end = o.offset + o.limit
      const ranked: Array<{ readonly id: string; readonly d: number; count: number }> = []
      const firsts: Array<First> = []
      let after: ReadonlyArray<unknown> | null = null
      let size = Math.min(WINDOW, Math.max(CARD_BATCH, end))
      let lastD = Number.NaN
      // Cards that tie are ordered by their listings, so cards are read until the one that ends the page is closer
      // than the last card read: any card not read yet could tie with it. (Cards with no vector yet all tie.)
      const cutoff = () => [...firsts].sort(firstOrder)[end - 1]?.d
      while (firsts.length < end || cutoff() === lastD) {
        const res = yield* os.search(indexes.cards, {
          size,
          track_total_hits: false,
          _source: false,
          query: { script_score: { query: cardQuery, script: { source: VECTOR_SCORE, params: { v: o.vector } } } },
          sort: [{ _score: "desc" }, { card_id: "asc" }],
          ...(after === null ? {} : { search_after: after })
        })
        const hits: ReadonlyArray<Hit> = res.hits.hits
        if (hits.length === 0) break
        after = hits[hits.length - 1]!.sort ?? null
        lastD = distance(hits[hits.length - 1]!._score ?? 0)
        const cards = hits.map((h) => ({ id: h._id, d: distance(h._score ?? 0), count: 0 }))
        ranked.push(...cards)
        // Per card: how many listings match, and the newest of them. (Collapsing the hits on the card instead was slower.)
        const found = yield* os.search(indexes.listings, {
          size: 0,
          track_total_hits: false,
          query: { bool: { filter: [{ terms: { card_id: cards.map((c) => c.id) } }, ...listingFilter] } },
          aggs: {
            cards: {
              terms: { field: "card_id", size: cards.length },
              aggs: { newest: { top_hits: { size: 1, _source: false, sort: [{ listed_at: "desc" }, { listing_id: "asc" }] } } }
            }
          }
        })
        const buckets = (found.aggregations?.["cards"]?.buckets ?? []) as ReadonlyArray<{
          readonly key: string
          readonly doc_count: number
          readonly newest: { readonly hits: { readonly hits: ReadonlyArray<Hit> } }
        }>
        const byCard = new Map(buckets.map((b) => [b.key, b]))
        for (const c of cards) {
          const b = byCard.get(c.id)
          const top = b?.newest.hits.hits[0]
          if (b === undefined || top === undefined) continue
          c.count = b.doc_count
          firsts.push({ cardId: c.id, d: c.d, listingId: top._id, listedAt: Number(top.sort?.[0]) })
        }
        if (hits.length < size) break
        size = Math.min(WINDOW, size * 4)
      }
      firsts.sort(firstOrder)
      const page = firsts.slice(o.offset, end).map((f) => f.listingId)
      if (firsts.length >= end) return page

      // The second round: every listing that is not its card's first, by card, newest first. Cards that tie
      // (none of them has a vector yet) form one group whose listings interleave by date.
      const groups: Array<{ readonly ids: Array<string>; readonly firsts: Array<string>; n: number }> = []
      const firstOf = new Map(firsts.map((f) => [f.cardId, f.listingId]))
      for (const c of ranked) {
        if (c.count === 0) continue
        const last = groups[groups.length - 1]
        const group = last !== undefined && ranked.find((x) => x.id === last.ids[0])!.d === c.d ? last : undefined
        const g = group ?? { ids: [], firsts: [], n: 0 }
        if (group === undefined) groups.push(g)
        g.ids.push(c.id)
        g.firsts.push(firstOf.get(c.id)!)
        g.n += c.count - 1
      }
      const from = Math.max(0, o.offset - firsts.length)
      const want = o.limit - page.length
      const reads: Array<{ readonly index: string; readonly body: unknown }> = []
      let start = 0
      for (const g of groups) {
        const lo = Math.max(from, start)
        const hi = Math.min(from + want, start + g.n)
        if (hi > lo) {
          reads.push({
            index: indexes.listings,
            body: {
              from: lo - start,
              size: hi - lo,
              track_total_hits: false,
              _source: false,
              query: {
                bool: { filter: [{ terms: { card_id: g.ids } }, ...listingFilter], must_not: [{ ids: { values: g.firsts } }] }
              },
              sort: [{ listed_at: "desc" }, { listing_id: "asc" }]
            }
          })
        }
        start += g.n
        if (start >= from + want) break
      }
      const rest = yield* os.msearch(reads)
      return [...page, ...rest.flatMap((res) => res.hits.hits.map((h) => h._id))]
    })

    const run = (query: MarketQuery, suggest: boolean, cut = true): Effect.Effect<MarketSearchResult, SearchError> =>
      Effect.gen(function* () {
        const [market, catalogSets] = yield* Effect.all([stats, allSets])
        const knownSet = query.set !== null && catalogSets.some((s) => s.id === query.set) ? query.set : null
        const parsed = parseSearch(query.q)
        const key = fitKey(query.fit)
        const fitIds = key !== "" && cut ? yield* verdicts(key) : null
        const applied = fitIds !== null
        const r: Resolved = { ...(yield* resolve(parsed)), fitIds }
        const tabs = (counts: Readonly<Record<string, number>>) =>
          catalogSets.filter((s) => (market.sets[s.id]?.count ?? 0) > 0 || (counts[s.id] ?? 0) > 0)
        const wanted = query.sort ?? defaultSort(parsed, query.fit)
        const described = [query.from, query.q, query.fit].map(describedWords).find((ws) => ws.length > 0) ?? []
        const rankText =
          wanted === "relevance" && (r.words.length > 0 || parsed.tags.length > 0 || key !== "") ? described.join(" ") : ""
        const base = {
          stats: market,
          understood: describeSearch(parsed, r.sellerHandles),
          chips: searchChips(parsed, r.sellerHandles),
          unknown: r.unknown,
          sort: wanted === "relevance" && rankText === "" ? ("recent" as const) : wanted,
          fit: key === "" ? null : { phrase: query.fit, applied }
        }

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

        const unfiltered = isEmptySearch(parsed) && query.grader === null && r.fitIds === null
        const filter = [...cardFilters(r, null, "listings"), ...listingFilters(r, query.grader)]
        // A sorted page comes back with the counts; Best match needs the count first, to know there is a page to rank.
        const sorted = base.sort === "relevance" ? null : base.sort
        const pageRequest = (sort: Exclude<MarketSort, "relevance">) => ({
          from: query.offset,
          size: query.limit,
          sort: sortClause(sort),
          ...(knownSet === null ? {} : { post_filter: { term: { set_id: knownSet } } })
        })
        const res = yield* os.search(indexes.listings, {
          size: 0,
          track_total_hits: false,
          _source: false,
          query: bool(filter),
          ...(unfiltered ? {} : { aggs: { sets: { terms: { field: "set_id", size: SETS_MAX } } } }),
          ...(sorted === null ? {} : pageRequest(sorted))
        })
        const counted = unfiltered
          ? Object.entries(market.sets).map(([setId, s]) => ({ setId, n: s.count }))
          : ((res.aggregations?.["sets"]?.buckets ?? []) as ReadonlyArray<{ readonly key: string; readonly doc_count: number }>).map(
              (b) => ({ setId: b.key, n: b.doc_count })
            )
        const counts = Object.fromEntries(counted.map((x) => [x.setId, x.n]))
        const sum = counted.reduce((n, x) => n + x.n, 0)
        const exact = unfiltered || sum <= COUNT_LIMIT
        const all = exact ? sum : COUNT_LIMIT
        // The aggregation counts every match, so past the cap the set picked is simply capped too.
        const total = knownSet === null ? all : Math.min(counts[knownSet] ?? 0, exact ? Number.POSITIVE_INFINITY : COUNT_LIMIT)
        const vector = total === 0 || base.sort !== "relevance" ? null : yield* rankVector(rankText)
        const sort = base.sort === "relevance" && total > 0 && vector === null ? "recent" : base.sort
        const page =
          total === 0
            ? []
            : sorted !== null
              ? res.hits.hits.map((h) => h._id)
              : vector !== null
                ? yield* bestMatchPage({ r, grader: query.grader, set: knownSet, vector, offset: query.offset, limit: query.limit })
                : (yield* os.search(indexes.listings, { track_total_hits: false, _source: false, query: bool(filter), ...pageRequest("recent") })).hits.hits.map(
                    (h) => h._id
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
      search: (query) =>
        run(query, true).pipe(Effect.withSpan("SearchService.search", { attributes: { "search.q": query.q, "search.engine": "opensearch" } })),
      fitCandidates,
      stats,
      knownWords,
      closeWords
    })
  })
)
