/**
 * The tags a model may give a card, written by hand and versioned. A tag is
 * how a shopper describes a card ("sea creature", "flying", "glowing") rather
 * than how the catalog names it, so a described search becomes an exact
 * filter instead of a judgment made on every search.
 *
 * Each tag carries two kinds of text:
 *   - `means` tells the tagging model when the tag applies (index time).
 *   - `words` are what a shopper types for it (query time). The search parser
 *     reads them as fixed-meaning words, like "holo" or "1st".
 *
 * Changing which tags exist or what one means changes the tags cards should
 * have, so bump TAG_VOCAB_VERSION: every card is then tagged again. Adding
 * words a shopper might type needs no new version, since words only matter
 * when a search is read.
 */

export const TAG_VOCAB_VERSION = 1

export type TagGroup = "creature" | "habitat" | "element" | "trait"

export interface TagSpec {
  /** Lowercase letters and underscores. Stored on cards and in the search index as "#id". */
  readonly id: string
  readonly group: TagGroup
  /** How a search shows it: "sea creatures". */
  readonly label: string
  /** For the tagging model: when the tag applies. */
  readonly means: string
  /** What a shopper types for it, one or more words each. A trailing "s" or "es" is accepted too. */
  readonly words: ReadonlyArray<string>
}

const tag = (id: string, group: TagGroup, label: string, means: string, words: ReadonlyArray<string>): TagSpec => ({
  id,
  group,
  label,
  means,
  words
})

export const TAGS: ReadonlyArray<TagSpec> = [
  // What it is.
  tag("animal", "creature", "animals",
    "a real kind of animal or a fantastic version of one: mammals, birds, fish, reptiles, amphibians, insects, crabs, octopuses. Not dragons, spirits, golems or plants",
    ["animal", "critter"]),
  tag("mammal", "creature", "mammals", "a mammal: cats, dogs, wolves, foxes, deer, bears, hares, otters, whales, horses", ["mammal", "furry"]),
  tag("bird", "creature", "birds", "a bird, including birds of legend such as the phoenix", ["bird", "avian", "feathered"]),
  tag("fish", "creature", "fish", "a fish, eel or ray", ["fish"]),
  tag("sea_creature", "creature", "sea creatures",
    "lives in the sea or ocean: fish, crabs, eels, rays, whales, octopuses, jellyfish, sea turtles, sea serpents",
    ["sea creature", "sea animal", "sea life", "sea monster", "sea", "marine", "ocean", "oceanic", "aquatic", "underwater"]),
  tag("reptile", "creature", "reptiles and amphibians", "a reptile or amphibian: lizards, snakes, turtles, tortoises, salamanders, geckos",
    ["reptile", "reptilian", "amphibian", "lizard"]),
  tag("insect", "creature", "insects", "an insect or other bug: moths, beetles, mantises, fireflies, wasps, crickets", ["insect", "bug"]),
  tag("cat", "creature", "cats", "a cat or big cat: kittens, lions, lynxes, fire cats", ["cat", "big cat", "feline", "kitty"]),
  tag("dog", "creature", "dogs and wolves", "a dog or its kin: wolves, foxes, hounds", ["dog", "canine", "puppy"]),
  tag("horse", "creature", "horses", "a horse or its kin: ponies, foals, unicorns, kelpies", ["horse", "pony", "equine", "steed"]),
  tag("dragon", "creature", "dragons", "a dragon or its kin: drakes, wyrms, wyverns, hydras, drakelings", ["dragon", "draconic"]),
  tag("serpent", "creature", "serpents", "a long, legless creature: snakes, sea serpents, eels, wyrms", ["serpent", "snake", "snakelike"]),
  tag("spirit", "creature", "spirits", "a ghost or other bodiless being: wisps, sprites, shades, wraiths, phantoms", ["ghost", "ghostly", "spectral", "spirit"]),
  tag("golem", "creature", "golems", "a built or animated being of stone, metal or other matter: golems, constructs, sentinels", ["golem", "construct", "robot", "statue"]),
  tag("plant", "creature", "plants", "a plant or plant creature: flowers, trees, moss, vines, saplings, fungi", ["plant", "flower", "flora", "tree"]),
  tag("mythical", "creature", "mythical creatures",
    "a creature from legend: phoenixes, unicorns, krakens, kelpies, basilisks, hydras, leviathans, dragons",
    ["mythical", "mythic", "mythological", "fabled"]),
  tag("baby", "creature", "babies", "a young or baby creature: kittens, foals, hatchlings, drakelings, wyrmlings, saplings", ["baby", "young", "juvenile", "hatchling"]),

  // Where it lives.
  tag("coast", "habitat", "coastal", "lives on beaches, shores, reefs or in tide pools", ["coast", "coastal", "beach", "seaside"]),
  tag("freshwater", "habitat", "freshwater", "lives in rivers, lakes, ponds, marshes or swamps", ["freshwater", "river", "lake", "pond", "swamp", "marsh"]),
  tag("forest", "habitat", "forest", "lives in forests, woods or jungles", ["forest", "woods", "woodland", "jungle"]),
  tag("mountain", "habitat", "mountain", "lives on mountains, peaks or cliffs", ["mountain", "alpine", "highland"]),
  tag("desert", "habitat", "desert", "lives in deserts or dunes", ["desert", "sand", "dune"]),
  tag("arctic", "habitat", "snow and ice", "lives in snow, ice, glaciers or the frozen north", ["arctic", "snow", "snowy", "polar", "tundra", "winter"]),
  tag("volcanic", "habitat", "volcanic", "lives in or near volcanoes, lava or magma", ["volcano", "volcanic", "lava", "magma"]),
  tag("sky", "habitat", "sky", "lives high in the sky or among the clouds", ["sky", "cloud", "airborne"]),
  tag("space", "habitat", "space", "belongs to outer space: stars, the moon, comets, nebulas, the cosmos", ["space", "outer space", "cosmic", "celestial", "astral", "galaxy"]),
  tag("underground", "habitat", "underground", "lives in caves, tunnels, mines or deep under the earth", ["underground", "cave", "cavern", "subterranean"]),

  // Its element.
  tag("fire", "element", "fire", "fire, flame, embers, sparks or heat", ["fire", "fiery", "flame", "flaming", "blaze"]),
  tag("water", "element", "water", "water, waves, rain or tides", ["water", "watery", "wave"]),
  tag("ice", "element", "ice", "ice, frost or cold", ["ice", "icy", "frosty", "cold", "freezing"]),
  tag("earth", "element", "earth and stone", "stone, rock, soil or sand", ["earth", "rock", "rocky", "stony"]),
  tag("air", "element", "air and wind", "wind, gusts or open air", ["air", "wind", "windy", "breeze"]),
  tag("storm", "element", "storms", "storms, thunder or lightning", ["storm", "stormy", "thunder", "lightning", "electric"]),
  tag("nature", "element", "nature", "growing things: leaves, moss, flowers, roots, living wood", ["nature", "grass", "leaf", "leaves"]),
  tag("light", "element", "light", "light, sunlight, dawn or radiance", ["light", "bright", "sunlight", "holy"]),
  tag("shadow", "element", "shadow", "darkness, shadow, gloom or the void", ["shadow", "dark", "darkness", "gloomy"]),
  tag("metal", "element", "metal", "iron, steel, copper, silver or other metal", ["metal", "metallic", "steel"]),
  tag("crystal", "element", "crystal", "crystals, gems, glass or jewels", ["crystal", "gem", "gemstone", "jewel", "glass"]),

  // What it does or looks like.
  tag("flies", "trait", "flying", "can fly: has wings or floats through the air", ["flying", "flies", "fly", "flyer", "winged", "wings"]),
  tag("swims", "trait", "swimming", "swims", ["swimming", "swims", "swim", "swimmer"]),
  tag("glows", "trait", "glowing", "glows, shines or gives off its own light", ["glowing", "glows", "glow", "luminous", "bioluminescent"]),
  tag("breathes_fire", "trait", "fire breathing", "breathes fire", ["fire breathing", "breathes fire", "firebreathing"]),
  tag("armored", "trait", "armored", "has armor, a shell, plates or a hard hide", ["armored", "armoured", "armor", "shelled", "shell"]),
  tag("horned", "trait", "horned", "has horns or antlers", ["horned", "horn", "antler"]),
  tag("poison", "trait", "poisonous", "poisonous or venomous", ["poison", "poisonous", "venom", "venomous", "toxic"]),
  tag("nocturnal", "trait", "nocturnal", "active at night or tied to the moon", ["nocturnal", "night", "nighttime", "moonlight", "moonlit"]),
  tag("giant", "trait", "giant", "huge or giant", ["giant", "huge", "massive", "enormous", "big"]),
  tag("tiny", "trait", "tiny", "small or tiny", ["tiny", "small", "little", "mini"]),
  tag("ancient", "trait", "ancient", "very old, ancient or primeval", ["ancient", "old", "elder", "primeval"]),
  tag("guardian", "trait", "guardians", "guards or protects something", ["guardian", "guard", "protector", "defender"]),
  tag("fast", "trait", "fast", "known for its speed", ["fast", "speedy", "swift", "quick"]),
  tag("sings", "trait", "singing", "sings, hums or calls", ["singing", "sings", "song", "musical", "melodic"]),
  tag("fierce", "trait", "fierce", "fierce, menacing or fearsome", ["fierce", "scary", "menacing", "ferocious", "fearsome"])
]

export const TAG_IDS = TAGS.map((t) => t.id)

const byId = new Map(TAGS.map((t) => [t.id, t]))

export const tagById = (id: string): TagSpec | undefined => byId.get(id)

/** Tags in vocabulary order without repeats, so stored tags compare equal however the model listed them. */
export const normalizeTags = (tags: Iterable<string>): Array<string> => {
  const set = new Set(tags)
  return TAG_IDS.filter((id) => set.has(id))
}
