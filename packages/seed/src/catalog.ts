/**
 * A fictional trading card catalog: invented sets, creatures and art. Any
 * resemblance to a real game is accidental.
 */

export interface SetSpec {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly releaseYear: number
}

export type CreatureKind =
  | "dragon"
  | "water"
  | "beast"
  | "bird"
  | "spirit"
  | "golem"
  | "insect"
  | "plant"
  | "reptile"

export interface CardSpec {
  readonly id: string
  readonly setId: string
  readonly number: string
  readonly name: string
  readonly rarity: "common" | "uncommon" | "rare" | "ultra_rare"
  readonly kinds: ReadonlyArray<CreatureKind>
  /** One line of card lore, used for the catalog text and embeddings. */
  readonly lore: string
  /** Market value in USD of an unlimited, non-holo copy graded NVG 9. */
  readonly baseValueUsd: number
}

export const sets: ReadonlyArray<SetSpec> = [
  { id: "OS", code: "OS", name: "Origin Set", releaseYear: 2001 },
  { id: "TW", code: "TW", name: "Tidewild", releaseYear: 2002 },
  { id: "EF", code: "EF", name: "Emberfall", releaseYear: 2003 },
  { id: "SE", code: "SE", name: "Starward Expedition", releaseYear: 2004 }
]

const card = (
  setId: string,
  n: number,
  name: string,
  rarity: CardSpec["rarity"],
  kinds: ReadonlyArray<CreatureKind>,
  baseValueUsd: number,
  lore: string
): CardSpec => {
  const number = String(n).padStart(3, "0")
  return { id: `${setId}-${number}`, setId, number, name, rarity, kinds, lore, baseValueUsd }
}

export const cards: ReadonlyArray<CardSpec> = [
  card("OS", 1, "Cinderwing Drake", "ultra_rare", ["dragon"], 400, "A young drake whose wings shed sparks when it dives."),
  card("OS", 2, "Mossback Tortoise", "uncommon", ["water", "plant"], 60, "A pond tortoise with a garden growing on its shell."),
  card("OS", 3, "Gale Sprite", "common", ["spirit"], 45, "A wind spirit that hides in the eye of small storms."),
  card("OS", 4, "Thornmane Lion", "rare", ["beast"], 80, "A lion with a mane of bramble and a quiet roar."),
  card("OS", 5, "Ironhide Golem", "uncommon", ["golem"], 50, "A slow guardian hammered together from old armor."),
  card("OS", 6, "Duskhollow Owl", "common", ["bird"], 35, "An owl that only hunts in the last minute of sunset."),
  card("OS", 7, "Frostpetal Fox", "rare", ["beast"], 70, "A fox whose tail leaves frost flowers in the snow."),
  card("OS", 8, "Emberkit", "common", ["beast"], 30, "A kitten-sized fire cat that naps on warm stones."),
  card("OS", 9, "Lumen Moth", "common", ["insect"], 25, "A moth that glows brighter the darker the night."),
  card("OS", 10, "Verdant Wyrmling", "rare", ["dragon", "plant"], 150, "A leaf-scaled baby dragon that roots in moss."),

  card("TW", 1, "Glimmerfin", "rare", ["water"], 120, "A luminous reef fish that schools in moonlit lagoons."),
  card("TW", 2, "Reefguard Crab", "common", ["water"], 40, "A crab that guards coral with oversized claws."),
  card("TW", 3, "Abyssal Leviathan", "ultra_rare", ["water"], 300, "A whale-sized sea serpent from the deepest trench."),
  card("TW", 4, "Kelpie Foal", "uncommon", ["water", "beast"], 90, "A young water horse with a mane of kelp."),
  card("TW", 5, "Stormcaller Heron", "uncommon", ["bird"], 60, "A heron that calls thunder over the marsh."),
  card("TW", 6, "Coralbloom", "common", ["plant", "water"], 35, "A flowering coral that opens only at high tide."),
  card("TW", 7, "Tidewyrm", "ultra_rare", ["dragon", "water"], 250, "A sea dragon that rides the crest of rogue waves."),
  card("TW", 8, "Shellback Hermit", "common", ["water"], 30, "A hermit crab that collects lost bottle caps."),
  card("TW", 9, "Driftwood Sprite", "common", ["spirit"], 25, "A spirit living in wood washed up on the shore."),
  card("TW", 10, "Pearl Otter", "uncommon", ["water", "beast"], 55, "An otter that juggles pearls on its belly."),

  card("EF", 1, "Ashen Wyrm", "ultra_rare", ["dragon"], 280, "An ancient wyrm that sleeps under cooled lava."),
  card("EF", 2, "Magma Hound", "uncommon", ["beast"], 70, "A hound with molten paws that leaves glowing tracks."),
  card("EF", 3, "Cinder Salamander", "common", ["reptile"], 60, "A salamander that bathes in campfire embers."),
  card("EF", 4, "Obsidian Golem", "uncommon", ["golem"], 50, "A golem of volcanic glass with a hollow chest."),
  card("EF", 5, "Pyre Phoenix", "ultra_rare", ["bird"], 220, "A phoenix that is reborn from a single spark."),
  card("EF", 6, "Smoke Wisp", "common", ["spirit"], 25, "A curl of smoke that remembers the fire it came from."),
  card("EF", 7, "Basalt Ram", "common", ["beast"], 40, "A ram whose horns are columns of basalt."),
  card("EF", 8, "Flare Drakeling", "rare", ["dragon"], 160, "A drakeling that sneezes small flares when startled."),
  card("EF", 9, "Charcoal Beetle", "common", ["insect"], 20, "A beetle that rolls balls of charcoal."),
  card("EF", 10, "Lava Eel", "uncommon", ["reptile"], 45, "An eel that swims through rivers of lava, not water."),

  card("SE", 1, "Nebula Drake", "ultra_rare", ["dragon"], 350, "A drake with a nebula swirling inside its wings."),
  card("SE", 2, "Comet Hare", "common", ["beast"], 40, "A hare that leaves a short comet tail when it runs."),
  card("SE", 3, "Orbit Owl", "common", ["bird"], 35, "An owl that circles the moon once a night."),
  card("SE", 4, "Void Ray", "rare", ["spirit"], 75, "A manta-shaped spirit that glides through empty space."),
  card("SE", 5, "Starlit Unicorn", "ultra_rare", ["beast"], 200, "A unicorn whose horn points to the north star."),
  card("SE", 6, "Meteor Golem", "uncommon", ["golem"], 55, "A golem assembled from a fallen meteorite."),
  card("SE", 7, "Aurora Moth", "common", ["insect"], 30, "A moth whose wings ripple like the northern lights."),
  card("SE", 8, "Lunar Jellyfish", "uncommon", ["spirit"], 50, "A jellyfish-shaped spirit that drifts between stars."),
  card("SE", 9, "Solar Lion", "rare", ["beast"], 90, "A lion whose mane burns like a corona."),
  card("SE", 10, "Cinderwing Drake", "rare", ["dragon"], 180, "A reprint of the classic drake with new star art.")
]

export const setById = (id: string): SetSpec => {
  const s = sets.find((x) => x.id === id)
  if (!s) throw new Error(`Unknown set ${id}`)
  return s
}

export const cardById = (id: string): CardSpec => {
  const c = cards.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown card ${id}`)
  return c
}

/** Trusted text about a card, written by us. This is what catalog embeddings are built from. */
export const catalogText = (c: CardSpec): string => {
  const set = setById(c.setId)
  return `${set.name} #${c.number} ${c.name}. ${c.kinds.join(" and ")} type card. ${c.lore} Rarity: ${c.rarity.replace("_", " ")}.`
}
