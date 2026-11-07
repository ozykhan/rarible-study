import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { toTextArray } from "../../db/Database.ts"
import type { SearchEngineError } from "../SearchService.ts"
import { CARDS_INDEX, LISTINGS_INDEX, OpenSearch, trigrams, WORDS_INDEX, type BulkOp, type IndexNames } from "./OpenSearch.ts"

/**
 * Keeps OpenSearch's copy of what market search reads in step with Postgres.
 *
 * A full copy is built in fresh indexes while searches keep reading the old
 * ones, then the aliases move to it in one step. From the moment a copy
 * starts, Postgres records every listing, card and word that changes in
 * search_outbox (migration 0010); applying the outbox reads each one's current
 * state and writes it, or deletes it, in the engine. A change made during the
 * copy is in the outbox too, so nothing is missed: it is only seen a moment
 * late, and seeing it twice is harmless.
 */

/** The name a copy is registered under in search_copies. While any copy is registered, Postgres records changes. */
const COPY_NAME = "opensearch"

/** Rows per read from Postgres and per bulk request while copying. */
const COPY_BATCH = 5000

export interface CopyRun {
  readonly listings: number
  readonly cards: number
  readonly words: number
  readonly seconds: number
}

export class SearchSync extends Context.Service<
  SearchSync,
  {
    /** Starts recording changes, copies everything into new indexes, and switches searches to them. */
    readonly copyAll: Effect.Effect<CopyRun, SqlError | SearchEngineError>
    /** Applies up to `limit` recorded changes, oldest first, and says how many it applied. */
    readonly applyChanges: (limit: number) => Effect.Effect<number, SqlError | SearchEngineError>
    /** Changes recorded and not yet applied. */
    readonly pending: Effect.Effect<number, SqlError>
    /** Makes every write so far searchable now, instead of within the next second. */
    readonly refresh: Effect.Effect<void, SearchEngineError>
    /** Stops recording changes and drops the ones not applied: for when the copy is no longer used. */
    readonly stopRecording: Effect.Effect<void, SqlError>
  }
>()("slabwatch/SearchSync") {}

interface ListingRow {
  readonly listingId: string
  readonly cardId: string
  readonly setId: string
  readonly cardNumber: string
  readonly edition: string
  readonly finish: string
  readonly grader: string
  readonly grade: number
  readonly certNumber: string
  readonly sellerId: string
  readonly usdCents: number
  readonly listedAt: string
  readonly terms: ReadonlyArray<string>
}

interface CardRow {
  readonly id: string
  readonly setId: string
  readonly number: string
  readonly terms: ReadonlyArray<string>
  readonly vector: string | null
}

const listingDoc = (r: ListingRow) => ({
  listing_id: r.listingId,
  card_id: r.cardId,
  set_id: r.setId,
  card_number: r.cardNumber,
  edition: r.edition,
  finish: r.finish,
  grader: r.grader,
  grade: r.grade,
  cert_number: r.certNumber,
  seller_id: r.sellerId,
  usd_cents: r.usdCents,
  listed_at: r.listedAt,
  terms: r.terms
})

// pgvector prints a vector as a JSON array.
const cardDoc = (r: CardRow) => ({
  card_id: r.id,
  set_id: r.setId,
  number: r.number,
  terms: r.terms,
  ...(r.vector === null ? {} : { search_vector: JSON.parse(r.vector) as ReadonlyArray<number> })
})

const wordDoc = (term: string) => {
  const t = trigrams(term)
  return { term, trigrams: t, trigram_count: t.length }
}

export const SearchSyncLive = Layer.effect(
  SearchSync,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const os = yield* OpenSearch
    const { indexes } = os

    // Timestamps print with microseconds in UTC, which date_nanos keeps exactly.
    const listingColumns = sql`
      listing_id, card_id, set_id, card_number, edition, finish, grader, grade::float8 AS grade, cert_number, seller_id,
      usd_cents::float8 AS usd_cents, to_char(listed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS listed_at,
      tsvector_to_array(terms) AS terms`
    const cardColumns = sql`id, set_id, number, tsvector_to_array(search_terms) AS terms, search_vector::text AS vector`

    /**
     * Registers the copy so Postgres records changes from now on. The SHARE
     * locks wait for writes already under way to commit: one that began before
     * the copy was registered would record nothing, and if it committed after
     * the copy read past its row, the copy would never see it.
     */
    const startRecording = sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`LOCK TABLE listing_search, cards, search_vocab IN SHARE MODE`
        yield* sql`INSERT INTO search_copies (name) VALUES (${COPY_NAME}) ON CONFLICT DO NOTHING`
      })
    )

    /** Every row of a table in primary key order, a batch at a time, each batch written as one bulk request. */
    const copyTable = <R>(
      read: (after: string) => Effect.Effect<ReadonlyArray<R>, SqlError>,
      key: (row: R) => string,
      op: (row: R) => BulkOp
    ) =>
      Effect.gen(function* () {
        let after = ""
        let copied = 0
        while (true) {
          const rows = yield* read(after)
          if (rows.length === 0) return copied
          yield* os.bulk(rows.map(op))
          copied += rows.length
          after = key(rows[rows.length - 1]!)
        }
      })

    const copyAll = Effect.gen(function* () {
      const started = performance.now()
      yield* startRecording
      const stamp = Date.now()
      const target: IndexNames = {
        listings: `${indexes.listings}-${stamp}`,
        cards: `${indexes.cards}-${stamp}`,
        words: `${indexes.words}-${stamp}`
      }
      // Refreshing while loading only makes segments nobody reads yet.
      const loading = (body: { readonly settings: { readonly index: object } }) => ({
        ...body,
        settings: { index: { ...body.settings.index, refresh_interval: "-1" } }
      })
      yield* os.call("PUT", `/${target.listings}`, loading(LISTINGS_INDEX))
      yield* os.call("PUT", `/${target.cards}`, loading(CARDS_INDEX))
      yield* os.call("PUT", `/${target.words}`, loading(WORDS_INDEX))

      const words = yield* copyTable(
        (after) => sql<{ readonly term: string }>`
          SELECT term FROM search_vocab WHERE term > ${after} ORDER BY term LIMIT ${COPY_BATCH}`,
        (r) => r.term,
        (r) => ({ index: target.words, id: r.term, doc: wordDoc(r.term) })
      )
      const cards = yield* copyTable(
        (after) => sql<CardRow>`SELECT ${cardColumns} FROM cards WHERE id > ${after} ORDER BY id LIMIT ${COPY_BATCH}`,
        (r) => r.id,
        (r) => ({ index: target.cards, id: r.id, doc: cardDoc(r) })
      )
      const listings = yield* copyTable(
        (after) => sql<ListingRow>`
          SELECT ${listingColumns} FROM listing_search WHERE listing_id > ${after} ORDER BY listing_id LIMIT ${COPY_BATCH}`,
        (r) => r.listingId,
        (r) => ({ index: target.listings, id: r.listingId, doc: listingDoc(r) })
      )

      for (const index of Object.values(target)) {
        yield* os.call("PUT", `/${index}/_settings`, { index: { refresh_interval: "1s" } })
      }
      yield* os.call("POST", `/${Object.values(target).join(",")}/_refresh`)
      // One request moves every alias and drops the indexes they pointed at, so a search sees the old copy or the new one.
      const actions: Array<object> = []
      for (const kind of ["listings", "cards", "words"] as const) {
        const current = (yield* os.call("GET", `/_alias/${indexes[kind]}`, undefined, { missingOk: true })) ?? {}
        for (const old of Object.keys(current)) actions.push({ remove_index: { index: old } })
        actions.push({ add: { index: target[kind], alias: indexes[kind] } })
      }
      yield* os.call("POST", "/_aliases", { actions })
      return { listings, cards, words, seconds: (performance.now() - started) / 1000 } satisfies CopyRun
    }).pipe(Effect.withSpan("SearchSync.copyAll"))

    /**
     * Takes the oldest recorded changes off the outbox and writes the current
     * state of what they name, in one transaction: if the engine refuses the
     * write, the rows go back and are tried again.
     */
    const applyChanges = Effect.fn("SearchSync.applyChanges")(function* (limit: number) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const taken = yield* sql<{ readonly kind: "listing" | "card" | "word"; readonly key: string }>`
            DELETE FROM search_outbox WHERE id IN (
              SELECT id FROM search_outbox ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED
            ) RETURNING kind, key`
          if (taken.length === 0) return 0
          const keys = (kind: string) => [...new Set(taken.filter((t) => t.kind === kind).map((t) => t.key))]
          const ops: Array<BulkOp> = []

          const listingIds = keys("listing")
          if (listingIds.length > 0) {
            const rows = yield* sql<ListingRow>`
              SELECT ${listingColumns} FROM listing_search WHERE listing_id = ANY(${toTextArray(listingIds)}::text[])`
            const found = new Set(rows.map((r) => r.listingId))
            for (const r of rows) ops.push({ index: indexes.listings, id: r.listingId, doc: listingDoc(r) })
            for (const id of listingIds) if (!found.has(id)) ops.push({ index: indexes.listings, id, delete: true })
          }
          const cardIds = keys("card")
          if (cardIds.length > 0) {
            const rows = yield* sql<CardRow>`SELECT ${cardColumns} FROM cards WHERE id = ANY(${toTextArray(cardIds)}::text[])`
            const found = new Set(rows.map((r) => r.id))
            for (const r of rows) ops.push({ index: indexes.cards, id: r.id, doc: cardDoc(r) })
            for (const id of cardIds) if (!found.has(id)) ops.push({ index: indexes.cards, id, delete: true })
          }
          const terms = keys("word")
          if (terms.length > 0) {
            const rows = yield* sql<{ readonly term: string }>`
              SELECT term FROM search_vocab WHERE term = ANY(${toTextArray(terms)}::text[])`
            const found = new Set(rows.map((r) => r.term))
            for (const r of rows) ops.push({ index: indexes.words, id: r.term, doc: wordDoc(r.term) })
            for (const term of terms) if (!found.has(term)) ops.push({ index: indexes.words, id: term, delete: true })
          }
          yield* os.bulk(ops)
          return taken.length
        })
      )
    })

    const pending = sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM search_outbox`.pipe(
      Effect.map((rows) => rows[0]?.n ?? 0)
    )

    const refresh = os.call("POST", `/${indexes.listings},${indexes.cards},${indexes.words}/_refresh`).pipe(Effect.asVoid)

    const stopRecording = sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`DELETE FROM search_copies WHERE name = ${COPY_NAME}`
        yield* sql`DELETE FROM search_outbox`
      })
    )

    return SearchSync.of({ copyAll, applyChanges, pending, refresh, stopRecording })
  })
)
