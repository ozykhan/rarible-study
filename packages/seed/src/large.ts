import type { CardSpec, Catalog, CreatureKind, SetSpec } from "./catalog.ts"
import { handWritten, makeCatalog } from "./catalog.ts"
import { generateListing, makeGeneratorState, type LabelledListing, type SellerRow, sellers } from "./generate.ts"
import { makeRng, type Rng } from "./rng.ts"

/**
 * A large fictional catalog and market, for testing search and storage at a
 * realistic size. Everything is invented and deterministic: the same options
 * give the same sets, cards, sellers and listings on every machine.
 *
 * The four hand-written sets come first and keep their ids, so every link,
 * test and eval that names them still works.
 */

const nouns: Record<CreatureKind, ReadonlyArray<string>> = {
  dragon: ["Drake", "Wyrm", "Wyvern", "Dragon", "Drakeling", "Hydra"],
  water: ["Eel", "Crab", "Otter", "Ray", "Kraken", "Seahorse", "Narwhal", "Octopus", "Shark", "Turtle", "Jellyfish", "Leviathan"],
  beast: ["Lion", "Fox", "Wolf", "Ram", "Hare", "Stag", "Bear", "Lynx", "Boar", "Badger"],
  bird: ["Owl", "Heron", "Falcon", "Raven", "Hawk", "Swan", "Crane", "Finch", "Phoenix"],
  spirit: ["Wisp", "Sprite", "Shade", "Specter", "Phantom", "Wraith"],
  golem: ["Golem", "Sentinel", "Colossus", "Construct", "Guardian"],
  insect: ["Moth", "Beetle", "Mantis", "Firefly", "Wasp", "Cricket"],
  plant: ["Bloom", "Thornling", "Sapling", "Vineling", "Sprout", "Mosscap"],
  reptile: ["Salamander", "Gecko", "Basilisk", "Iguana", "Viper", "Tortoise"]
}

const kinds = Object.keys(nouns) as ReadonlyArray<CreatureKind>

/** The first half of a name, and the second kind it can add. */
const prefixes: ReadonlyArray<readonly [string, CreatureKind | null]> = [
  ["Ember", null], ["Frost", null], ["Storm", null], ["Moss", "plant"], ["Tide", "water"], ["Ash", null],
  ["Star", null], ["Gloom", "spirit"], ["Sun", null], ["Iron", "golem"], ["Coral", "water"], ["Thunder", null],
  ["Shadow", "spirit"], ["Dawn", null], ["Dusk", null], ["Crystal", null], ["Cinder", null], ["Mist", null],
  ["Stone", "golem"], ["Glimmer", null], ["Night", null], ["Bramble", "plant"], ["Ruby", null], ["Silver", null],
  ["Copper", null], ["Hollow", null], ["Void", "spirit"], ["Lunar", null], ["Solar", null], ["Rune", null]
]

const suffixes = ["fang", "wing", "shell", "claw", "mane", "tail", "scale", "horn", "crest", "heart",
  "spark", "root", "song", "veil", "eye", "back", "born", "light", "bloom", "field"]

const habits: Record<CreatureKind, ReadonlyArray<string>> = {
  dragon: ["guards a hoard of old coins", "sleeps for a century at a time", "breathes a slow, rolling fire", "circles the peaks at dawn"],
  water: ["hunts along the reef at night", "drifts with the warm currents", "hides in sunken ships", "sings to passing boats"],
  beast: ["roams the high meadows", "leads its pack through the snow", "dens under ancient roots", "runs faster than the wind"],
  bird: ["nests on cliff ledges", "calls the rain with its cry", "migrates across three seas", "watches the valley from above"],
  spirit: ["appears only in moonlight", "remembers every traveler it meets", "hums at the edge of hearing", "flickers like a candle in fog"],
  golem: ["was carved to guard a gate", "wakes when the ground shakes", "carries moss on its shoulders", "never forgets an order"],
  insect: ["glows in the summer dusk", "builds towers of mud and leaf", "swarms before a storm", "hums through the orchard"],
  plant: ["opens only at midnight", "creeps across old walls", "drinks the morning dew", "turns its petals to the stars"],
  reptile: ["basks on hot black rock", "sheds a skin of glass", "waits motionless for hours", "hides in desert ruins"]
}

const places = ["in the northern marshes", "beyond the glass desert", "under the broken bridge", "near the old lighthouse",
  "in the cedar forest", "along the frozen coast", "inside the sunken city", "on the floating isles"]

const setWords: ReadonlyArray<string> = ["Crimson", "Silent", "Shattered", "Hidden", "Burning", "Frozen", "Endless", "Gilded",
  "Forgotten", "Wild", "Restless", "Radiant", "Sunken", "Broken", "Ancient", "Distant", "Verdant", "Twilight",
  "Golden", "Whispering", "Rising", "Pale", "Scarlet", "Quiet", "Wandering"]
const setNouns: ReadonlyArray<string> = ["Tides", "Skies", "Crowns", "Depths", "Frontier", "Wilds", "Realms", "Reaches",
  "Echoes", "Embers", "Isles", "Peaks", "Hollows", "Vaults", "Paths", "Shores", "Kingdoms", "Horizons", "Legends", "Ruins"]

const rarities: ReadonlyArray<readonly [CardSpec["rarity"], number]> = [
  ["common", 50], ["uncommon", 30], ["rare", 15], ["ultra_rare", 5]
]
const valueRange: Record<CardSpec["rarity"], readonly [number, number]> = {
  common: [15, 45], uncommon: [40, 90], rare: [70, 180], ultra_rare: [180, 450]
}

const shuffle = <A>(rng: Rng, items: ReadonlyArray<A>): Array<A> => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    const a = out[i] as A
    out[i] = out[j] as A
    out[j] = a
  }
  return out
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? "An" : "A")

export interface LargeCatalogOptions {
  readonly seed?: number
  /** Generated sets, on top of the four hand-written ones. */
  readonly sets?: number
  readonly cardsPerSet?: number
}

/** The hand-written catalog plus generated sets of generated cards, about 20,000 cards by default. */
export const generateLargeCatalog = (options: LargeCatalogOptions = {}): Catalog => {
  const rng = makeRng(options.seed ?? 20261106)
  const setCount = options.sets ?? 200
  const perSet = options.cardsPerSet ?? 100
  const names = shuffle(rng, setWords.flatMap((w) => setNouns.map((n) => `${w} ${n}`)))
  if (setCount > names.length) throw new Error(`at most ${names.length} generated sets`)
  const newSets: Array<SetSpec> = []
  const newCards: Array<CardSpec> = []
  for (let i = 0; i < setCount; i++) {
    const id = `X${String(i + 1).padStart(3, "0")}`
    newSets.push({ id, code: id, name: names[i] ?? id, releaseYear: 2005 + (i % 21) })
    for (let n = 1; n <= perSet; n++) {
      const kind = rng.pick(kinds)
      const noun = rng.pick(nouns[kind])
      const [prefix, extra] = rng.pick(prefixes)
      const name = `${prefix}${rng.pick(suffixes)} ${noun}`
      const cardKinds: ReadonlyArray<CreatureKind> = extra !== null && extra !== kind ? [kind, extra] : [kind]
      const rarity = rng.weighted(rarities)
      const [lo, hi] = valueRange[rarity]
      newCards.push({
        id: `${id}-${String(n).padStart(3, "0")}`,
        setId: id,
        number: String(n).padStart(3, "0"),
        name,
        rarity,
        kinds: cardKinds,
        lore: `${article(noun)} ${noun.toLowerCase()} that ${rng.pick(habits[kind])} ${rng.pick(places)}.`,
        baseValueUsd: rng.int(lo, hi)
      })
    }
  }
  return makeCatalog([...handWritten.sets, ...newSets], [...handWritten.cards, ...newCards])
}

const handleWords = ["amber", "atlas", "binder", "cedar", "comet", "copper", "delta", "ember", "fable", "harbor",
  "hollow", "indigo", "juniper", "lantern", "maple", "meadow", "nova", "orbit", "pebble", "quarry", "raven",
  "saffron", "slate", "summit", "tidal", "velvet", "willow", "zephyr"]
const handleNouns = ["cards", "slabs", "vault", "finds", "pulls", "collects", "trading", "shop", "binder", "box"]

/** More sellers for the bulk market: the 12 seed sellers plus generated ones with unique handles. */
export const generateSellers = (count = 2000, seed = 20261107): ReadonlyArray<SellerRow> => {
  const rng = makeRng(seed)
  const out: Array<SellerRow> = [...sellers]
  const used = new Set(out.map((s) => s.handle))
  for (let i = 1; out.length < sellers.length + count; i++) {
    const handle = `${rng.pick(handleWords)}_${rng.pick(handleNouns)}_${rng.int(1, 999)}`
    if (used.has(handle)) continue
    used.add(handle)
    out.push({ id: `SX${String(i).padStart(5, "0")}`, handle })
  }
  return out
}

export interface BulkMarketOptions {
  readonly seed?: number
  readonly count: number
  /** First vault item and listing number. Bulk ids have their own prefixes (VLB-, B-), so they never meet the seed's. */
  readonly startAt?: number
  readonly chunk?: number
  readonly catalog: Catalog
  readonly sellers: ReadonlyArray<SellerRow>
}

/**
 * Active listings spread over the last 90 days, in chunks so a million of
 * them never sit in memory at once. Same trap odds as the seed.
 */
export function* generateBulkListings(options: BulkMarketOptions): Generator<ReadonlyArray<LabelledListing>> {
  const s = makeGeneratorState(options.seed ?? 20261108, options.startAt ?? 1, "VLB")
  const chunk = options.chunk ?? 5000
  const pool = { catalog: options.catalog, sellers: options.sellers }
  for (let done = 0; done < options.count; done += chunk) {
    const size = Math.min(chunk, options.count - done)
    const rows: Array<LabelledListing> = []
    for (let i = 0; i < size; i++) {
      rows.push(generateListing(s, { prefix: "B", source: "bulk", listedMinutesAgo: s.rng.int(60, 60 * 24 * 90) }, pool))
    }
    yield rows
  }
}
