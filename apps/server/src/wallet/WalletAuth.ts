import { randomBytes } from "node:crypto"
import { Context, Effect, Layer, Schema } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { SqlClient } from "effect/sql/SqlClient"
import { hashToken } from "../agent/AgentTokens.ts"
import { toUsdCents } from "@slabwatch/seed"
import { CatalogRepo } from "../catalog/CatalogRepo.ts"
import { AppConfig } from "../config.ts"
import { type ExecuteResult, type Purchase, Purchases } from "../purchases/Purchases.ts"
import { RuleRepo } from "../rules/RuleRepo.ts"
import { approvalMessage, isWalletAddress, purchaseMessage, signInMessage, verifyWalletSignature } from "./signing.ts"

/** A refusal the collector can read. `status` is the HTTP status the API answers with. */
export class WalletError extends Schema.TaggedError<WalletError>()("WalletError", {
  message: Schema.String,
  status: Schema.Number
}) {}

export interface SigningRequest {
  readonly nonce: string
  readonly message: string
  readonly expiresAt: string
}

const SIGN_IN_MINUTES = 10
const SESSION_HOURS = 12
const MAX_APPROVAL_HOURS = 24 * 7

const nonce = () => randomBytes(16).toString("hex")

export class WalletAuth extends Context.Service<
  WalletAuth,
  {
    readonly startSignIn: (wallet: string) => Effect.Effect<SigningRequest, WalletError | SqlError>
    readonly finishSignIn: (
      nonce: string,
      signature: string
    ) => Effect.Effect<{ readonly token: string; readonly wallet: string; readonly expiresAt: string }, WalletError | SqlError>
    /** The wallet a session token belongs to, or null when it is unknown or expired. */
    readonly walletFor: (token: string) => Effect.Effect<string | null, SqlError>
    readonly startAutoApproval: (
      wallet: string,
      ruleId: string,
      terms: { readonly dailyCapUsd: number; readonly hours: number }
    ) => Effect.Effect<SigningRequest, WalletError | SqlError>
    readonly finishAutoApproval: (
      wallet: string,
      nonce: string,
      signature: string
    ) => Effect.Effect<{ readonly approvalId: string }, WalletError | SqlError>
    readonly revokeAutoApprovals: (wallet: string, ruleId: string) => Effect.Effect<number, WalletError | SqlError>
    /** Confirm mode: the text for one proposed purchase, for the collector to sign. */
    readonly startPurchaseApproval: (wallet: string, purchaseId: string) => Effect.Effect<SigningRequest, WalletError | SqlError>
    /** Checks the signature, approves the purchase and executes it. The policy runs again inside execute. */
    readonly finishPurchaseApproval: (
      wallet: string,
      nonce: string,
      signature: string
    ) => Effect.Effect<ExecuteResult, WalletError | SqlError>
  }
>()("slabwatch/WalletAuth") {}

export const WalletAuthLive = Layer.effect(
  WalletAuth,
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const config = yield* AppConfig
    const rules = yield* RuleRepo
    const purchases = yield* Purchases
    const catalog = yield* CatalogRepo

    type Kind = "sign_in" | "auto_approval" | "purchase_approval"

    const store = (kind: Kind, wallet: string, message: string, n: string, expiresAt: Date, payload: unknown) =>
      sql`
        INSERT INTO signing_requests (nonce, kind, wallet, message, payload, expires_at)
        VALUES (${n}, ${kind}, ${wallet}, ${message}, ${JSON.stringify(payload)}::jsonb, ${expiresAt.toISOString()}::timestamptz)`

    /**
     * Checks the signature against the stored text, then marks the request
     * used. The update only succeeds once, so a signature cannot be replayed.
     */
    const claim = (kind: Kind, n: string, signature: string) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly wallet: string; readonly message: string; readonly payload: unknown; readonly live: boolean }>`
          SELECT wallet, message, payload, (used_at IS NULL AND expires_at > now()) AS live
          FROM signing_requests WHERE nonce = ${n} AND kind = ${kind}`
        const req = rows[0]
        if (req === undefined) return yield* new WalletError({ message: "unknown signing request", status: 404 })
        if (!req.live) return yield* new WalletError({ message: "this signing request expired or was already used; start again", status: 410 })
        const ok = yield* verifyWalletSignature(req.wallet, req.message, signature)
        if (!ok) return yield* new WalletError({ message: "the signature does not match this wallet and text", status: 401 })
        const claimed = yield* sql`
          UPDATE signing_requests SET used_at = now() WHERE nonce = ${n} AND used_at IS NULL RETURNING nonce`
        if (claimed.length === 0) return yield* new WalletError({ message: "this signing request was already used", status: 410 })
        return req
      })

    const startSignIn = Effect.fn("WalletAuth.startSignIn")(function* (wallet: string) {
      if (!isWalletAddress(wallet)) return yield* new WalletError({ message: "not a Solana address", status: 400 })
      const n = nonce()
      const expiresAt = new Date(Date.now() + SIGN_IN_MINUTES * 60_000)
      const message = signInMessage({ wallet, issuedAt: new Date().toISOString(), nonce: n })
      yield* store("sign_in", wallet, message, n, expiresAt, {})
      return { nonce: n, message, expiresAt: expiresAt.toISOString() }
    })

    const finishSignIn = Effect.fn("WalletAuth.finishSignIn")(function* (n: string, signature: string) {
      const req = yield* claim("sign_in", n, signature)
      const token = `sws_${randomBytes(32).toString("base64url")}`
      const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000)
      yield* sql`
        INSERT INTO wallet_sessions (id, wallet, token_sha256, expires_at)
        VALUES (${`S-${nonce().slice(0, 12)}`}, ${req.wallet}, ${hashToken(token)}, ${expiresAt.toISOString()}::timestamptz)`
      return { token, wallet: req.wallet, expiresAt: expiresAt.toISOString() }
    })

    const walletFor = Effect.fn("WalletAuth.walletFor")(function* (token: string) {
      if (!token.startsWith("sws_") || token.length > 100) return null
      const rows = yield* sql<{ readonly wallet: string }>`
        SELECT wallet FROM wallet_sessions WHERE token_sha256 = ${hashToken(token)} AND expires_at > now()`
      return rows[0]?.wallet ?? null
    })

    const ownedRule = (wallet: string, ruleId: string) =>
      Effect.gen(function* () {
        const stored = yield* rules.get(ruleId)
        if (stored === null || stored.rule.ownerWallet !== wallet) {
          return yield* new WalletError({ message: "no such rule for this wallet", status: 404 })
        }
        return stored.rule
      })

    const startAutoApproval = Effect.fn("WalletAuth.startAutoApproval")(function* (
      wallet: string,
      ruleId: string,
      terms: { readonly dailyCapUsd: number; readonly hours: number }
    ) {
      const rule = yield* ownedRule(wallet, ruleId)
      if (!(terms.dailyCapUsd > 0) || terms.dailyCapUsd > config.purchaseDailyCapUsd) {
        return yield* new WalletError({
          message: `the daily cap must be above $0 and at most the server's $${config.purchaseDailyCapUsd}`,
          status: 400
        })
      }
      if (!(terms.hours > 0) || terms.hours > MAX_APPROVAL_HOURS) {
        return yield* new WalletError({ message: `an approval lasts between 1 and ${MAX_APPROVAL_HOURS} hours`, status: 400 })
      }
      const n = nonce()
      const expiresAt = new Date(Date.now() + terms.hours * 3_600_000)
      const dailyCapUsdCents = Math.round(terms.dailyCapUsd * 100)
      const message = approvalMessage({
        ruleId: rule.id,
        rawWant: rule.rawWant,
        wallet,
        budget: rule.budget,
        dailyCapUsdCents,
        expiresAt: expiresAt.toISOString(),
        nonce: n
      })
      // The request itself expires after ten minutes; the approval it records lasts `hours`.
      yield* store("auto_approval", wallet, message, n, new Date(Date.now() + SIGN_IN_MINUTES * 60_000), {
        ruleId: rule.id,
        budgetMinor: rule.budget.amountMinor,
        currency: rule.budget.currency,
        dailyCapUsdCents,
        approvalExpiresAt: expiresAt.toISOString()
      })
      return { nonce: n, message, expiresAt: expiresAt.toISOString() }
    })

    const finishAutoApproval = Effect.fn("WalletAuth.finishAutoApproval")(function* (
      wallet: string,
      n: string,
      signature: string
    ) {
      const req = yield* claim("auto_approval", n, signature)
      if (req.wallet !== wallet) return yield* new WalletError({ message: "signed in as a different wallet", status: 403 })
      const p = req.payload as {
        readonly ruleId: string
        readonly budgetMinor: number
        readonly currency: string
        readonly dailyCapUsdCents: number
        readonly approvalExpiresAt: string
      }
      const rule = yield* ownedRule(wallet, p.ruleId)
      if (rule.budget.amountMinor !== p.budgetMinor || rule.budget.currency !== p.currency) {
        return yield* new WalletError({ message: "the rule's budget changed after you were asked to sign; start again", status: 409 })
      }
      const approvalId = yield* purchases.recordApproval({
        ruleId: rule.id,
        wallet,
        budget: rule.budget,
        dailyCapUsdCents: p.dailyCapUsdCents,
        mode: "auto",
        message: req.message,
        signature,
        expiresAt: new Date(p.approvalExpiresAt),
        nonce: n
      })
      yield* rules.setMode(rule.id, "auto")
      return { approvalId }
    })

    const revokeAutoApprovals = Effect.fn("WalletAuth.revokeAutoApprovals")(function* (wallet: string, ruleId: string) {
      const rule = yield* ownedRule(wallet, ruleId)
      const rows = yield* sql`
        UPDATE rule_approvals SET revoked_at = now()
        WHERE rule_id = ${rule.id} AND wallet = ${wallet} AND revoked_at IS NULL RETURNING id`
      yield* rules.setMode(rule.id, "confirm")
      return rows.length
    })

    /**
     * The wallet may sign for a purchase made for one of its rules, or for its
     * own direct buy. Returns the rule id, or null for a direct buy.
     */
    const purchaseFor = (wallet: string, purchase: Purchase) =>
      Effect.gen(function* () {
        if (purchase.ruleId !== null) return (yield* ownedRule(wallet, purchase.ruleId)).id
        if (purchase.buyerWallet !== wallet) return yield* new WalletError({ message: "no such purchase", status: 404 })
        return null
      })

    const startPurchaseApproval = Effect.fn("WalletAuth.startPurchaseApproval")(function* (wallet: string, purchaseId: string) {
      const purchase = yield* purchases.get(purchaseId)
      if (purchase === null) return yield* new WalletError({ message: "no such purchase", status: 404 })
      const ruleId = yield* purchaseFor(wallet, purchase)
      if (purchase.status !== "proposed") {
        return yield* new WalletError({ message: `this purchase is already ${purchase.status}`, status: 409 })
      }
      const listing = yield* catalog.getListing(purchase.listingId)
      const n = nonce()
      const expiresAt = new Date(Date.now() + SIGN_IN_MINUTES * 60_000)
      const message = purchaseMessage({
        purchaseId: purchase.id,
        ruleId,
        listingId: purchase.listingId,
        listingTitle: listing?.title ?? "",
        price: purchase.price,
        payUnits: toUsdCents(purchase.price.amountMinor, purchase.price.currency),
        wallet,
        nonce: n
      })
      yield* store("purchase_approval", wallet, message, n, expiresAt, { purchaseId: purchase.id })
      return { nonce: n, message, expiresAt: expiresAt.toISOString() }
    })

    const finishPurchaseApproval = Effect.fn("WalletAuth.finishPurchaseApproval")(function* (
      wallet: string,
      n: string,
      signature: string
    ) {
      const req = yield* claim("purchase_approval", n, signature)
      if (req.wallet !== wallet) return yield* new WalletError({ message: "signed in as a different wallet", status: 403 })
      const { purchaseId } = req.payload as { readonly purchaseId: string }
      const purchase = yield* purchases.get(purchaseId)
      if (purchase === null) return yield* new WalletError({ message: "no such purchase", status: 404 })
      const ruleId = yield* purchaseFor(wallet, purchase)
      yield* purchases.approve(purchaseId)
      return yield* purchases.execute(
        { actor: `collector:${wallet}`, allowedRuleIds: new Set(ruleId === null ? [] : [ruleId]), runId: null },
        purchaseId
      )
    })

    return WalletAuth.of({
      startSignIn,
      finishSignIn,
      walletFor,
      startAutoApproval,
      finishAutoApproval,
      revokeAutoApprovals,
      startPurchaseApproval,
      finishPurchaseApproval
    })
  })
)
