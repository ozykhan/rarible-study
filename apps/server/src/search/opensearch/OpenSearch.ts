import { Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { AppConfig, EMBEDDING_DIM } from "../../config.ts"
import { MARKET_OFFSET_MAX, MARKET_PAGE_MAX } from "../../web/market.ts"
import { SearchEngineError } from "../SearchService.ts"

/**
 * A small client for one OpenSearch node, over its REST API. The engine keeps
 * a copy of what market search reads, shaped for search: one document per
 * active listing, per card and per catalog word. Postgres stays the source of
 * truth (see SearchSync.ts for how the copy is made and kept current).
 *
 * Each kind of document lives in an index reached through an alias, so a full
 * copy can be built in a new index and switched to in one step while
 * searches keep reading the old one.
 */

/** The aliases searches read. Each schema gets its own, so tests and the large bench catalog never share an index. */
export interface IndexNames {
  readonly listings: string
  readonly cards: string
  readonly words: string
}

export const indexNames = (schema: string): IndexNames => {
  const prefix = `slabwatch-${schema.toLowerCase()}`
  return { listings: `${prefix}-listings`, cards: `${prefix}-cards`, words: `${prefix}-words` }
}

/** Paging stops at MARKET_OFFSET_MAX, and a page can start there. */
export const RESULT_WINDOW = MARKET_OFFSET_MAX + MARKET_PAGE_MAX

/** One node, so one shard and no replicas: a copy on a second node would add read capacity, not answers. */
const SETTINGS = { number_of_shards: 1, number_of_replicas: 0 } as const

/**
 * An active listing with what a search can ask of it: listing_search, as a
 * document. `terms` is its card's words and "#tag"s, the same lexemes as the
 * tsvector there, so a word is a prefix query on one keyword field.
 */
export const LISTINGS_INDEX = {
  settings: { index: { ...SETTINGS, max_result_window: RESULT_WINDOW } },
  mappings: {
    dynamic: "strict",
    properties: {
      card_id: { type: "keyword" },
      set_id: { type: "keyword" },
      card_number: { type: "keyword" },
      edition: { type: "keyword" },
      finish: { type: "keyword" },
      grader: { type: "keyword" },
      // Grades are whole and half points, which a float holds exactly. A scaled_float (tenths as integers)
      // sorted the wrong page in OpenSearch 3.9 when it was the first sort key: "highest grade first" showed
      // older grade 10 listings before newer ones.
      grade: { type: "float" },
      cert_number: { type: "keyword" },
      seller_id: { type: "keyword" },
      usd_cents: { type: "long" },
      // Postgres keeps microseconds, and a millisecond would tie listings it tells apart.
      listed_at: { type: "date_nanos" },
      listing_id: { type: "keyword" },
      terms: { type: "keyword" }
    }
  }
} as const

/**
 * A card with what Best match ranks by: its words, set and number for the
 * filters a search puts on the card itself, and its search vector. Ranking
 * scores each matching card exactly (a script, like pgvector without an
 * index), so no approximate graph is built: `knn` stays off.
 */
export const CARDS_INDEX = {
  settings: { index: { ...SETTINGS, knn: false } },
  mappings: {
    dynamic: "strict",
    properties: {
      card_id: { type: "keyword" },
      set_id: { type: "keyword" },
      number: { type: "keyword" },
      terms: { type: "keyword" },
      search_vector: { type: "knn_vector", dimension: EMBEDDING_DIM }
    }
  }
} as const

/**
 * A catalog word (search_vocab), with its trigrams as pg_trgm makes them, so
 * "did you mean" ranks words by the same similarity in both engines.
 */
export const WORDS_INDEX = {
  settings: { index: SETTINGS },
  mappings: {
    dynamic: "strict",
    properties: {
      term: { type: "keyword" },
      trigrams: { type: "keyword" },
      trigram_count: { type: "integer" }
    }
  }
} as const

/**
 * A word's trigrams as pg_trgm counts them: the word padded with two spaces in
 * front and one behind, every run of three characters, each once. Catalog
 * words are lowercase letters and digits, which pg_trgm keeps as they are.
 */
export const trigrams = (word: string): ReadonlyArray<string> => {
  const chars = Array.from(`  ${word} `)
  const out = new Set<string>()
  for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(""))
  return [...out]
}

export interface Hit {
  readonly _id: string
  readonly _score: number | null
  readonly sort?: ReadonlyArray<unknown>
  readonly fields?: Readonly<Record<string, ReadonlyArray<unknown>>>
}

export interface SearchResponse {
  readonly hits: { readonly hits: ReadonlyArray<Hit> }
  readonly aggregations?: Readonly<Record<string, any>>
}

/** One write in a bulk request: a whole document, or a delete. */
export type BulkOp =
  | { readonly index: string; readonly id: string; readonly doc: Readonly<Record<string, unknown>> }
  | { readonly index: string; readonly id: string; readonly delete: true }

type Method = "GET" | "PUT" | "POST" | "DELETE"

export class OpenSearch extends Context.Service<
  OpenSearch,
  {
    readonly indexes: IndexNames
    /** Any request; a 404 is null when `missingOk`, every other non-2xx status fails. */
    readonly call: (
      method: Method,
      path: string,
      body?: unknown,
      options?: { readonly missingOk?: boolean }
    ) => Effect.Effect<any, SearchEngineError>
    readonly search: (index: string, body: unknown) => Effect.Effect<SearchResponse, SearchEngineError>
    /** Several searches in one round trip, answered in order. One failing fails all. */
    readonly msearch: (
      searches: ReadonlyArray<{ readonly index: string; readonly body: unknown }>
    ) => Effect.Effect<ReadonlyArray<SearchResponse>, SearchEngineError>
    /** Writes and deletes in one request. Deleting what is not there is fine; any other failed item fails the call. */
    readonly bulk: (ops: ReadonlyArray<BulkOp>) => Effect.Effect<void, SearchEngineError>
  }
>()("slabwatch/OpenSearch") {}

const fail = (message: string) => new SearchEngineError({ message })

export const OpenSearchLive = Layer.effect(
  OpenSearch,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const client = yield* HttpClient.HttpClient
    const base = config.opensearchUrl.replace(/\/+$/, "")

    const send = (method: Method, path: string, body: string | undefined, contentType: string, missingOk: boolean) =>
      Effect.gen(function* () {
        let request = HttpClientRequest.make(method)(`${base}${path}`)
        if (body !== undefined) request = HttpClientRequest.bodyText(request, body, contentType)
        const response = yield* client.execute(request)
        const text = yield* response.text
        if (missingOk && response.status === 404) return null
        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(fail(`OpenSearch ${method} ${path} answered ${response.status}: ${text.slice(0, 500)}`))
        }
        return text.length === 0 ? null : JSON.parse(text)
      }).pipe(
        Effect.catchTag("HttpClientError", (e) => Effect.fail(fail(`OpenSearch ${method} ${path} failed: ${e.message}`)))
      )

    const call = (method: Method, path: string, body?: unknown, options?: { readonly missingOk?: boolean }) =>
      send(method, path, body === undefined ? undefined : JSON.stringify(body), "application/json", options?.missingOk === true)

    const search = (index: string, body: unknown) =>
      call("POST", `/${index}/_search`, body).pipe(Effect.withSpan("OpenSearch.search", { attributes: { index } }))

    const msearch = (searches: ReadonlyArray<{ readonly index: string; readonly body: unknown }>) =>
      Effect.gen(function* () {
        if (searches.length === 0) return []
        const lines = searches.flatMap((s) => [JSON.stringify({ index: s.index }), JSON.stringify(s.body)])
        const out = yield* send("POST", "/_msearch", `${lines.join("\n")}\n`, "application/x-ndjson", false)
        const responses = out.responses as ReadonlyArray<SearchResponse & { readonly error?: unknown }>
        const failed = responses.find((r) => r.error !== undefined)
        if (failed !== undefined) return yield* Effect.fail(fail(`OpenSearch msearch failed: ${JSON.stringify(failed.error).slice(0, 500)}`))
        return responses
      }).pipe(Effect.withSpan("OpenSearch.msearch", { attributes: { searches: searches.length } }))

    const bulk = (ops: ReadonlyArray<BulkOp>) =>
      Effect.gen(function* () {
        if (ops.length === 0) return
        const lines = ops.flatMap((op) =>
          "delete" in op
            ? [JSON.stringify({ delete: { _index: op.index, _id: op.id } })]
            : [JSON.stringify({ index: { _index: op.index, _id: op.id } }), JSON.stringify(op.doc)]
        )
        const out = yield* send("POST", "/_bulk", `${lines.join("\n")}\n`, "application/x-ndjson", false)
        if (out.errors !== true) return
        const failed = (out.items as ReadonlyArray<Record<string, { readonly status: number; readonly error?: unknown }>>)
          .map((item) => {
            const [action, result] = Object.entries(item)[0]!
            return { action, ...result }
          })
          .find((r) => r.error !== undefined && !(r.action === "delete" && r.status === 404))
        if (failed !== undefined) return yield* Effect.fail(fail(`OpenSearch bulk write failed: ${JSON.stringify(failed.error).slice(0, 500)}`))
      }).pipe(Effect.withSpan("OpenSearch.bulk", { attributes: { ops: ops.length } }))

    return OpenSearch.of({ indexes: indexNames(config.dbSchema), call, search, msearch, bulk })
  })
).pipe(Layer.provide(FetchHttpClient.layer))
