import { VersionedTransaction } from "@solana/web3.js"
import { api } from "./api"
import { fromBase64, toBase64 } from "./format"

/** Devnet only: the server mints the day's test dUSD to the wallet. Returns the transaction signature. */
export async function getTestDusd(token: string) {
  const r = await api<{ signature: string }>("/wallet/faucet", { token, body: {} })
  return r.signature
}

/**
 * Devnet only: sets what Slabwatch may spend from the wallet, an SPL token
 * approval to its delegate. The server builds the transaction and pays the
 * fee; the wallet only adds its signature. A new allowance replaces the old one.
 */
export async function approveAllowance(
  token: string,
  amountUsd: number,
  signTransaction: ((tx: VersionedTransaction) => Promise<VersionedTransaction>) | undefined
) {
  if (!signTransaction) throw new Error("this wallet cannot sign transactions")
  if (!(amountUsd >= 0)) throw new Error("enter an amount in dUSD")
  const { transaction } = await api<{ transaction: string }>("/wallet/allowance", { token, body: { amountUsd } })
  const signed = await signTransaction(VersionedTransaction.deserialize(fromBase64(transaction)))
  const r = await api<{ signature: string }>("/wallet/submit", { token, body: { transaction: toBase64(signed.serialize()) } })
  return r.signature
}
