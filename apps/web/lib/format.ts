import type { Listing, Money, RedFlag } from "./types"

const digits = (c: Money["currency"]) => (c === "JPY" ? 0 : 2)

export const money = (m: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, minimumFractionDigits: digits(m.currency) }).format(
    m.amountMinor / 10 ** digits(m.currency)
  )

/** dUSD has 2 decimals: one unit is one cent. */
export const dusd = (units: string | number) =>
  `${(Number(units) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} dUSD`

/** A count with thousands separators: 1,000,199. */
export const count = (n: number) => n.toLocaleString("en-US")

export const toMinor = (major: number, c: Money["currency"]) => Math.round(major * 10 ** digits(c))
export const toMajor = (minor: number, c: Money["currency"]) => minor / 10 ** digits(c)

export const short = (s: string, n = 4) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`)

export const explorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`

export const toBase64 = (bytes: Uint8Array) => {
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const labels: Record<string, string> = {
  first: "1st edition",
  unlimited: "Unlimited",
  any: "Any",
  holo: "Holo",
  non_holo: "Non-holo",
  reverse_holo: "Reverse holo"
}
export const label = (v: string) => labels[v] ?? v

/** The finish after the edition, as a tile and a want say it: "1st edition holo", "Unlimited". */
export const variant = (l: Pick<Listing, "edition" | "finish">) =>
  `${label(l.edition)}${l.finish === "non_holo" ? "" : ` ${label(l.finish).toLowerCase()}`}`

/** A plain-language want for a watch on this card, to seed the New watch form from a tile. */
export const watchWant = (l: Listing) =>
  `${l.cardName}, ${l.setName} #${l.cardNumber}, ${variant(l)}, grade ${l.grade} or better, up to ${money(l.price)}`

/** The code's red flags in words, as the purchase policy states them. */
export const redFlagText: Record<RedFlag, string> = {
  duplicate_vault_item: "The same vault item has another active listing",
  price_far_below_market: "The price is under 40% of recent sales for this card, variant and grade",
  grade_claim_mismatch: "The seller's text claims a grade or grader that differs from the vault record"
}
