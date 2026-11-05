import { formatMoney, type Money } from "@slabwatch/domain"
import { address, getPublicKeyFromAddress, isAddress, signatureBytes, verifySignature } from "@solana/kit"
import { Effect } from "effect"

/**
 * Texts a collector signs with their wallet. The server writes each one,
 * stores it with a one-time nonce, and later checks the signature against
 * exactly that stored text, so a client can never get a different text
 * accepted. Every text says it is devnet only, because a wallet shows it to
 * the person before they sign.
 */

export interface SignInTerms {
  readonly wallet: string
  readonly issuedAt: string
  readonly nonce: string
}

export const signInMessage = (t: SignInTerms) =>
  [
    "Sign in to Slabwatch",
    "Network: Solana devnet (test tokens with no real value)",
    `Wallet: ${t.wallet}`,
    `Issued: ${t.issuedAt}`,
    `Nonce: ${t.nonce}`,
    "Signing this proves you own the wallet. It does not move any funds."
  ].join("\n")

export interface ApprovalTerms {
  readonly ruleId: string
  readonly rawWant: string
  readonly wallet: string
  readonly budget: Money
  readonly dailyCapUsdCents: number
  readonly expiresAt: string
  readonly nonce: string
}

export const approvalMessage = (t: ApprovalTerms) =>
  [
    "Slabwatch auto-buy approval",
    "Network: Solana devnet (test tokens with no real value)",
    `Rule: ${t.ruleId} ("${t.rawWant.replace(/[\r\n"]+/g, " ").slice(0, 200)}")`,
    `Wallet: ${t.wallet}`,
    `Budget for this rule: ${formatMoney(t.budget)}`,
    `Daily cap across your rules: ${formatMoney({ amountMinor: t.dailyCapUsdCents, currency: "USD" })}`,
    `Expires: ${t.expiresAt}`,
    `Nonce: ${t.nonce}`,
    "The agent may buy listings that pass this rule, within these limits, until it expires.",
    "Code checks every purchase. You can revoke this at any time."
  ].join("\n")

export interface PurchaseTerms {
  readonly purchaseId: string
  readonly ruleId: string
  readonly listingId: string
  readonly listingTitle: string
  readonly price: Money
  readonly payUnits: number
  readonly wallet: string
  readonly nonce: string
}

/** Confirm mode: the collector signs each purchase. */
export const purchaseMessage = (t: PurchaseTerms) =>
  [
    "Slabwatch purchase approval",
    "Network: Solana devnet (test tokens with no real value)",
    `Purchase: ${t.purchaseId}`,
    `Listing: ${t.listingId} ("${t.listingTitle.replace(/[\r\n"]+/g, " ").slice(0, 200)}")`,
    `Price: ${formatMoney(t.price)}, paid as ${formatMoney({ amountMinor: t.payUnits, currency: "USD" }).replace("$", "")} dUSD`,
    `Rule: ${t.ruleId}`,
    `Wallet: ${t.wallet}`,
    `Nonce: ${t.nonce}`,
    "This approves this one purchase. Code checks it again before paying."
  ].join("\n")

export const isWalletAddress = (s: string) => isAddress(s)

/** Accepts the signature as base64 (what the web page sends) and checks it with ed25519. */
export const verifyWalletSignature = (wallet: string, message: string, signatureBase64: string) =>
  Effect.promise(async () => {
    if (!isAddress(wallet)) return false
    let bytes: Uint8Array
    try {
      bytes = Uint8Array.from(Buffer.from(signatureBase64, "base64"))
    } catch {
      return false
    }
    if (bytes.length !== 64) return false
    try {
      const key = await getPublicKeyFromAddress(address(wallet))
      return await verifySignature(key, signatureBytes(bytes), new TextEncoder().encode(message))
    } catch {
      return false
    }
  })
