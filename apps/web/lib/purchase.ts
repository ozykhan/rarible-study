import { api } from "./api"
import type { ExecuteResult, ProposeResult, SigningRequest } from "./types"

/**
 * The collector signs a text naming this one purchase, then the server checks
 * it again and pays. Used for a rule's purchases and for direct buys.
 */
export async function signAndPay(token: string, purchaseId: string, signText: (message: string) => Promise<string>) {
  const req = await api<SigningRequest>(`/purchases/${purchaseId}/approve/start`, { token, body: {} })
  const signature = await signText(req.message)
  return api<ExecuteResult>(`/purchases/${purchaseId}/approve/finish`, { token, body: { nonce: req.nonce, signature } })
}

/** A direct buy from the market: no rule, paid from the signed-in wallet. Only its buyer's signature executes it. */
export const proposeDirect = (token: string, listingId: string) =>
  api<ProposeResult>("/purchases/direct", { token, body: { listingId } })

/** What happened, in a sentence for the page. */
export const outcomeText = (r: ExecuteResult | { status: "refused"; refusals: ReadonlyArray<string> }) => {
  switch (r.status) {
    case "executed":
      return "Paid. The listing is yours (on devnet)."
    case "awaiting_collector_approval":
      return "Waiting for your signature."
    case "refused":
      return `Refused by code: ${r.refusals.join("; ")}`
    case "failed":
      return `The payment failed: ${r.error}`
  }
}
