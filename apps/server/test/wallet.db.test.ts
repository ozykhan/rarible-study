import { expect, layer } from "@effect/vitest"
import { toUsdCents } from "@slabwatch/seed"
import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  type KeyPairSigner,
  partiallySignTransaction,
  signBytes
} from "@solana/kit"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Purchases, type Caller } from "../src/purchases/Purchases.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { Treasury } from "../src/solana/Treasury.ts"
import { WalletAuth, WalletError } from "../src/wallet/WalletAuth.ts"
import { seed, testLayer } from "./db.ts"
import { ruleFor } from "./rules.ts"

const TestLive = testLayer("wallet", {
  PAYMENTS: "devnet",
  DEVNET_SEED: "22".repeat(32),
  PURCHASE_DAILY_CAP_USD: "100000"
})

const counts = new Map<string, number>()
for (const l of seed.listings) counts.set(l.vaultItem.id, (counts.get(l.vaultItem.id) ?? 0) + 1)
const cleanIds = seed.listings
  .filter((l) => l.trap === "none" && counts.get(l.vaultItem.id) === 1 && l.listing.currency === "USD")
  .map((l) => l.listing.id)

let next = 0
const ruleOwnedBy = (wallet: string, over: { readonly mode?: "confirm" | "auto" } = {}) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogRepo
    const rules = yield* RuleRepo
    const listing = yield* catalog.getListing(cleanIds[next++]!)
    if (listing === null) throw new Error("missing listing")
    const rule = ruleFor(listing, { ownerWallet: wallet, mode: over.mode ?? "confirm" })
    yield* rules.insert({ rule, softEmbedding: null })
    return { listing, rule }
  })

const newWallet = Effect.promise(() => generateKeyPairSigner())

/** What the browser wallet does on signMessage: ed25519 over the UTF-8 text, sent as base64. */
const signText = (wallet: KeyPairSigner, text: string) =>
  Effect.promise(async () =>
    Buffer.from(await signBytes(wallet.keyPair.privateKey, new TextEncoder().encode(text))).toString("base64")
  )

const signTx = (wallet: KeyPairSigner, wire: string) =>
  Effect.promise(async () => {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    return getBase64EncodedWireTransaction(await partiallySignTransaction([wallet.keyPair], tx))
  })

/** The HTTP status a refusal carries. */
const refusedWith = <A, E extends { readonly _tag: string }, R>(e: Effect.Effect<A, E, R>) =>
  Effect.flip(e).pipe(Effect.map((err) => (err instanceof WalletError ? err.status : err._tag)))

const agent = (ruleId: string): Caller => ({ actor: "agent:test", allowedRuleIds: new Set([ruleId]), runId: null })

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("wallet and devnet payments", (it) => {
  it.effect("signs in with a wallet signature, once", () =>
    Effect.gen(function* () {
      const auth = yield* WalletAuth
      const wallet = yield* newWallet
      const req = yield* auth.startSignIn(wallet.address)
      expect(req.message).toContain("Solana devnet")
      expect(req.message).toContain(req.nonce)

      const someoneElse = yield* newWallet
      expect(yield* refusedWith(auth.finishSignIn(req.nonce, yield* signText(someoneElse, req.message)))).toBe(401)

      const session = yield* auth.finishSignIn(req.nonce, yield* signText(wallet, req.message))
      expect(session.wallet).toBe(wallet.address)
      expect(yield* auth.walletFor(session.token)).toBe(wallet.address)
      expect(yield* auth.walletFor("sws_not-a-session")).toBeNull()

      expect(yield* refusedWith(auth.finishSignIn(req.nonce, yield* signText(wallet, req.message)))).toBe(410)
      expect(yield* refusedWith(auth.startSignIn("not-an-address"))).toBe(400)
    }))

  it.effect("records a signed auto-buy approval for the owner's rule only, and revokes it", () =>
    Effect.gen(function* () {
      const auth = yield* WalletAuth
      const rules = yield* RuleRepo
      const wallet = yield* newWallet
      const { rule } = yield* ruleOwnedBy(wallet.address)

      const stranger = yield* newWallet
      expect(yield* refusedWith(auth.startAutoApproval(stranger.address, rule.id, { dailyCapUsd: 50, hours: 24 }))).toBe(404)
      expect(yield* refusedWith(auth.startAutoApproval(wallet.address, rule.id, { dailyCapUsd: 0, hours: 24 }))).toBe(400)

      const req = yield* auth.startAutoApproval(wallet.address, rule.id, { dailyCapUsd: 50, hours: 24 })
      expect(req.message).toContain(`Rule: ${rule.id}`)
      expect(req.message).toContain("Daily cap across your rules: $50.00")
      const { approvalId } = yield* auth.finishAutoApproval(wallet.address, req.nonce, yield* signText(wallet, req.message))
      expect(approvalId).toMatch(/^A-/)
      expect((yield* rules.get(rule.id))?.rule.mode).toBe("auto")

      expect(yield* auth.revokeAutoApprovals(wallet.address, rule.id)).toBe(1)
      expect((yield* rules.get(rule.id))?.rule.mode).toBe("confirm")
    }))

  it.effect("pays an auto-buy with an SPL transfer to the escrow, within the on-chain allowance", () =>
    Effect.gen(function* () {
      const auth = yield* WalletAuth
      const purchases = yield* Purchases
      const treasury = yield* Treasury
      const catalog = yield* CatalogRepo
      expect((yield* treasury.setup).needsFunding).toBeNull()

      const wallet = yield* newWallet
      const { listing, rule } = yield* ruleOwnedBy(wallet.address)
      const req = yield* auth.startAutoApproval(wallet.address, rule.id, { dailyCapUsd: 100_000, hours: 24 })
      yield* auth.finishAutoApproval(wallet.address, req.nonce, yield* signText(wallet, req.message))

      const price = BigInt(toUsdCents(listing.price.amountMinor, listing.price.currency))
      yield* treasury.faucet(wallet.address, price * 3n)

      // No allowance yet: the purchase fails before anything is sent, and says why.
      const first = yield* purchases.propose(agent(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "fits" })
      if (first.status !== "proposed") throw new Error(JSON.stringify(first))
      const noAllowance = yield* purchases.execute(agent(rule.id), first.purchaseId)
      expect(noAllowance).toMatchObject({ status: "failed" })
      expect(noAllowance.status === "failed" && noAllowance.error).toMatch(/allows Slabwatch to spend 0.00 dUSD/)

      // The collector approves an allowance in their wallet; then the purchase pays.
      yield* treasury.submitSigned(yield* signTx(wallet, yield* treasury.allowanceTransaction(wallet.address, price * 2n)))
      const escrowBefore = (yield* treasury.funds(treasury.addresses.escrowOwner)).balanceUnits
      const second = yield* purchases.propose(agent(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "fits" })
      if (second.status !== "proposed") throw new Error(JSON.stringify(second))
      const paid = yield* purchases.execute(agent(rule.id), second.purchaseId)
      expect(paid).toMatchObject({ status: "executed" })
      expect(paid.status === "executed" && paid.txSignature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/)
      expect((yield* treasury.funds(treasury.addresses.escrowOwner)).balanceUnits - escrowBefore).toBe(price)
      const funds = yield* treasury.funds(wallet.address)
      expect(funds.balanceUnits).toBe(price * 2n)
      expect(funds.allowanceUnits).toBe(price)
      expect((yield* catalog.getListing(listing.listingId))?.status).toBe("sold")
    }))

  it.effect("confirm mode: the collector signs one purchase, and it pays", () =>
    Effect.gen(function* () {
      const auth = yield* WalletAuth
      const purchases = yield* Purchases
      const treasury = yield* Treasury
      yield* treasury.setup
      const wallet = yield* newWallet
      const { listing, rule } = yield* ruleOwnedBy(wallet.address)
      const price = BigInt(toUsdCents(listing.price.amountMinor, listing.price.currency))
      yield* treasury.faucet(wallet.address, price)
      yield* treasury.submitSigned(yield* signTx(wallet, yield* treasury.allowanceTransaction(wallet.address, price)))

      const proposed = yield* purchases.propose(agent(rule.id), { ruleId: rule.id, listingId: listing.listingId, reason: "fits" })
      if (proposed.status !== "proposed") throw new Error(JSON.stringify(proposed))
      expect(proposed.next).toBe("awaiting_collector_approval")

      const stranger = yield* newWallet
      expect(yield* refusedWith(auth.startPurchaseApproval(stranger.address, proposed.purchaseId))).toBe(404)
      const req = yield* auth.startPurchaseApproval(wallet.address, proposed.purchaseId)
      expect(req.message).toContain(`Purchase: ${proposed.purchaseId}`)
      expect(req.message).toContain("dUSD")
      const result = yield* auth.finishPurchaseApproval(wallet.address, req.nonce, yield* signText(wallet, req.message))
      expect(result).toMatchObject({ status: "executed" })
      expect((yield* treasury.funds(wallet.address)).balanceUnits).toBe(0n)
      expect(yield* refusedWith(auth.startPurchaseApproval(wallet.address, proposed.purchaseId))).toBe(409)
    }))

  it.effect("refuses an auto-buy signature once the rule's budget has changed", () =>
    Effect.gen(function* () {
      const auth = yield* WalletAuth
      const wallet = yield* newWallet
      const { rule } = yield* ruleOwnedBy(wallet.address)
      const req = yield* auth.startAutoApproval(wallet.address, rule.id, { dailyCapUsd: 50, hours: 1 })
      const sql = yield* SqlClient
      yield* sql`UPDATE watch_rules SET budget_minor = budget_minor * 10 WHERE id = ${rule.id}`
      expect(yield* refusedWith(auth.finishAutoApproval(wallet.address, req.nonce, yield* signText(wallet, req.message)))).toBe(409)
    }))
})
