/**
 * Display data for the fictional catalog: set themes and where each card's
 * generated art lives. The images are in public/art and were made with
 * scripts/generate_art.py.
 */

export interface SetTheme {
  readonly id: string
  readonly name: string
  readonly year: number
  readonly blurb: string
  /**
   * The card frame and accents for this set: a CSS color, here always a
   * token from styles/tokens.css. Components pass it on as the --tone custom
   * property, and the stylesheets tint borders, glows and backdrops with it.
   */
  readonly tone: string
}

export const SETS: ReadonlyArray<SetTheme> = [
  { id: "OS", name: "Origin Set", year: 2001, blurb: "Meadows, old forests and the first wyrmlings.", tone: "var(--set-OS)" },
  { id: "TW", name: "Tidewild", year: 2002, blurb: "Reef dwellers and sea dragons from the moonlit lagoon.", tone: "var(--set-TW)" },
  { id: "EF", name: "Emberfall", year: 2003, blurb: "Creatures forged in lava, ash and ember.", tone: "var(--set-EF)" },
  { id: "SE", name: "Starward Expedition", year: 2004, blurb: "Drakes and spirits drifting between the stars.", tone: "var(--set-SE)" }
]

/** The tone for a card whose set is not in SETS. */
export const UNKNOWN_TONE = "var(--set-unknown)"

const byName = new Map(SETS.map((s) => [s.name, s]))
const byId = new Map(SETS.map((s) => [s.id, s]))

export const setTheme = (l: { readonly setId?: string; readonly setName: string }): SetTheme | undefined =>
  (l.setId ? byId.get(l.setId) : undefined) ?? byName.get(l.setName)

export const cardId = (l: {
  readonly cardId?: string
  readonly setId?: string
  readonly setName: string
  readonly cardNumber: string
}) => l.cardId ?? `${setTheme(l)?.id ?? "XX"}-${l.cardNumber}`

export const cardArt = (l: Parameters<typeof cardId>[0]) => `/art/cards/${cardId(l)}.webp`
export const setArt = (id: string) => `/art/sets/${id}.webp`

/** Generic grading terms, the same for every fictional grader. */
const GRADE_WORDS: ReadonlyArray<readonly [number, string]> = [
  [10, "GEM MINT"],
  [9.5, "MINT+"],
  [9, "MINT"],
  [8.5, "NM-MT+"],
  [8, "NM-MT"],
  [7, "NEAR MINT"],
  [6, "EX-MT"]
]

/** The words a grade label carries. Generic grading terms, the same for every fictional grader. */
export const gradeWord = (g: number) => GRADE_WORDS.find(([min]) => g >= min)?.[1] ?? "EX"

/** The three fictional graders. Their label colors are --grader-<code>-* in styles/tokens.css. */
export const GRADERS: Record<string, string> = {
  NVG: "Northvale Grading",
  QSG: "Quarry Slab Grading",
  LCA: "Lantern Card Authentication"
}

export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
