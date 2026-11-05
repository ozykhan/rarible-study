import type { Money } from "@slabwatch/domain"
import { Context, Effect, Layer, Schema } from "effect"

export class PaymentError extends Schema.TaggedError<PaymentError>()("PaymentError", {
  message: Schema.String
}) {}

export interface Transfer {
  readonly purchaseId: string
  readonly amount: Money
  /** The buyer's wallet, when the rule has one. */
  readonly from: string | null
  /** Written into the transaction memo, so a transfer can be traced back to its purchase. */
  readonly memo: string
}

/**
 * Moves the money for an approved purchase. Day 2 uses a simulated ledger; the
 * devnet implementation (SPL token transfer to a mock escrow) replaces this
 * layer on day 3 without touching the purchase flow.
 */
export class Payments extends Context.Service<
  Payments,
  {
    readonly kind: "simulated" | "devnet"
    readonly transfer: (t: Transfer) => Effect.Effect<{ readonly signature: string }, PaymentError>
  }
>()("slabwatch/Payments") {}

export const PaymentsSimulated = Layer.succeed(
  Payments,
  Payments.of({
    kind: "simulated",
    transfer: (t) => Effect.succeed({ signature: `simulated:${t.purchaseId}` })
  })
)
