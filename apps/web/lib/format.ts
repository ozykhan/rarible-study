import type { Money } from "./types"

const digits = (c: Money["currency"]) => (c === "JPY" ? 0 : 2)

export const money = (m: Money) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: m.currency, minimumFractionDigits: digits(m.currency) }).format(
    m.amountMinor / 10 ** digits(m.currency)
  )

/** dUSD has 2 decimals: one unit is one cent. */
export const dusd = (units: string | number) =>
  `${(Number(units) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} dUSD`

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
