import { graderNames, type Edition, type Finish, type Grader } from "@slabwatch/domain"
import { TAGS, tagById } from "../tags/vocabulary.ts"

/**
 * Reading a market search box the way a collector means it. Words with a
 * fixed meaning in this market (graders, grades, editions, finishes, card
 * numbers, certs, sellers, a price limit) become exact filters here, in code.
 * Words that describe a card ("sea animal", "flying", "glowing") become tag
 * filters, from the tag vocabulary in tags/vocabulary.ts. Every other word is
 * left for the database to prefix-match against card, kind and set words.
 *
 * This is the cheap, predictable first layer of search: no model call, the
 * same answer every time, and a filter only when the word is unambiguous.
 */

/** "relevance" is Best match: the cards closest in meaning to what was typed first (see SearchService). */
export const MARKET_SORTS = ["relevance", "recent", "price_asc", "price_desc", "grade"] as const
export type MarketSort = (typeof MARKET_SORTS)[number]

export interface MarketQuery {
  readonly set: string | null
  readonly grader: Grader | null
  readonly q: string
  /** Null picks the default for the search: see defaultSort. */
  readonly sort: MarketSort | null
  /**
   * What the shopper typed, when q is a model's reading of it. Never a filter:
   * it is only what Best match ranks by, since it keeps the words no filter
   * could express ("dragon that guards treasure" is read as "dragon").
   */
  readonly from: string
  /**
   * A description no filter can hold ("guards treasure"), in the shopper's
   * words. When a model has judged cards against it (CardFit), only the cards
   * it judged to fit match; otherwise it only ranks, like `from`.
   */
  readonly fit: string
  readonly offset: number
  readonly limit: number
}

/**
 * A tag the search asked for, and the words that asked for it. A card matches
 * when it has the tag, or when its own words start with those words: a tag
 * word never hides a card the word alone would have found ("fire" still finds
 * a card named Firefly), and cards that are not tagged yet are still found by
 * name.
 */
export interface TagFilter {
  readonly tag: string
  readonly words: ReadonlyArray<string>
}

export interface ParsedSearch {
  /** Lowercase letters and digits, each matched as the start of a card, kind or set word. */
  readonly words: ReadonlyArray<string>
  /** Described searches: every one must match. */
  readonly tags: ReadonlyArray<TagFilter>
  /**
   * Seller handles to look up. "@name" must be a seller; a bare
   * "name_with_underscores" is a seller if one has that handle, and otherwise
   * its words join the free words.
   */
  readonly handles: ReadonlyArray<{ readonly handle: string; readonly orWords: ReadonlyArray<string> }>
  readonly graders: ReadonlyArray<Grader>
  readonly editions: ReadonlyArray<Edition>
  readonly finishes: ReadonlyArray<Finish>
  /** Exact grades: "10", "9.5". */
  readonly grades: ReadonlyArray<number>
  /** "9+", "9 and up", "at least 9". */
  readonly minGrade: number | null
  /** "under 100", "<100", "less than $50": dUSD, in cents. */
  readonly maxUsdCents: number | null
  /** "#010", "#10" or "010": three digits, as the catalog writes them. */
  readonly cardNumber: string | null
  /** A full cert number such as NVG12345678. */
  readonly cert: string | null
  /** Tokens that look like a price with nothing to say what to do with it ("$100"). */
  readonly ignored: ReadonlyArray<string>
}

export const emptySearch: ParsedSearch = {
  words: [],
  tags: [],
  handles: [],
  graders: [],
  editions: [],
  finishes: [],
  grades: [],
  minGrade: null,
  maxUsdCents: null,
  cardNumber: null,
  cert: null,
  ignored: []
}

/** True when the search asks for nothing: no words and no filters. */
export const isEmptySearch = (p: ParsedSearch) =>
  p.words.length === 0 &&
  p.tags.length === 0 &&
  p.handles.length === 0 &&
  p.graders.length === 0 &&
  p.editions.length === 0 &&
  p.finishes.length === 0 &&
  p.grades.length === 0 &&
  p.minGrade === null &&
  p.maxUsdCents === null &&
  p.cardNumber === null &&
  p.cert === null

/**
 * Described searches ("sea animal", "dragon that guards treasure") are shown
 * best match first; searches for names, sets or slabs newest first, since all
 * their matches fit equally well.
 */
export const defaultSort = (p: ParsedSearch, fit = ""): MarketSort =>
  p.tags.length > 0 || fitKey(fit) !== "" ? "relevance" : "recent"

/**
 * Bump when CardFit's judging prompt changes what a judgment means: rows from
 * another version are ignored, so every card is judged again.
 */
export const FIT_VERSION = "fit1"

/**
 * Words that join a description but say nothing in it: "that guards
 * treasure" asks what "guards treasure" asks. Negations stay ("not",
 * "without"), since they turn the meaning around.
 */
const JOINING_WORDS = new Set([
  "that", "which", "who", "whose", "is", "are", "was", "were", "be", "it", "its",
  "has", "have", "had", "does", "do", "can", "one", "ones", "some", "any", "very", "really"
])

/** The words of a description that say something about a card, in the order typed. */
export const descriptionWords = (text: string) =>
  searchWords(text.slice(0, 200)).filter((w) => !isStopword(w) && !JOINING_WORDS.has(w))

/**
 * A description as judgments are stored under it: its words lowercased, in
 * the order typed, without stopwords. Order stays because it can carry the
 * meaning ("fire, not water" is not "water, not fire").
 */
export const fitKey = (fit: string) => descriptionWords(fit).join(" ")

/**
 * The words of a search that describe a card, in the order typed: tag words
 * and free words, without stopwords and without what is about the slab or the
 * listing (grader, grade, edition, finish, price, seller). Best match ranks
 * cards by these. Empty when the search describes no card.
 */
export const describedWords = (q: string): Array<string> => {
  const p = parseSearch(q)
  const keep = new Set([...p.tags.flatMap((t) => t.words), ...p.words])
  const out: Array<string> = []
  for (const w of searchWords(q.slice(0, 200))) if (keep.has(w) && !out.includes(w)) out.push(w)
  return out
}

/** Lowercase runs of letters and digits: the same split as search_words() in the database. */
export const searchWords = (text: string): Array<string> =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)

/**
 * Words that carry no meaning here. Grader names are made of ordinary words
 * ("card", "grading", "slab"); left in, they would have to match a card.
 * Every card is a creature card, so "creature" and "thing" narrow nothing
 * either: "flying creature" is a search for flying. Tag phrases are read
 * first, so "sea creature" still means sea creatures.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "in", "for", "with", "by", "from", "to",
  "card", "cards", "slab", "slabs", "graded", "grade", "grading", "authentication",
  "edition", "ed", "cert", "certified", "listing", "listings",
  "creature", "creatures", "thing", "things", "something"
])

/** A word that carries no meaning in a search ("the", "from", "graded"). */
export const isStopword = (w: string) => STOPWORDS.has(w)

const GRADER_WORDS: Record<string, Grader> = { nvg: "NVG", qsg: "QSG", lca: "LCA" }
for (const [code, name] of Object.entries(graderNames)) {
  // The first word of each grader's name is distinctive: northvale, quarry, lantern.
  const first = searchWords(name)[0]
  if (first !== undefined) GRADER_WORDS[first] = code as Grader
}

const EDITION_WORDS: Record<string, Edition> = { "1st": "first", first: "first", unlimited: "unlimited", unl: "unlimited" }
const HOLO_WORDS = new Set(["holo", "holofoil", "holographic", "hologram", "foil"])
const FINISH_WORDS: Record<string, Finish> = { reverse: "reverse_holo", nonholo: "non_holo" }
for (const w of HOLO_WORDS) FINISH_WORDS[w] = "holo"

const GRADE = /^(10(?:\.0)?|[1-9](?:\.[05])?)$/
const GRADE_UP = /^(10(?:\.0)?|[1-9](?:\.[05])?)\+$/
const MONEY = /^\$?(\d+(?:\.\d{1,2})?)(k)?\$?$/
const BELOW = /^(<=?)\$?(\d+(?:\.\d{1,2})?)(k)?$/
const CERT = /^(nvg|qsg|lca)\d{8}$/
const HANDLE = /^@([\p{L}\p{N}_.-]{1,40})$/u
const BARE_HANDLE = /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)+$/u
const CARD_NUMBER = /^#(\d{1,3})$/
const THREE_DIGITS = /^\d{3}$/

/** Every way to type a tag, longest first, so "sea creature" wins over "sea". */
const TAG_PHRASES: ReadonlyArray<{ readonly tag: string; readonly words: ReadonlyArray<string> }> = TAGS.flatMap((t) =>
  t.words.map((w) => ({ tag: t.id, words: w.split(" ") }))
).sort((a, b) => b.words.length - a.words.length)

/** A typed word matches a tag word as is or with a plural ending. */
const sameWord = (typed: string, word: string) => typed === word || typed === `${word}s` || typed === `${word}es`

const money = (digits: string, k: string | undefined) => Math.round(Number(digits) * (k ? 1000 : 1) * 100)

/**
 * One piece of the query: a token kept whole because its punctuation means
 * something, a plain word, or "," where the text had a comma or semicolon. A
 * comma ends a phrase: "fire, breathing" is fire and a word, not "fire
 * breathing". searchText relies on it. A comma between digits ("1,000") is a
 * thousands separator.
 */
const atoms = (q: string): Array<string> =>
  q
    .toLowerCase()
    .replace(/(\d),(?=\d{3}(?!\d))/g, "$1")
    .replace(/[,;]/g, " , ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .flatMap((t) =>
      HANDLE.test(t) || BARE_HANDLE.test(t) || CERT.test(t) || CARD_NUMBER.test(t) || GRADE.test(t) || GRADE_UP.test(t) ||
      MONEY.test(t) || BELOW.test(t) || t === "<" || t === "<=" || t === "+" || t === ","
        ? [t]
        : searchWords(t)
    )

const add = <A>(list: Array<A>, a: A) => {
  if (!list.includes(a)) list.push(a)
}

/** Reads a search box. Never fails: what it does not recognize becomes a word to match. */
export const parseSearch = (q: string): ParsedSearch => {
  const a = atoms(q.slice(0, 200))
  const out = {
    words: [] as Array<string>,
    tags: [] as Array<TagFilter>,
    handles: [] as Array<{ handle: string; orWords: Array<string> }>,
    graders: [] as Array<Grader>,
    editions: [] as Array<Edition>,
    finishes: [] as Array<Finish>,
    grades: [] as Array<number>,
    minGrade: null as number | null,
    maxUsdCents: null as number | null,
    cardNumber: null as string | null,
    cert: null as string | null,
    ignored: [] as Array<string>
  }
  const at = (i: number) => a[i] ?? ""
  const isGrade = (t: string) => GRADE.test(t)
  const setMax = (cents: number) => {
    out.maxUsdCents = out.maxUsdCents === null ? cents : Math.min(out.maxUsdCents, cents)
  }
  const setMin = (g: number) => {
    out.minGrade = out.minGrade === null ? g : Math.max(out.minGrade, g)
  }

  for (let i = 0; i < a.length; i++) {
    const t = at(i)
    const next = at(i + 1)
    if (t === ",") continue

    // Two- and three-word phrases first.
    if ((t === "reverse" || t === "rev") && HOLO_WORDS.has(next)) {
      add(out.finishes, "reverse_holo")
      i += 1
      continue
    }
    if ((t === "non" || t === "no") && HOLO_WORDS.has(next)) {
      add(out.finishes, "non_holo")
      i += 1
      continue
    }
    const priceAfter = (j: number) => MONEY.exec(at(j))
    if (["under", "below", "max", "<", "<=", "upto"].includes(t) && priceAfter(i + 1)) {
      const m = priceAfter(i + 1)!
      setMax(money(m[1]!, m[2]))
      i += 1
      continue
    }
    if (((t === "less" && next === "than") || (t === "up" && next === "to") || (t === "at" && next === "most")) && priceAfter(i + 2)) {
      const m = priceAfter(i + 2)!
      setMax(money(m[1]!, m[2]))
      i += 2
      continue
    }
    if (t === "at" && next === "least" && isGrade(at(i + 2))) {
      setMin(Number(at(i + 2)))
      i += 2
      continue
    }
    if (t === "min" && isGrade(next)) {
      setMin(Number(next))
      i += 1
      continue
    }
    if (isGrade(t) && next === "+") {
      setMin(Number(t))
      i += 1
      continue
    }
    if (isGrade(t) && ((next === "and" && ["up", "above", "higher"].includes(at(i + 2))) || (next === "or" && ["better", "higher", "above"].includes(at(i + 2))))) {
      setMin(Number(t))
      i += 2
      continue
    }
    const described = TAG_PHRASES.find((ph) => ph.words.every((w, j) => sameWord(at(i + j), w)))
    if (described !== undefined) {
      const typed = a.slice(i, i + described.words.length)
      if (!out.tags.some((x) => x.tag === described.tag)) out.tags.push({ tag: described.tag, words: typed })
      i += described.words.length - 1
      continue
    }

    // Single tokens.
    let m: RegExpExecArray | null
    if ((m = HANDLE.exec(t))) {
      add(out.handles, { handle: m[1]!, orWords: [] })
    } else if (CERT.test(t)) {
      out.cert = t.toUpperCase()
    } else if ((m = CARD_NUMBER.exec(t))) {
      out.cardNumber = m[1]!.padStart(3, "0")
    } else if ((m = BELOW.exec(t))) {
      setMax(money(m[2]!, m[3]))
    } else if ((m = GRADE_UP.exec(t))) {
      setMin(Number(m[1]))
    } else if (isGrade(t)) {
      add(out.grades, Number(t))
    } else if (THREE_DIGITS.test(t)) {
      out.cardNumber = t
    } else if (MONEY.test(t) && /[$k]/.test(t)) {
      out.ignored.push(t)
    } else if (BARE_HANDLE.test(t)) {
      out.handles.push({ handle: t, orWords: searchWords(t) })
    } else if (t in GRADER_WORDS) {
      add(out.graders, GRADER_WORDS[t]!)
    } else if (t in EDITION_WORDS) {
      add(out.editions, EDITION_WORDS[t]!)
    } else if (t in FINISH_WORDS) {
      add(out.finishes, FINISH_WORDS[t]!)
    } else if (STOPWORDS.has(t) || t === "<" || t === "<=" || t === "+") {
      // nothing to match
    } else {
      add(out.words, t)
    }
  }
  return out
}

const editionLabel: Record<Edition, string> = { first: "1st edition", unlimited: "unlimited" }
const editionText: Record<Edition, string> = { first: "1st", unlimited: "unlimited" }
const finishLabel: Record<Finish, string> = { holo: "holo", reverse_holo: "reverse holo", non_holo: "non-holo" }
const finishText: Record<Finish, string> = { holo: "holo", reverse_holo: "reverse holo", non_holo: "non holo" }
const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))

/**
 * One filter of a parsed search: how the page labels it (null for a seller
 * nobody has, which gets no label), the text that asks for it, and the search
 * without it.
 */
interface Part {
  readonly label: string | null
  readonly text: string
  readonly without: () => ParsedSearch
}

const drop = <A>(list: ReadonlyArray<A>, i: number) => list.filter((_, j) => j !== i)

/** The filters of a search, in the order the page shows them. `sellers` are the handles that turned out to be sellers. */
const parts = (p: ParsedSearch, sellers: ReadonlyArray<string>): Array<Part> => [
  ...p.tags.map((t, i) => ({ label: tagById(t.tag)?.label ?? t.tag, text: t.words.join(" "), without: () => ({ ...p, tags: drop(p.tags, i) }) })),
  ...p.graders.map((g, i) => ({ label: graderNames[g], text: g.toLowerCase(), without: () => ({ ...p, graders: drop(p.graders, i) }) })),
  ...p.grades.map((g, i) => ({ label: `grade ${g}`, text: String(g), without: () => ({ ...p, grades: drop(p.grades, i) }) })),
  ...(p.minGrade === null ? [] : [{ label: `grade ${p.minGrade} or higher`, text: `${p.minGrade}+`, without: () => ({ ...p, minGrade: null }) }]),
  ...p.editions.map((e, i) => ({ label: editionLabel[e], text: editionText[e], without: () => ({ ...p, editions: drop(p.editions, i) }) })),
  ...p.finishes.map((f, i) => ({ label: finishLabel[f], text: finishText[f], without: () => ({ ...p, finishes: drop(p.finishes, i) }) })),
  ...(p.cardNumber === null ? [] : [{ label: `#${p.cardNumber}`, text: `#${p.cardNumber}`, without: () => ({ ...p, cardNumber: null }) }]),
  ...(p.cert === null ? [] : [{ label: `cert ${p.cert}`, text: p.cert.toLowerCase(), without: () => ({ ...p, cert: null }) }]),
  ...(p.maxUsdCents === null
    ? []
    : [{ label: `${dollars(p.maxUsdCents)} dUSD or less`, text: `under ${dollars(p.maxUsdCents)}`, without: () => ({ ...p, maxUsdCents: null }) }]),
  ...p.handles.map((h, i) => ({
    label: sellers.includes(h.handle) ? `seller @${h.handle}` : null,
    // A bare handle reads as a seller or as words, as typed; "@name" must be a seller.
    text: h.orWords.length === 0 ? `@${h.handle}` : h.handle,
    without: () => ({ ...p, handles: drop(p.handles, i) })
  })),
  ...(p.words.length === 0 ? [] : [{ label: `"${p.words.join(" ")}"`, text: p.words.join(" "), without: () => ({ ...p, words: [] }) }])
]

/** The parts of two searches agree; `ignored` tokens ask for nothing and are left out. */
const sameSearch = (a: ParsedSearch, b: ParsedSearch) =>
  JSON.stringify({ ...a, ignored: [] }) === JSON.stringify({ ...b, ignored: [] })

/**
 * A parsed search written back as text that reads as the same search: what
 * the URL keeps once a model has read a described search, and what each chip's
 * remove link searches for. Parts are separated by commas, which end a phrase,
 * so "fire" next to "breathing" never turns into "fire breathing". Free words
 * stay together ("ashen wyrm") unless that would read as a tag, then they are
 * split by commas too.
 */
export const searchText = (p: ParsedSearch): string => {
  const text = parts(p, []).map((x) => x.text).join(", ")
  if (sameSearch(parseSearch(text), p)) return text
  return [...parts({ ...p, words: [] }, []).map((x) => x.text), ...p.words].join(", ")
}

/**
 * What the search understood, one short label per filter, for the page to
 * show and for anyone reading the API. Sellers are labelled after the lookup.
 */
export const describeSearch = (p: ParsedSearch, sellers: ReadonlyArray<string> = []): Array<string> =>
  parts(p, sellers).flatMap((x) => (x.label === null ? [] : [x.label]))

/** A removable chip: its label, and the search without it. */
export interface SearchChip {
  readonly label: string
  readonly q: string
}

/** One chip per labelled filter, each with the text of the search without it. */
export const searchChips = (p: ParsedSearch, sellers: ReadonlyArray<string> = []): Array<SearchChip> =>
  parts(p, sellers).flatMap((x) => (x.label === null ? [] : [{ label: x.label, q: searchText(x.without()) }]))
