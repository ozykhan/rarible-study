import { describe, expect, it } from "@effect/vitest"
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  type KeyPairSigner
} from "@solana/kit"
import { Effect, Layer } from "effect"
import { LiteSVM } from "litesvm"
import { DevnetSeedError, deriveDevnetKeys, makeTreasury, Treasury } from "../src/solana/Treasury.ts"
import { chainLiteSvm, newSvm } from "./litesvmChain.ts"

const SEED = "11".repeat(32)

const treasuryOn = (svm: LiteSVM) =>
  Layer.effect(Treasury, Effect.flatMap(deriveDevnetKeys(SEED).pipe(Effect.orDie), makeTreasury)).pipe(
    Layer.provide(chainLiteSvm(svm))
  )

/** What a wallet does with the transaction the server built: add its own signature. */
const walletSigns = (wire: string, wallet: KeyPairSigner) =>
  Effect.promise(async () => {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    return getBase64EncodedWireTransaction(await partiallySignTransaction([wallet.keyPair], tx))
  })

describe("Treasury on an in-process Solana VM", () => {
  it("derives the same keys from the same seed and refuses a bad one", () =>
    Effect.gen(function* () {
      const a = yield* deriveDevnetKeys(SEED)
      const b = yield* deriveDevnetKeys(SEED)
      expect(a.treasury.address).toBe(b.treasury.address)
      expect(new Set([a.treasury.address, a.delegate.address, a.mint.address, a.escrow.address]).size).toBe(4)
      const bad = yield* Effect.flip(deriveDevnetKeys("not hex"))
      expect(bad).toBeInstanceOf(DevnetSeedError)
    }).pipe(Effect.runPromise))

  it("sets up once, funds a wallet, takes a signed allowance and pays only within it", () => {
    const svm = newSvm()
    return Effect.gen(function* () {
      const treasury = yield* Treasury
      const first = yield* treasury.setup
      expect(first.created).toEqual(["airdrop", "mint", "escrow account"])
      const again = yield* treasury.setup
      expect(again.created).toEqual([])

      const collector = yield* Effect.promise(() => generateKeyPairSigner())
      yield* treasury.faucet(collector.address, 100_000n)
      const funded = yield* treasury.funds(collector.address)
      expect(funded.balanceUnits).toBe(100_000n)
      expect(funded.allowanceUnits).toBe(0n)
      // The collector never needs SOL: the treasury pays every fee.
      expect(funded.lamports).toBe(0n)

      const wire = yield* treasury.allowanceTransaction(collector.address, 30_000n)
      const unsigned = yield* Effect.flip(treasury.submitSigned(wire))
      expect(unsigned.message).toContain("has not signed")
      yield* treasury.submitSigned(yield* walletSigns(wire, collector))
      expect((yield* treasury.funds(collector.address)).allowanceUnits).toBe(30_000n)

      yield* treasury.pay(collector.address, 12_500n, "slabwatch P-1 L-1")
      const after = yield* treasury.funds(collector.address)
      expect(after.balanceUnits).toBe(87_500n)
      expect(after.allowanceUnits).toBe(17_500n)
      const escrow = yield* treasury.funds(treasury.addresses.escrowOwner)
      expect(escrow.balanceUnits).toBe(12_500n)

      // The chain enforces the allowance, whatever the server asks for.
      const over = yield* Effect.flip(treasury.pay(collector.address, 20_000n, "slabwatch P-2 L-2"))
      expect(over.message).toContain("transaction failed")
      expect((yield* treasury.funds(collector.address)).balanceUnits).toBe(87_500n)
    }).pipe(Effect.provide(treasuryOn(svm)), Effect.runPromise)
  })

  it("relays only transactions it built itself, unchanged", () => {
    const svm = newSvm()
    return Effect.gen(function* () {
      const treasury = yield* Treasury
      yield* treasury.setup
      const collector = yield* Effect.promise(() => generateKeyPairSigner())
      const wire = yield* treasury.allowanceTransaction(collector.address, 1_000n)

      // Change one byte of the message (the allowance amount sits near the end).
      const bytes = Uint8Array.from(Buffer.from(wire, "base64"))
      bytes[bytes.length - 2] = (bytes[bytes.length - 2]! + 1) % 256
      const tampered = yield* Effect.flip(treasury.submitSigned(yield* walletSigns(Buffer.from(bytes).toString("base64"), collector)))
      expect(tampered.message).toContain("changed after Slabwatch built it")

      const junk = yield* Effect.flip(treasury.submitSigned("aGVsbG8="))
      expect(junk.message).toContain("not a Solana transaction")
      expect((yield* treasury.funds(collector.address)).allowanceUnits).toBe(0n)
    }).pipe(Effect.provide(treasuryOn(svm)), Effect.runPromise)
  })
})
