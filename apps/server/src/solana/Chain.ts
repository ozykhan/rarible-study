import {
  type Address,
  type Blockhash,
  createSolanaRpc,
  fetchEncodedAccount,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  type MaybeEncodedAccount,
  type Signature,
  type Transaction
} from "@solana/kit"
import { Context, Effect, Layer, Ref, Schedule, Schema } from "effect"

export class ChainError extends Schema.TaggedError<ChainError>()("ChainError", {
  message: Schema.String
}) {}

/**
 * The few things Slabwatch needs from a Solana cluster. Devnet behind RPC in
 * the app; an in-process VM (litesvm) in tests, so the payment code runs for
 * real in CI without a network.
 */
export class Chain extends Context.Service<
  Chain,
  {
    readonly cluster: "devnet" | "local"
    readonly getAccount: (a: Address) => Effect.Effect<MaybeEncodedAccount, ChainError>
    readonly getBalance: (a: Address) => Effect.Effect<bigint, ChainError>
    readonly rentExempt: (size: number) => Effect.Effect<bigint, ChainError>
    readonly latestBlockhash: Effect.Effect<{ readonly blockhash: Blockhash; readonly lastValidBlockHeight: bigint }, ChainError>
    /** Sends a fully signed transaction and waits until the cluster confirms it. */
    readonly sendAndConfirm: (tx: Transaction) => Effect.Effect<Signature, ChainError>
    readonly requestAirdrop: (a: Address, lamports: bigint) => Effect.Effect<Signature, ChainError>
  }
>()("slabwatch/Chain") {}

const asChainError = (what: string) => (e: unknown) =>
  new ChainError({ message: `${what}: ${e instanceof Error ? e.message : String(e)}` })

/** Devnet's genesis hash. Any other cluster, mainnet above all, is refused before a transaction is sent. */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"

/**
 * Devnet over JSON-RPC. Confirmation polls signature statuses instead of
 * using a websocket subscription, which keeps it working behind proxies.
 * Before the first send it checks the cluster's genesis hash, so a mainnet
 * URL in the config can never move real funds.
 */
export const chainRpc = (url: string) =>
  Layer.effect(
    Chain,
    Effect.gen(function* () {
      const rpc = createSolanaRpc(url)
      const verified = yield* Ref.make(false)

      const ensureDevnet = Effect.gen(function* () {
        if (yield* Ref.get(verified)) return
        const genesis = yield* Effect.tryPromise({
          try: () => rpc.getGenesisHash().send(),
          catch: asChainError("cluster check failed")
        })
        if (genesis !== DEVNET_GENESIS_HASH) {
          return yield* new ChainError({ message: `refusing to send: the RPC is not Solana devnet (genesis ${genesis})` })
        }
        yield* Ref.set(verified, true)
      })

      const waitFor = (signature: Signature) =>
        Effect.tryPromise({
          try: () => rpc.getSignatureStatuses([signature]).send(),
          catch: asChainError("status check failed")
        }).pipe(
          Effect.flatMap(({ value }) => {
            const status = value[0]
            if (status == null || status.confirmationStatus === "processed") {
              return Effect.fail(new ChainError({ message: `not confirmed in time: ${signature}` }))
            }
            if (status.err !== null) {
              return Effect.die(new ChainError({ message: `transaction ${signature} failed: ${JSON.stringify(status.err)}` }))
            }
            return Effect.succeed(signature)
          }),
          Effect.retry({ schedule: Schedule.spaced("750 millis"), times: 60 }),
          Effect.catchDefect((d) => Effect.fail(d instanceof ChainError ? d : asChainError("confirmation")(d)))
        )

      return Chain.of({
        cluster: "devnet",
        getAccount: (a) => Effect.tryPromise({ try: () => fetchEncodedAccount(rpc, a), catch: asChainError("account lookup failed") }),
        getBalance: (a) =>
          Effect.tryPromise({ try: () => rpc.getBalance(a).send(), catch: asChainError("balance lookup failed") }).pipe(
            Effect.map((r) => BigInt(r.value))
          ),
        rentExempt: (size) =>
          Effect.tryPromise({
            try: () => rpc.getMinimumBalanceForRentExemption(BigInt(size)).send(),
            catch: asChainError("rent lookup failed")
          }).pipe(Effect.map((v) => BigInt(v))),
        latestBlockhash: Effect.tryPromise({
          try: () => rpc.getLatestBlockhash({ commitment: "confirmed" }).send(),
          catch: asChainError("blockhash lookup failed")
        }).pipe(Effect.map((r) => r.value)),
        sendAndConfirm: (tx) =>
          Effect.gen(function* () {
            yield* ensureDevnet
            const signature = getSignatureFromTransaction(tx)
            yield* Effect.tryPromise({
              try: () =>
                rpc
                  .sendTransaction(getBase64EncodedWireTransaction(tx), { encoding: "base64", preflightCommitment: "confirmed" })
                  .send(),
              catch: asChainError("send failed")
            })
            return yield* waitFor(signature)
          }),
        requestAirdrop: (a, amount) =>
          Effect.gen(function* () {
            yield* ensureDevnet
            const signature = yield* Effect.tryPromise({
              try: () => rpc.requestAirdrop(a, lamports(amount), { commitment: "confirmed" }).send(),
              catch: asChainError("airdrop refused (devnet airdrops are rate limited; faucet.solana.com also works)")
            })
            return yield* waitFor(signature)
          })
      })
    })
  )
