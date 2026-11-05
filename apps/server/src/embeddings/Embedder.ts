import { Context, Effect, Layer, Schema } from "effect"
import { AppConfig, EMBEDDING_DIM } from "../config.ts"

export class EmbedError extends Schema.TaggedError<EmbedError>()("EmbedError", {
  message: Schema.String
}) {}

/** "query" texts are what a collector searches for; "document" texts are what gets searched. */
export type EmbedKind = "query" | "document"

/**
 * Turns text into vectors for pgvector. Two implementations sit behind this
 * one service, and the app picks a layer at startup: a real local model, or a
 * deterministic hash embedder for tests. Swapping in a hosted provider is one
 * more layer, with no change to callers.
 */
export class Embedder extends Context.Service<
  Embedder,
  {
    readonly model: string
    readonly embed: (
      texts: ReadonlyArray<string>,
      kind: EmbedKind
    ) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, EmbedError>
  }
>()("slabwatch/Embedder") {}

/** bge models expect this instruction in front of search queries, not documents. */
const BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

const EMBED_BATCH = 16

/**
 * A small sentence-embedding model (bge-small-en-v1.5, 384 dimensions) run
 * in-process with transformers.js. No API key and no per-call cost. The model
 * files (about 130 MB) download from Hugging Face on first use and are cached.
 */
export const EmbedderLocal = Layer.effect(
  Embedder,
  Effect.gen(function* () {
    const config = yield* AppConfig
    const extractor = yield* Effect.tryPromise({
      try: async () => {
        const { pipeline, env } = await import("@huggingface/transformers")
        env.cacheDir = process.env["TRANSFORMERS_CACHE_DIR"] ?? ".cache/transformers"
        return pipeline("feature-extraction", config.embeddingModel, { dtype: "fp32" })
      },
      catch: (e) => new EmbedError({ message: `could not load ${config.embeddingModel}: ${String(e)}` })
    })
    return Embedder.of({
      model: config.embeddingModel,
      embed: Effect.fn("Embedder.embed")(function* (texts, kind) {
        if (texts.length === 0) return []
        const input = kind === "query" ? texts.map((t) => BGE_QUERY_PREFIX + t) : [...texts]
        // Small batches keep memory flat: one batch of 200 texts was enough to
        // get the seed step killed on a small container.
        const vectors: Array<Array<number>> = []
        for (let i = 0; i < input.length; i += EMBED_BATCH) {
          const output = yield* Effect.tryPromise({
            try: () => extractor(input.slice(i, i + EMBED_BATCH), { pooling: "cls", normalize: true }),
            catch: (e) => new EmbedError({ message: String(e) })
          })
          vectors.push(...(output.tolist() as Array<Array<number>>))
          output.dispose()
        }
        return vectors
      })
    })
  })
)

const fnv1a = (s: string): number => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic bag-of-words hashing: each word adds +1 or -1 to two
 * dimensions picked by its hash, then the vector is normalized. Texts that
 * share words end up close. It has no notion of meaning, so it is for tests
 * and offline runs only.
 */
export const hashEmbed = (text: string): ReadonlyArray<number> => {
  const v = new Array<number>(EMBEDDING_DIM).fill(0)
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  for (const w of words) {
    const h = fnv1a(w)
    const sign = h & 1 ? 1 : -1
    const i = h % EMBEDDING_DIM
    const j = (h >>> 9) % EMBEDDING_DIM
    v[i] = (v[i] ?? 0) + sign
    v[j] = (v[j] ?? 0) + sign * 0.5
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
  return v.map((x) => x / norm)
}

export const EmbedderHash = Layer.succeed(
  Embedder,
  Embedder.of({
    model: "hash-bow-384",
    embed: (texts) => Effect.succeed(texts.map(hashEmbed))
  })
)

/** Picks the embedder from config: EMBEDDER=local (default) or EMBEDDER=hash. */
export const EmbedderLive = Layer.unwrap(
  AppConfig.useSync((c) => (c.embedder === "hash" ? EmbedderHash : EmbedderLocal))
)
