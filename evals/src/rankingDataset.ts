import type { CreatureKind } from "@slabwatch/seed"

/**
 * Described searches for measuring Best match, over the large generated
 * catalog (pnpm db:seed:large). Every generated card's lore is "A <noun> that
 * <habit> <place>", with four habits per kind and eight places, so the
 * generator itself says which cards fit: no model and no hand labels decide
 * what is relevant.
 *
 * Each case is a search as the market runs it: `q` is what code reads (a tag,
 * or a model's reading of the search), `from` is what the shopper typed. The
 * rest of `from` is something no tag can say. The words are paraphrases, not
 * the lore's own words, and they avoid every tag word, so the filter is the
 * kind alone and only the order can find the cards that fit.
 *
 * Readings are written by hand here, as the understanding eval
 * (searchDataset.ts) labels them, so this measures the order and nothing else.
 */
export interface RankingCase {
  readonly from: string
  readonly q: string
  /** The cards that fit: the generator wrote this phrase into their lore... */
  readonly lore: string
  /** ...and, for a place, made this their first kind. A habit belongs to one kind already. */
  readonly kind?: CreatureKind
}

export const rankingCases: ReadonlyArray<RankingCase> = [
  // Habits
  { from: "dragon sitting on a pile of treasure", q: "dragon", lore: "guards a hoard of old coins" },
  { from: "dragon that hibernates for a hundred years", q: "dragon", lore: "sleeps for a century at a time" },
  { from: "dragon soaring over summits at sunrise", q: "dragon", lore: "circles the peaks at dawn" },
  { from: "sea creature living in shipwrecks", q: "sea creature", lore: "hides in sunken ships" },
  { from: "sea creature that serenades sailors", q: "sea creature", lore: "sings to passing boats" },
  { from: "sea creature carried by tropical currents", q: "sea creature", lore: "drifts with the warm currents" },
  { from: "animal wandering upland pastures", q: "animal", lore: "roams the high meadows" },
  { from: "bird nesting on sheer cliffs", q: "bird", lore: "nests on cliff ledges" },
  { from: "bird whose call brings rainfall", q: "bird", lore: "calls the rain with its cry" },
  { from: "bird that travels thousands of miles each year", q: "bird", lore: "migrates across three seas" },
  { from: "bird that surveys the lowlands from on high", q: "bird", lore: "watches the valley from above" },
  { from: "ghost that shows up under a full moon", q: "ghost", lore: "appears only in moonlight" },
  { from: "ghost that never forgets a wanderer's face", q: "ghost", lore: "remembers every traveler it meets" },
  { from: "ghost whose faint humming you can barely hear", q: "ghost", lore: "hums at the edge of hearing" },
  { from: "ghost flickering in the mist", q: "ghost", lore: "flickers like a candle in fog" },
  { from: "golem sculpted to stand watch at an entrance", q: "golem", lore: "was carved to guard a gate" },
  { from: "golem stirred awake by earthquakes", q: "golem", lore: "wakes when the ground shakes" },
  { from: "golem covered in lichen", q: "golem", lore: "carries moss on its shoulders" },
  { from: "golem that obeys every command forever", q: "golem", lore: "never forgets an order" },
  { from: "insect building mud spires", q: "insect", lore: "builds towers of mud and leaf" },
  { from: "insect buzzing around the fruit groves", q: "insect", lore: "hums through the orchard" },
  { from: "flower that blooms only at midnight", q: "flower", lore: "opens only at midnight" },
  { from: "plant that climbs up walls", q: "plant", lore: "creeps across old walls" },
  { from: "plant drinking dewdrops at sunrise", q: "plant", lore: "drinks the morning dew" },
  { from: "flower that follows the constellations", q: "flower", lore: "turns its petals to the stars" },
  { from: "lizard sunbathing on warm boulders", q: "lizard", lore: "basks on hot black rock" },
  { from: "lizard that stays perfectly still for ages", q: "lizard", lore: "waits motionless for hours" },
  { from: "lizard lurking in abandoned temples", q: "lizard", lore: "hides in desert ruins" },
  // Places
  { from: "sea creature that lurks near a lighthouse", q: "sea creature", lore: "near the old lighthouse", kind: "water" },
  { from: "golem from a drowned city", q: "golem", lore: "inside the sunken city", kind: "golem" },
  { from: "bird from the hovering islands", q: "bird", lore: "on the floating isles", kind: "bird" },
  { from: "dragon from the glassy wastes", q: "dragon", lore: "beyond the glass desert", kind: "dragon" }
]
