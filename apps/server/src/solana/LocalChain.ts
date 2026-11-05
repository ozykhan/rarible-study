import { type Blockhash, getSignatureFromTransaction, lamports } from "@solana/kit"
import { LEGACY_MEMO_PROGRAM_ADDRESS_V1, MEMO_PROGRAM_ADDRESS } from "@solana-program/memo"
import { Effect, Layer } from "effect"
import type { LiteSVM } from "litesvm"
import { Chain, ChainError } from "./Chain.ts"

type LiteSvmModule = typeof import("litesvm")

/**
 * A VM with the SPL programs built in. The memo program bundled at the
 * current memo address does not execute in this litesvm version, so the
 * legacy memo program (which accepts the same instruction) is mapped there.
 */
export const newSvm = ({ LiteSVM }: LiteSvmModule) => {
  const svm = new LiteSVM()
  const legacy = svm.getAccount(LEGACY_MEMO_PROGRAM_ADDRESS_V1)
  if (legacy.exists) svm.setAccount({ ...legacy, address: MEMO_PROGRAM_ADDRESS })
  return svm
}

/**
 * The Chain service over an in-process Solana VM. The SPL token, associated
 * token and memo programs are built in, so the real payment code runs here.
 */
export const chainLiteSvm = (svm: LiteSVM, { FailedTransactionMetadata }: LiteSvmModule) =>
  Layer.succeed(
    Chain,
    Chain.of({
      cluster: "local",
      getAccount: (a) => Effect.sync(() => svm.getAccount(a)),
      getBalance: (a) => Effect.sync(() => svm.getBalance(a) ?? 0n),
      rentExempt: (size) => Effect.sync(() => svm.minimumBalanceForRentExemption(BigInt(size))),
      latestBlockhash: Effect.sync(() => ({ blockhash: svm.latestBlockhash() as Blockhash, lastValidBlockHeight: 1_000_000n })),
      sendAndConfirm: (tx) =>
        Effect.suspend(() => {
          const result = svm.sendTransaction(tx)
          if (result instanceof FailedTransactionMetadata) {
            return Effect.fail(new ChainError({ message: `transaction failed: ${result.toString()} ${result.meta().logs().join(" | ")}` }))
          }
          // A new blockhash per transaction, like a real cluster, so two identical transfers are not duplicates.
          svm.expireBlockhash()
          return Effect.succeed(getSignatureFromTransaction(tx))
        }),
      requestAirdrop: (a, amount) =>
        Effect.suspend(() => {
          const result = svm.airdrop(a, lamports(amount))
          if (result === null || result instanceof FailedTransactionMetadata) {
            return Effect.fail(new ChainError({ message: "airdrop failed" }))
          }
          return Effect.succeed("airdrop" as never)
        })
    })
  )

/**
 * SOLANA_RPC_URL=memory: the same code paths on an in-process VM, for local
 * runs with no network. litesvm is a dev dependency, loaded only here.
 */
export const chainInMemory = Layer.unwrap(
  Effect.promise(() => import("litesvm")).pipe(Effect.map((mod) => chainLiteSvm(newSvm(mod), mod)))
)
