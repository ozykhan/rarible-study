import type { Currency, Edition, Finish, Grader } from "@slabwatch/domain"
import { toMajor } from "@slabwatch/domain"
import { evalRules } from "./dataset.ts"

/**
 * Wants a collector might type when drafting a watch, each with the rule a
 * careful reader would draft and whether the parser should ask anything.
 * Fields left out are the defaults: no set or card, any edition, finish and
 * grader, grade 1, USD. `soft` says whether the draft should carry a
 * description; left out, either is fine.
 */
export interface ParseCase {
  readonly want: string
  readonly setId?: string | null
  readonly cardId?: string | null
  readonly edition?: Edition | "any"
  readonly finish?: Finish | "any"
  readonly graders?: ReadonlyArray<Grader>
  readonly minGrade?: number
  /** In major units. */
  readonly maxPrice: number
  readonly currency?: Currency
  readonly soft?: boolean
  /** True when a careful reader would ask the collector something before saving. */
  readonly asks?: boolean
  readonly why: string
}

/** The five rules of the matching eval, as their wants. */
const matchingRules: ReadonlyArray<ParseCase> = evalRules.map(({ rule }) => ({
  want: rule.rawWant,
  setId: rule.hard.setId,
  cardId: rule.hard.cardId,
  edition: rule.hard.edition,
  finish: rule.hard.finish,
  graders: rule.hard.graders,
  minGrade: rule.hard.minGrade,
  maxPrice: toMajor(rule.hard.maxPrice),
  currency: rule.hard.maxPrice.currency,
  soft: rule.softDescription !== null,
  why: `matching eval rule ${rule.id}`
}))

export const parseCases: ReadonlyArray<ParseCase> = [
  ...matchingRules,
  {
    want: "Horse cards grade 7 or better under $100",
    minGrade: 7,
    maxPrice: 100,
    soft: true,
    why: "a kind no card name says (Kelpie Foal, Starlit Unicorn): the parser asked whether horse cards exist"
  },
  { want: "any golem, grade 8 or better, under $80", minGrade: 8, maxPrice: 80, soft: true, why: "a kind that card names do say" },
  {
    want: "a glowing sea creature, holo, under $300",
    finish: "holo",
    maxPrice: 300,
    soft: true,
    why: "two descriptions search reads as tags"
  },
  {
    want: "unicorn cards, grade 9 or better, max $400",
    minGrade: 9,
    maxPrice: 400,
    soft: true,
    cardId: null,
    why: "a kind, though one card's name has the word: not that card"
  },
  {
    want: "something that swims, holo, LCA only, under $120",
    finish: "holo",
    graders: ["LCA"],
    maxPrice: 120,
    soft: true,
    why: "a description in plain words"
  },
  {
    want: "a fire breathing dragon from Emberfall, 1st edition, under $1,000",
    setId: "EF",
    edition: "first",
    maxPrice: 1000,
    soft: true,
    why: "a set and a description"
  },
  {
    want: "lumen moth reverse holo, NVG 10, under $200",
    setId: "OS",
    cardId: "OS-009",
    finish: "reverse_holo",
    graders: ["NVG"],
    minGrade: 10,
    maxPrice: 200,
    soft: false,
    why: "a card named in lowercase"
  },
  {
    want: "Frostpetal, holo, 9 or better, max $150",
    setId: "OS",
    cardId: "OS-007",
    finish: "holo",
    minGrade: 9,
    maxPrice: 150,
    soft: false,
    why: "the first word of a card's name"
  },
  {
    want: "Cinderwng Drake from Origin, grade 9 or better, under $600",
    setId: "OS",
    cardId: "OS-001",
    minGrade: 9,
    maxPrice: 600,
    soft: false,
    why: "a misspelt card and half a set name"
  },
  {
    want: "Ashen Wyrm, any grader, grade 9 or better, under ¥60,000",
    setId: "EF",
    cardId: "EF-001",
    minGrade: 9,
    maxPrice: 60000,
    currency: "JPY",
    soft: false,
    why: "a card priced in yen"
  },
  {
    want: "Emberkit grade 10 under $90",
    setId: "OS",
    cardId: "OS-008",
    minGrade: 10,
    maxPrice: 90,
    soft: false,
    why: "a one-word card name"
  },
  {
    want: "Cinderwing Drake holo, grade 9 or better, under $500",
    finish: "holo",
    minGrade: 9,
    maxPrice: 500,
    soft: false,
    asks: true,
    why: "the card is in two sets: ask which"
  },
  {
    want: "Moonlight Unicorn, grade 9 or better, under $300",
    minGrade: 9,
    maxPrice: 300,
    asks: true,
    why: "a card that does not exist: ask, never swap in Starlit Unicorn"
  }
]
