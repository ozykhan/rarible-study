import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { toTextArray, toVector } from "../db/Database.ts"
import { Embedder, type EmbedError } from "../embeddings/Embedder.ts"
import { tagLabels } from "../tags/vocabulary.ts"

/**
 * The vector each card is ranked by in a search (Best match, see
 * SearchService). It is built at index time from trusted text only: the
 * card's catalog text (set, number, name, kinds, lore, rarity) and its tags as
 * words. Seller titles and descriptions never go in, because they can claim
 * anything. One vector per card, not per listing, so a million listings of
 * twenty thousand cards are twenty thousand vectors.
 *
 * Cards are queued by the database: new cards, and cards whose text or tags
 * changed (migration 0008). A queued card keeps its old vector until the new
 * one is written.
 */

/** The text a card's search vector is made from. */
export const cardSearchText = (catalogText: string, tags: ReadonlyArray<string>): string => {
  const labels = tagLabels(tags)
  return labels.length === 0 ? catalogText : `${catalogText} Described as: ${labels.join(", ")}.`
}

/** The length a search vector is scaled to before its parts are rounded to whole numbers. */
export const SEARCH_VECTOR_SCALE = 2048

/**
 * A search vector as it is stored and queried: the embedding scaled to length
 * SEARCH_VECTOR_SCALE, each part rounded to a whole number. Best match orders
 * cards by the dot product of their vector with the query's, and with whole
 * numbers this small every sum along the way is exact in single precision
 * (at most 2048 squared, far below 2^24). So Postgres and OpenSearch, on any
 * CPU and in any summing order, compute the same number for each card, and
 * cards that tie, tie in both. With fractions, two cards a hair apart could
 * swap places from one engine or machine to the next. Rounding moves a card's
 * similarity by about 0.0002 on a scale where 1 is a perfect match.
 */
export const searchVector = (embedding: ReadonlyArray<number>): ReadonlyArray<number> => {
  const length = Math.sqrt(embedding.reduce((s, x) => s + x * x, 0))
  return embedding.map((x) => (length === 0 ? 0 : Math.round((x / length) * SEARCH_VECTOR_SCALE)))
}

export interface VectorRun {
  /** Cards read from the queue. */
  readonly cards: number
  /** Vectors written. A card that changed again while it was embedded stays queued. */
  readonly written: number
}

export class CardVectors extends Context.Service<
  CardVectors,
  {
    /** Cards waiting for a new search vector. */
    readonly queued: Effect.Effect<number, SqlError>
    /** Writes search vectors for up to `limit` queued cards, a chunk at a time. */
    readonly refresh: (limit: number) => Effect.Effect<VectorRun, SqlError | EmbedError>
  }
>()("slabwatch/CardVectors") {}

/** Cards per statement: one embedder call and one UPDATE. */
const CHUNK = 64

export const CardVectorsLive = Layer.effect(
  CardVectors,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const embedder = yield* Embedder

    const queued = sql<{ readonly n: number }>`SELECT count(*)::int AS n FROM cards WHERE search_vector_stale`.pipe(
      Effect.map((rows) => rows[0]?.n ?? 0)
    )

    const refresh = Effect.fn("CardVectors.refresh")(function* (limit: number) {
      let cards = 0
      let written = 0
      while (cards < limit) {
        const rows = yield* sql<{ readonly id: string; readonly catalogText: string; readonly tags: ReadonlyArray<string> }>`
          SELECT id, catalog_text, tags FROM cards WHERE search_vector_stale
          ORDER BY id LIMIT ${Math.min(CHUNK, limit - cards)}`
        if (rows.length === 0) break
        const texts = rows.map((r) => cardSearchText(r.catalogText, r.tags))
        const vectors = yield* embedder.embed(texts, "document")
        // Written only if the card still has the text and tags it was embedded from; otherwise it stays queued.
        // Tags go in as one text per card ("bird,flies"): unnest cannot take a ragged 2-D array. string_to_array('', ',') is '{}'.
        const updated = yield* sql<{ readonly id: string }>`
          UPDATE cards c SET search_vector = v.vector, search_vector_stale = false
          FROM unnest(
            ${toTextArray(rows.map((r) => r.id))}::text[],
            ${toTextArray(rows.map((r) => r.catalogText))}::text[],
            ${toTextArray(rows.map((r) => r.tags.join(",")))}::text[],
            ${toTextArray(vectors.map((v) => toVector(searchVector(v))))}::vector[]
          ) AS v(id, catalog_text, tags, vector)
          WHERE c.id = v.id AND c.catalog_text = v.catalog_text AND c.tags = string_to_array(v.tags, ',')
          RETURNING c.id`
        cards += rows.length
        written += updated.length
        // A chunk where nothing could be written would be read again forever.
        if (updated.length === 0) break
      }
      return { cards, written } satisfies VectorRun
    })

    return CardVectors.of({ queued, refresh })
  })
)
