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

/** The first four sets, in the catalog since the first commit. */
const launchSets: ReadonlyArray<SetSpec> = [
  { id: "OS", code: "OS", name: "Origin Set", releaseYear: 2001 },
  { id: "TW", code: "TW", name: "Tidewild", releaseYear: 2002 },
  { id: "EF", code: "EF", name: "Emberfall", releaseYear: 2003 },
  { id: "SE", code: "SE", name: "Starward Expedition", releaseYear: 2004 }
]

const launchCards: ReadonlyArray<CardSpec> = [
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

/** Four more sets, added on 2026-11-08. */
const secondSets: ReadonlyArray<SetSpec> = [
  { id: "FV", code: "FV", name: "Frostveil", releaseYear: 2005 },
  { id: "HR", code: "HR", name: "Hollowroot", releaseYear: 2006 },
  { id: "SK", code: "SK", name: "Skyreach Isles", releaseYear: 2007 },
  { id: "DS", code: "DS", name: "Dunesong", releaseYear: 2008 }
]

const secondCards: ReadonlyArray<CardSpec> = [
  card("FV", 1, "Glacier Wyrm", "ultra_rare", ["dragon"], 320, "A blue-white wyrm that sleeps folded inside a glacier."),
  card("FV", 2, "Rimefang Wolf", "rare", ["beast"], 110, "A pale wolf whose breath leaves rime on everything it passes."),
  card("FV", 3, "Snowdrift Hare", "common", ["beast"], 30, "A hare that disappears into the snow by holding perfectly still."),
  card("FV", 4, "Aurora Swan", "ultra_rare", ["bird"], 210, "A swan whose wake paints the night sky green and violet."),
  card("FV", 5, "Icicle Sprite", "common", ["spirit"], 25, "A tiny ice spirit that rings like glass when the wind blows."),
  card("FV", 6, "Permafrost Golem", "uncommon", ["golem"], 55, "A golem of packed ice with an old pine frozen in its chest."),
  card("FV", 7, "Frostbloom", "common", ["plant"], 30, "A white flower that blooms only on the coldest night of the year."),
  card("FV", 8, "Tuskbell Walrus", "uncommon", ["water", "beast"], 65, "A walrus whose tusks chime when it calls to the herd."),
  card("FV", 9, "Hailwing Finch", "common", ["bird"], 25, "A finch that sheds tiny hailstones when it shakes its feathers."),
  card("FV", 10, "Shiverhorn Mammoth", "rare", ["beast"], 140, "A woolly giant with a crown of icicles hanging from its tusks."),

  card("HR", 1, "Mycelium Drake", "ultra_rare", ["dragon", "plant"], 300, "A drake with shelf mushrooms along its spine that glow a faint blue."),
  card("HR", 2, "Glowcap Beetle", "common", ["insect"], 25, "A beetle that carries a glowing mushroom on its back like a lantern."),
  card("HR", 3, "Rootdelver Badger", "uncommon", ["beast"], 50, "A badger that digs its tunnels along the roots of the oldest trees."),
  card("HR", 4, "Duskwing Bat", "common", ["beast"], 30, "A bat that maps the caverns by humming a single low note."),
  card("HR", 5, "Grotto Axolotl", "uncommon", ["water"], 70, "An axolotl with frilled, glowing gills from an underground lake."),
  card("HR", 6, "Geode Golem", "uncommon", ["golem"], 60, "A golem that cracks open to show purple crystals inside."),
  card("HR", 7, "Blindglow Salamander", "common", ["reptile"], 35, "A pale salamander that glows in slow pulses to find its way in the dark."),
  card("HR", 8, "Taproot Basilisk", "rare", ["reptile", "plant"], 120, "A serpent of twisted roots whose stare turns loose soil to stone."),
  card("HR", 9, "Stalk Mantis", "rare", ["insect"], 85, "A mantis with legs like mushroom stalks that waits without moving."),
  card("HR", 10, "Hollowheart Shroom", "ultra_rare", ["plant", "spirit"], 230, "A giant old mushroom that hums lullabies to the caverns."),

  card("SK", 1, "Cumulus Whale", "ultra_rare", ["water", "spirit"], 280, "A whale that swims through the cloud sea and brings rain when it sings."),
  card("SK", 2, "Thunderhead Griffin", "ultra_rare", ["beast", "bird"], 260, "A griffin that rides the leading edge of every thunderstorm."),
  card("SK", 3, "Nimbus Drake", "rare", ["dragon"], 170, "A grey drake that hides inside rain clouds until lightning strikes."),
  card("SK", 4, "Halo Falcon", "rare", ["bird"], 95, "A falcon that flashes a ring of light around itself when it dives."),
  card("SK", 5, "Bellows Golem", "uncommon", ["golem"], 55, "A brass golem that breathes the wind that keeps the isles afloat."),
  card("SK", 6, "Static Skimmer", "uncommon", ["insect"], 45, "A four-winged insect that crackles with static just before rain."),
  card("SK", 7, "Skysail Lizard", "uncommon", ["reptile"], 50, "A lizard that glides from isle to isle on wide, sail-like fins."),
  card("SK", 8, "Cirrus Wisp", "common", ["spirit"], 30, "A thin curl of cloud with a lantern glow at its center."),
  card("SK", 9, "Puffseed Drifter", "common", ["plant"], 25, "A dandelion creature that travels between islands on the breeze."),
  card("SK", 10, "Cliffhorn Goat", "common", ["beast"], 35, "A goat that leaps between floating islands without looking down."),

  card("DS", 1, "Sirocco Wyrm", "ultra_rare", ["dragon"], 330, "A sand-colored wyrm that swims under the dunes and surfaces at noon."),
  card("DS", 2, "Mirage Fennec", "rare", ["beast"], 95, "A fennec fox that leaves three false copies of itself in the heat haze."),
  card("DS", 3, "Glasswing Scarab", "uncommon", ["insect"], 50, "A scarab with wings of fused desert glass that chime as it flies."),
  card("DS", 4, "Dunehorn Oryx", "common", ["beast"], 35, "An oryx with long straight horns that can smell water a day away."),
  card("DS", 5, "Sandstone Colossus", "rare", ["golem"], 130, "A colossus carved into a cliff that wakes once every hundred years."),
  card("DS", 6, "Scorch Viper", "uncommon", ["reptile"], 60, "A copper viper that hides under hot sand with only its eyes showing."),
  card("DS", 7, "Pricklepod", "common", ["plant"], 25, "A round little cactus creature that waddles toward any patch of shade."),
  card("DS", 8, "Duststorm Shade", "common", ["spirit"], 30, "A shadow that travels inside small dust storms and hums as it passes."),
  card("DS", 9, "Oasis Koi", "uncommon", ["water"], 55, "A golden koi that lives only in pools that appear after rain."),
  card("DS", 10, "Sunspire Roc", "ultra_rare", ["bird"], 240, "A giant roc that nests on the tallest ruin and shades the whole city.")
]

/**
 * Sets released together. Each drop seeds its own listings and price history
 * from its own random stream (generate.ts), so adding a drop never changes
 * what an earlier drop seeded, on a fresh database or a live one.
 */
export interface Drop {
  readonly id: string
  readonly sets: ReadonlyArray<SetSpec>
  readonly cards: ReadonlyArray<CardSpec>
}

export const drops: ReadonlyArray<Drop> = [
  { id: "launch", sets: launchSets, cards: launchCards },
  { id: "second", sets: secondSets, cards: secondCards }
]

export const sets: ReadonlyArray<SetSpec> = drops.flatMap((d) => d.sets)

export const cards: ReadonlyArray<CardSpec> = drops.flatMap((d) => d.cards)

/**
 * A catalog: its sets and cards, with lookups by id. The hand-written one
 * below is the default everywhere; the large generated one (large.ts) is for
 * testing search and storage at a realistic size.
 */
export interface Catalog {
  readonly sets: ReadonlyArray<SetSpec>
  readonly cards: ReadonlyArray<CardSpec>
  readonly setById: (id: string) => SetSpec
  readonly cardById: (id: string) => CardSpec
}

export const makeCatalog = (setList: ReadonlyArray<SetSpec>, cardList: ReadonlyArray<CardSpec>): Catalog => {
  const setMap = new Map(setList.map((s) => [s.id, s]))
  const cardMap = new Map(cardList.map((c) => [c.id, c]))
  return {
    sets: setList,
    cards: cardList,
    setById: (id) => {
      const s = setMap.get(id)
      if (!s) throw new Error(`Unknown set ${id}`)
      return s
    },
    cardById: (id) => {
      const c = cardMap.get(id)
      if (!c) throw new Error(`Unknown card ${id}`)
      return c
    }
  }
}

/** Every hand-written card, from every drop. */
export const handWritten: Catalog = makeCatalog(sets, cards)

export const setById = (id: string): SetSpec => handWritten.setById(id)

export const cardById = (id: string): CardSpec => handWritten.cardById(id)

/** Trusted text about a card, written by us. This is what catalog embeddings are built from. */
export const catalogText = (c: CardSpec, catalog: Catalog = handWritten): string => {
  const set = catalog.setById(c.setId)
  return `${set.name} #${c.number} ${c.name}. ${c.kinds.join(" and ")} type card. ${c.lore} Rarity: ${c.rarity.replace("_", " ")}.`
}
