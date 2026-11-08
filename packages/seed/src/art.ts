import manifest from "./art.json" with { type: "json" }

/** One generated image, as apps/web/scripts/generate_art.py recorded it. */
export interface ArtEntry {
  /** Under apps/web/public/art. */
  readonly file: string
  readonly sha256: string
  readonly model: string
  readonly seed: number
  readonly steps: number
  /** The size the model drew; the saved file is scaled down from it. */
  readonly width: number
  readonly height: number
  readonly prompt: string
}

/** Every generated image by key: a card id, `set-<id>` for a set banner, or `hero`. */
export const artManifest: Readonly<Record<string, ArtEntry>> = manifest

/**
 * Where the web app serves a card's art, or null when the card has none, as
 * with every card of the large generated catalog. The hash in the query names
 * one version of the image, so a CDN can cache it for good. The files live in
 * apps/web/public/art for now; past a few hundred they belong in a storage
 * bucket behind a CDN, and only this path changes.
 */
export const artPath = (cardId: string): string | null => {
  const e = artManifest[cardId]
  return e === undefined ? null : `/art/${e.file}?v=${e.sha256.slice(0, 8)}`
}
