import { Schema } from "effect"

/** Currencies a listing can be priced in. Only USD is payable (see the test token). */
export const Currency = Schema.Literals(["USD", "EUR", "JPY"])
export type Currency = typeof Currency.Type

/** Digits after the decimal point, per ISO 4217. */
export const minorDigits: Record<Currency, number> = { USD: 2, EUR: 2, JPY: 0 }

/**
 * Money is always an integer count of minor units (cents for USD, yen for JPY)
 * plus a currency code. Floats never hold prices.
 */
export const Money = Schema.Struct({
  amountMinor: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  currency: Currency
})
export type Money = typeof Money.Type

export const money = (amountMinor: number, currency: Currency): Money => ({ amountMinor, currency })

/** Converts a major-unit amount (900 dollars) to minor units (90000 cents). */
export const fromMajor = (amount: number, currency: Currency): Money => ({
  amountMinor: Math.round(amount * 10 ** minorDigits[currency]),
  currency
})

export const toMajor = (m: Money): number => m.amountMinor / 10 ** minorDigits[m.currency]

export const formatMoney = (m: Money): string => {
  const digits = minorDigits[m.currency]
  const major = toMajor(m).toFixed(digits)
  const symbol = m.currency === "USD" ? "$" : m.currency === "EUR" ? "EUR " : "JPY "
  return `${symbol}${major}`
}
