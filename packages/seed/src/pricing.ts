import type { Currency, Edition, Finish, Grader } from "@slabwatch/domain"
import { cardById, type CardSpec } from "./catalog.ts"

const editionFactor: Record<Edition, number> = { first: 2.2, unlimited: 1 }
const finishFactor: Record<Finish, number> = { holo: 1.8, reverse_holo: 1.3, non_holo: 1 }
const graderFactor: Record<Grader, number> = { NVG: 1, QSG: 0.9, LCA: 0.8 }

const gradeFactor = (grade: number): number => {
  if (grade >= 10) return 3
  if (grade >= 9.5) return 1.8
  if (grade >= 9) return 1
  if (grade >= 8.5) return 0.75
  if (grade >= 8) return 0.6
  if (grade >= 7) return 0.4
  if (grade >= 6) return 0.3
  return 0.2
}

/** Fixed, fictional exchange rates: units of the currency per 1 USD. */
export const usdRate: Record<Currency, number> = { USD: 1, EUR: 0.92, JPY: 150 }

/** Fair market value in USD cents for a card, variant, grader and grade. */
export const valueCents = (
  card: Pick<CardSpec, "baseValueUsd">,
  edition: Edition,
  finish: Finish,
  grader: Grader,
  grade: number
): number => {
  const usd = card.baseValueUsd * editionFactor[edition] * finishFactor[finish] * graderFactor[grader] * gradeFactor(grade)
  return Math.round(usd * 100)
}

/** valueCents for a card of the hand-written catalog, by id. */
export const marketValueCents = (cardId: string, edition: Edition, finish: Finish, grader: Grader, grade: number): number =>
  valueCents(cardById(cardId), edition, finish, grader, grade)

/** Converts a USD cent amount to minor units of another currency at the fixed rate. */
export const fromUsdCents = (cents: number, currency: Currency): number => {
  if (currency === "USD") return cents
  if (currency === "EUR") return Math.round(cents * usdRate.EUR)
  return Math.round((cents / 100) * usdRate.JPY)
}

/** The inverse of fromUsdCents: minor units of any currency to USD cents at the fixed rate. */
export const toUsdCents = (amountMinor: number, currency: Currency): number => {
  if (currency === "USD") return amountMinor
  if (currency === "EUR") return Math.round(amountMinor / usdRate.EUR)
  return Math.round((amountMinor / usdRate.JPY) * 100)
}
