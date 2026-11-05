import { formatMoney } from "@slabwatch/domain"
import { toUsdCents } from "@slabwatch/seed"
import { address, isAddress } from "@solana/kit"
import { Effect, Layer, Redacted } from "effect"
import { AppConfig } from "../config.ts"
import { PaymentError, Payments, PaymentsSimulated } from "../purchases/Payments.ts"
import { Chain, ChainError, chainRpc } from "./Chain.ts"
import { chainInMemory } from "./LocalChain.ts"
import { deriveDevnetKeys, makeTreasury, Treasury } from "./Treasury.ts"

const dusd = (units: bigint) => formatMoney({ amountMinor: Number(units), currency: "USD" }).replace("$", "") + " dUSD"

/**
 * Pays for a purchase with an SPL token transfer on devnet: dUSD from the
 * collector's token account to the mock escrow, signed by Slabwatch's
 * delegate. The chain enforces the allowance the collector approved, so even
 * a bug above this line cannot spend more than that.
 */
export const PaymentsDevnet = Layer.effect(
  Payments,
  Effect.gen(function* () {
    const treasury = yield* Treasury
    return Payments.of({
      kind: "devnet",
      transfer: (t) =>
        Effect.gen(function* () {
          if (t.from === null || !isAddress(t.from)) {
            return yield* new PaymentError({ message: "there is no wallet to pay from" })
          }
          const from = address(t.from)
          const units = BigInt(toUsdCents(t.amount.amountMinor, t.amount.currency))
          const funds = yield* treasury.funds(from)
          if (funds.allowanceUnits < units) {
            return yield* new PaymentError({
              message: `the wallet allows Slabwatch to spend ${dusd(funds.allowanceUnits)} and this purchase needs ${dusd(units)}; approve a larger allowance and try again`
            })
          }
          if (funds.balanceUnits < units) {
            return yield* new PaymentError({
              message: `the wallet holds ${dusd(funds.balanceUnits)} and this purchase needs ${dusd(units)}`
            })
          }
          const signature = yield* treasury.pay(from, units, t.memo)
          return { signature }
        }).pipe(
          Effect.catchTag("ChainError", (e) => Effect.fail(new PaymentError({ message: e.message }))),
          Effect.withSpan("Payments.devnet.transfer", { attributes: { "purchase.id": t.purchaseId } })
        )
    })
  })
)

const refuse = Effect.fail(new ChainError({ message: "devnet payments are turned off on this server (PAYMENTS=simulated)" }))

/** Stands in for the treasury when payments are simulated, so the web API can say so plainly. */
export const TreasuryDisabled = Layer.succeed(
  Treasury,
  Treasury.of({
    cluster: "local",
    addresses: null as never,
    setup: refuse,
    funds: () => refuse,
    faucet: () => refuse,
    allowanceTransaction: () => refuse,
    submitSigned: () => refuse,
    pay: () => refuse
  })
)

export const TreasuryLive = Layer.effect(
  Treasury,
  Effect.gen(function* () {
    const config = yield* AppConfig
    if (config.devnetSeed === null) {
      return yield* Effect.die(new Error("PAYMENTS=devnet needs DEVNET_SEED (64 hex characters; see .env.example)"))
    }
    const keys = yield* deriveDevnetKeys(Redacted.value(config.devnetSeed)).pipe(Effect.orDie)
    return yield* makeTreasury(keys)
  })
)

/** The devnet RPC from the config. Tests replace it with the in-process VM. */
export const ChainLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* AppConfig
    return config.solanaRpcUrl === "memory" ? chainInMemory : chainRpc(config.solanaRpcUrl)
  })
)

/** Payments and the treasury, chosen by PAYMENTS. */
export const paymentsFor = <E, R>(chain: Layer.Layer<Chain, E, R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* AppConfig
      return config.payments === "devnet"
        ? PaymentsDevnet.pipe(Layer.provideMerge(TreasuryLive), Layer.provide(chain))
        : Layer.mergeAll(PaymentsSimulated, TreasuryDisabled)
    })
  )
