import type { HardCriteria, ListingView } from "@slabwatch/domain"
import { catalogText, cards, sets, type LabelledListing, type SaleRow, type SellerRow } from "@slabwatch/seed"
import { Context, Effect, Layer } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import { toTextArray, toVector } from "../db/Database.ts"
import { Embedder, type EmbedError } from "../embeddings/Embedder.ts"

/** Facts about a candidate that the red-flag checks need, computed in SQL. */
export interface MarketFacts {
  readonly listingId: string
  /** Active listings that point at the same vault item, this one included. */
  readonly activeListingsForVaultItem: number
  /** Median of recent sales for the same card, variant, grader and grade, in USD cents. */
  readonly medianSaleUsdCents: number | null
}

export interface CardFacts {
  readonly cardId: string
  readonly kinds: ReadonlyArray<string>
  readonly catalogText: string
}

interface ListingRowDb {
  readonly listingId: string
  readonly vaultItemId: string
  readonly setId: string
  readonly setName: string
  readonly cardId: string
  readonly cardNumber: string
  readonly cardName: string
  readonly edition: ListingView["edition"]
  readonly finish: ListingView["finish"]
  readonly grader: ListingView["grader"]
  readonly grade: number
  readonly certNumber: string
  readonly priceMinor: number
  readonly currency: ListingView["price"]["currency"]
  readonly sellerId: string
  readonly sellerHandle: string
  readonly title: string
  readonly description: string
  readonly status: ListingView["status"]
  readonly listedAt: string
}

const toView = (r: ListingRowDb): ListingView => ({
  listingId: r.listingId,
  vaultItemId: r.vaultItemId,
  setId: r.setId,
  setName: r.setName,
  cardId: r.cardId,
  cardNumber: r.cardNumber,
  cardName: r.cardName,
  edition: r.edition,
  finish: r.finish,
  grader: r.grader,
  grade: r.grade,
  certNumber: r.certNumber,
  price: { amountMinor: r.priceMinor, currency: r.currency },
  sellerId: r.sellerId,
  sellerHandle: r.sellerHandle,
  title: r.title,
  description: r.description,
  status: r.status,
  listedAt: r.listedAt
})

/** Seller text is embedded as title plus description. */
export const listingEmbeddingText = (l: { readonly title: string; readonly description: string }) =>
  `${l.title}. ${l.description}`

export class CatalogRepo extends Context.Service<
  CatalogRepo,
  {
    readonly insertCatalog: (sellers: ReadonlyArray<SellerRow>) => Effect.Effect<void, SqlError | EmbedError>
    readonly insertSales: (sales: ReadonlyArray<SaleRow>) => Effect.Effect<void, SqlError>
    readonly insertListings: (
      listings: ReadonlyArray<LabelledListing>,
      options?: { readonly listedAt?: Date }
    ) => Effect.Effect<void, SqlError | EmbedError>
    readonly getListing: (id: string) => Effect.Effect<ListingView | null, SqlError>
    readonly listActive: (limit: number) => Effect.Effect<ReadonlyArray<ListingView>, SqlError>
    readonly listedSince: (since: Date) => Effect.Effect<ReadonlyArray<ListingView>, SqlError>
    /** Active listings that pass every hard criterion, as one SQL query. */
    readonly hardCandidates: (hard: HardCriteria) => Effect.Effect<ReadonlyArray<ListingView>, SqlError>
    readonly marketFacts: (listingIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<MarketFacts>, SqlError>
    readonly cardFacts: (cardIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<CardFacts>, SqlError>
    /** Cosine similarity of a query vector to each listing's text, or to its catalog card. */
    readonly similarities: (
      query: ReadonlyArray<number>,
      listingIds: ReadonlyArray<string>,
      against: "listing" | "card"
    ) => Effect.Effect<ReadonlyMap<string, number>, SqlError>
    readonly priceHistory: (args: {
      readonly cardId: string
      readonly edition: string
      readonly finish: string
      readonly grader: string
      readonly grade: number
    }) => Effect.Effect<ReadonlyArray<{ readonly priceMinor: number; readonly soldAt: string }>, SqlError>
  }
>()("slabwatch/CatalogRepo") {}

const selectView = (sql: SqlClient) => sql`
  SELECT l.id AS listing_id, l.vault_item_id, c.set_id, s.name AS set_name, c.id AS card_id,
         c.number AS card_number, c.name AS card_name, v.edition, v.finish, v.grader,
         v.grade::float8 AS grade, v.cert_number, l.price_minor::float8 AS price_minor, l.currency,
         l.seller_id, se.handle AS seller_handle, l.title, l.description, l.status,
         to_char(l.listed_at AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS listed_at
  FROM listings l
  JOIN vault_items v ON v.id = l.vault_item_id
  JOIN cards c ON c.id = v.card_id
  JOIN sets s ON s.id = c.set_id
  JOIN sellers se ON se.id = l.seller_id`

export const CatalogRepoLive = Layer.effect(
  CatalogRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const embedder = yield* Embedder

    const insertCatalog = Effect.fn("CatalogRepo.insertCatalog")(function* (sellers: ReadonlyArray<SellerRow>) {
      for (const s of sets) {
        yield* sql`INSERT INTO sets (id, code, name, release_year)
                   VALUES (${s.id}, ${s.code}, ${s.name}, ${s.releaseYear}) ON CONFLICT (id) DO NOTHING`
      }
      const texts = cards.map(catalogText)
      const vectors = yield* embedder.embed(texts, "document")
      for (const [i, c] of cards.entries()) {
        const vec = vectors[i] ?? []
        yield* sql`INSERT INTO cards (id, set_id, number, name, rarity, kinds, catalog_text, embedding)
                   VALUES (${c.id}, ${c.setId}, ${c.number}, ${c.name}, ${c.rarity},
                           ${toTextArray(c.kinds)}::text[], ${texts[i] ?? ""}, ${toVector(vec)}::vector)
                   ON CONFLICT (id) DO NOTHING`
      }
      for (const s of sellers) {
        yield* sql`INSERT INTO sellers (id, handle) VALUES (${s.id}, ${s.handle}) ON CONFLICT (id) DO NOTHING`
      }
    })

    const insertSales = Effect.fn("CatalogRepo.insertSales")(function* (sales: ReadonlyArray<SaleRow>) {
      const chunk = 1000
      for (let i = 0; i < sales.length; i += chunk) {
        const rows = sales.slice(i, i + chunk)
        yield* sql`
          INSERT INTO sales (card_id, edition, finish, grader, grade, price_minor, sold_at)
          SELECT * FROM unnest(
            ${toTextArray(rows.map((r) => r.cardId))}::text[],
            ${toTextArray(rows.map((r) => r.edition))}::text[],
            ${toTextArray(rows.map((r) => r.finish))}::text[],
            ${toTextArray(rows.map((r) => r.grader))}::text[],
            ${toTextArray(rows.map((r) => String(r.grade)))}::numeric[],
            ${toTextArray(rows.map((r) => String(r.priceMinor)))}::bigint[],
            ${toTextArray(rows.map((r) => new Date(Date.now() - r.daysAgo * 86_400_000).toISOString()))}::timestamptz[]
          )`
      }
    })

    const insertListings = Effect.fn("CatalogRepo.insertListings")(function* (
      listings: ReadonlyArray<LabelledListing>,
      options?: { readonly listedAt?: Date }
    ) {
      const vectors = yield* embedder.embed(
        listings.map((x) => listingEmbeddingText(x.listing)),
        "document"
      )
      const now = Date.now()
      for (const [i, { listing: l, vaultItem: v }] of listings.entries()) {
        yield* sql`INSERT INTO vault_items (id, card_id, edition, finish, grader, grade, cert_number)
                   VALUES (${v.id}, ${v.cardId}, ${v.edition}, ${v.finish}, ${v.grader}, ${v.grade}, ${v.certNumber})
                   ON CONFLICT (id) DO NOTHING`
        const listedAt = options?.listedAt ?? new Date(now - l.listedMinutesAgo * 60_000)
        yield* sql`INSERT INTO listings (id, vault_item_id, seller_id, title, description, price_minor, currency,
                                         status, listed_at, source, embedding)
                   VALUES (${l.id}, ${l.vaultItemId}, ${l.sellerId}, ${l.title}, ${l.description}, ${l.priceMinor},
                           ${l.currency}, ${l.status}, ${listedAt.toISOString()}::timestamptz, ${l.source},
                           ${toVector(vectors[i] ?? [])}::vector)`
      }
    })

    const getListing = Effect.fn("CatalogRepo.getListing")(function* (id: string) {
      const rows = yield* sql<ListingRowDb>`${selectView(sql)} WHERE l.id = ${id}`
      const row = rows[0]
      return row ? toView(row) : null
    })

    const listActive = Effect.fn("CatalogRepo.listActive")(function* (limit: number) {
      const rows = yield* sql<ListingRowDb>`${selectView(sql)} WHERE l.status = 'active'
                                             ORDER BY l.listed_at DESC LIMIT ${limit}`
      return rows.map(toView)
    })

    const listedSince = Effect.fn("CatalogRepo.listedSince")(function* (since: Date) {
      const rows = yield* sql<ListingRowDb>`${selectView(sql)}
        WHERE l.status = 'active' AND l.listed_at > ${since.toISOString()}::timestamptz
        ORDER BY l.listed_at ASC`
      return rows.map(toView)
    })

    const hardCandidates = Effect.fn("CatalogRepo.hardCandidates")(function* (hard: HardCriteria) {
      const clauses = [
        sql`l.status = 'active'`,
        sql`l.currency = ${hard.maxPrice.currency}`,
        sql`l.price_minor <= ${hard.maxPrice.amountMinor}`,
        sql`v.grade >= ${hard.minGrade}`
      ]
      if (hard.graders.length > 0) clauses.push(sql`v.grader IN ${sql.in(hard.graders)}`)
      if (hard.setId !== null) clauses.push(sql`c.set_id = ${hard.setId}`)
      if (hard.cardId !== null) clauses.push(sql`c.id = ${hard.cardId}`)
      if (hard.edition !== "any") clauses.push(sql`v.edition = ${hard.edition}`)
      if (hard.finish !== "any") clauses.push(sql`v.finish = ${hard.finish}`)
      const rows = yield* sql<ListingRowDb>`${selectView(sql)} WHERE ${sql.and(clauses)} ORDER BY l.listed_at DESC`
      return rows.map(toView)
    })

    const marketFacts = Effect.fn("CatalogRepo.marketFacts")(function* (listingIds: ReadonlyArray<string>) {
      if (listingIds.length === 0) return []
      return yield* sql<MarketFacts>`
        SELECT l.id AS listing_id,
               (SELECT count(*)::int FROM listings l2
                 WHERE l2.vault_item_id = l.vault_item_id AND l2.status = 'active') AS active_listings_for_vault_item,
               (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sa.price_minor)::float8 FROM sales sa
                 WHERE sa.card_id = v.card_id AND sa.edition = v.edition AND sa.finish = v.finish
                   AND sa.grader = v.grader AND sa.grade = v.grade
                   AND sa.sold_at > now() - interval '365 days') AS median_sale_usd_cents
        FROM listings l JOIN vault_items v ON v.id = l.vault_item_id
        WHERE l.id IN ${sql.in(listingIds)}`
    })

    const cardFacts = Effect.fn("CatalogRepo.cardFacts")(function* (cardIds: ReadonlyArray<string>) {
      if (cardIds.length === 0) return []
      return yield* sql<CardFacts>`SELECT id AS card_id, kinds, catalog_text FROM cards WHERE id IN ${sql.in(cardIds)}`
    })

    const similarities = Effect.fn("CatalogRepo.similarities")(function* (
      query: ReadonlyArray<number>,
      listingIds: ReadonlyArray<string>,
      against: "listing" | "card"
    ) {
      if (listingIds.length === 0) return new Map<string, number>()
      const vec = toVector(query)
      // <=> is pgvector's cosine distance; similarity = 1 - distance.
      const rows =
        against === "listing"
          ? yield* sql<{ listingId: string; similarity: number }>`
              SELECT l.id AS listing_id, (1 - (l.embedding <=> ${vec}::vector))::float8 AS similarity
              FROM listings l WHERE l.id IN ${sql.in(listingIds)}`
          : yield* sql<{ listingId: string; similarity: number }>`
              SELECT l.id AS listing_id, (1 - (c.embedding <=> ${vec}::vector))::float8 AS similarity
              FROM listings l JOIN vault_items v ON v.id = l.vault_item_id JOIN cards c ON c.id = v.card_id
              WHERE l.id IN ${sql.in(listingIds)}`
      return new Map(rows.map((r) => [r.listingId, r.similarity]))
    })

    const priceHistory = Effect.fn("CatalogRepo.priceHistory")(function* (args: {
      readonly cardId: string
      readonly edition: string
      readonly finish: string
      readonly grader: string
      readonly grade: number
    }) {
      return yield* sql<{ priceMinor: number; soldAt: string }>`
        SELECT price_minor::float8 AS price_minor,
               to_char(sold_at AT TIME ZONE 'utc', 'YYYY-MM-DD') AS sold_at
        FROM sales
        WHERE card_id = ${args.cardId} AND edition = ${args.edition} AND finish = ${args.finish}
          AND grader = ${args.grader} AND grade = ${args.grade}
        ORDER BY sold_at DESC LIMIT 20`
    })

    return CatalogRepo.of({
      insertCatalog,
      insertSales,
      insertListings,
      getListing,
      listActive,
      listedSince,
      hardCandidates,
      marketFacts,
      cardFacts,
      similarities,
      priceHistory
    })
  })
)
