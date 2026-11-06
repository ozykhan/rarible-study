import { graderNames, type Edition, type Finish, type Grader } from "@slabwatch/domain"

/**
 * Reading a market search box the way a collector means it. Words with a
 * fixed meaning in this market (graders, grades, editions, finishes, card
 * numbers, certs, sellers, a price limit) become exact filters here, in code.
 * Every other word is left for the database to prefix-match against card,
 * kind and set words.
 *
 * This is the cheap, predictable first layer of search: no model call, the
 * same answer every time, and a filter only when the word is unambiguous.
 */

export const MARKET_SORTS = ["recent", "price_asc", "price_desc", "grade"] as const
export type MarketSort = (typeof MARKET_SORTS)[number]

export interface MarketQuery {
  readonly set: string | null
  readonly grader: Grader | null
  readonly q: string
  readonly sort: MarketSort
  readonly offset: number
  readonly limit: number
}

export interface ParsedSearch {
  /** Lowercase letters and digits, each matched as the start of a card, kind or set word. */
  readonly words: ReadonlyArray<string>
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
  p.handles.length === 0 &&
  p.graders.length === 0 &&
  p.editions.length === 0 &&
  p.finishes.length === 0 &&
  p.grades.length === 0 &&
  p.minGrade === null &&
  p.maxUsdCents === null &&
  p.cardNumber === null &&
  p.cert === null

/** Lowercase runs of letters and digits: the same split as search_words() in the database. */
export const searchWords = (text: string): Array<string> =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0)

/**
 * Words that carry no meaning here. Grader names are made of ordinary words
 * ("card", "grading", "slab"); left in, they would have to match a card.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "in", "for", "with", "by", "from", "to",
  "card", "cards", "slab", "slabs", "graded", "grade", "grading", "authentication",
  "edition", "ed", "cert", "certified", "listing", "listings"
])

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

const money = (digits: string, k: string | undefined) => Math.round(Number(digits) * (k ? 1000 : 1) * 100)

/** One piece of the query: a token kept whole because its punctuation means something, or a plain word. */
const atoms = (q: string): Array<string> =>
  q
    .toLowerCase()
    .split(/[\s,;]+/)
    .filter((t) => t.length > 0)
    .flatMap((t) =>
      HANDLE.test(t) || BARE_HANDLE.test(t) || CERT.test(t) || CARD_NUMBER.test(t) || GRADE.test(t) || GRADE_UP.test(t) ||
      MONEY.test(t) || BELOW.test(t) || t === "<" || t === "<=" || t === "+"
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
const finishLabel: Record<Finish, string> = { holo: "holo", reverse_holo: "reverse holo", non_holo: "non-holo" }
const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2))

/**
 * What the search understood, one short label per filter, for the page to
 * show and for anyone reading the API. Sellers are labelled after the lookup.
 */
export const describeSearch = (p: ParsedSearch, sellers: ReadonlyArray<string> = []): Array<string> => [
  ...p.graders.map((g) => graderNames[g]),
  ...p.grades.map((g) => `grade ${g}`),
  ...(p.minGrade === null ? [] : [`grade ${p.minGrade} or higher`]),
  ...p.editions.map((e) => editionLabel[e]),
  ...p.finishes.map((f) => finishLabel[f]),
  ...(p.cardNumber === null ? [] : [`#${p.cardNumber}`]),
  ...(p.cert === null ? [] : [`cert ${p.cert}`]),
  ...(p.maxUsdCents === null ? [] : [`${dollars(p.maxUsdCents)} dUSD or less`]),
  ...sellers.map((h) => `seller @${h}`),
  ...(p.words.length === 0 ? [] : [`"${p.words.join(" ")}"`])
]
