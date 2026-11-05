/**
 * The wallet page's API end to end, the way the browser uses it: sign in with
 * a wallet signature, create a rule, get test dUSD, sign the allowance
 * transaction, then sign one purchase and see it paid on the (in-process)
 * chain. Requests go straight into the router as web Requests.
 */
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
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Treasury } from "../src/solana/Treasury.ts"
import { WebApiRoutes } from "../src/web/WebApi.ts"
import { seed, testLayer } from "./db.ts"

const TestLive = testLayer("web", { PAYMENTS: "devnet", DEVNET_SEED: "33".repeat(32), FAUCET_USD: "5000" })

/** The routes get their services when the router is built, so the handler is built with the test's. */
const api = Effect.gen(function* () {
  const ctx = yield* Effect.context<never>()
  const web = HttpRouter.toWebHandler(
    WebApiRoutes.pipe(Layer.provide(HttpServer.layerServices), Layer.provide(Layer.succeedContext(ctx as never))),
    { disableLogger: true }
  )
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()))
  return (path: string, init: { method?: string; body?: unknown; token?: string; ip?: string } = {}) =>
    Effect.promise(async () => {
      const res = await web.handler(
        new Request(`http://slabwatch.test/api${path}`, {
          method: init.method ?? (init.body === undefined ? "GET" : "POST"),
          headers: {
            "content-type": "application/json",
            "x-real-ip": init.ip ?? "203.0.113.7",
            ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` })
          },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) })
        }),
        ctx as never
      )
      return { status: res.status, body: (await res.json()) as Record<string, any> }
    })
})

const signText = (wallet: KeyPairSigner, text: string) =>
  Effect.promise(async () =>
    Buffer.from(await signBytes(wallet.keyPair.privateKey, new TextEncoder().encode(text))).toString("base64")
  )

const signTx = (wallet: KeyPairSigner, wire: string) =>
  Effect.promise(async () => {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wire))
    return getBase64EncodedWireTransaction(await partiallySignTransaction([wallet.keyPair], tx))
  })

const counts = new Map<string, number>()
for (const l of seed.listings) counts.set(l.vaultItem.id, (counts.get(l.vaultItem.id) ?? 0) + 1)
const target = seed.listings.find((l) => l.trap === "none" && counts.get(l.vaultItem.id) === 1 && l.listing.currency === "USD")!

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("web api", (it) => {
  it.effect("signs in, makes a rule, funds the wallet, and pays for one signed purchase", () =>
    Effect.gen(function* () {
      const call = yield* api
      // The server does this at boot.
      yield* (yield* Treasury).setup
      const wallet = yield* Effect.promise(() => generateKeyPairSigner())

      const status = yield* call("/status")
      expect(status.body).toMatchObject({ payments: "devnet", readOnly: false })
      expect((yield* call("/me")).status).toBe(401)

      const start = yield* call("/auth/start", { body: { wallet: wallet.address } })
      expect(start.status).toBe(200)
      const signedIn = yield* call("/auth/finish", {
        body: { nonce: start.body["nonce"], signature: yield* signText(wallet, start.body["message"]) }
      })
      expect(signedIn.status).toBe(200)
      const token = signedIn.body["token"] as string

      // No model key in tests: drafting says so, but a rule can still be made from fields.
      expect((yield* call("/rules/draft", { token, body: { want: "a holo dragon, grade 9+" } })).status).toBe(503)
      const listing = (yield* CatalogRepo).getListing(target.listing.id)
      const view = (yield* listing)!
      const created = yield* call("/rules", {
        token,
        body: {
          rawWant: "this exact card",
          hard: {
            setId: view.setId,
            cardId: view.cardId,
            edition: view.edition,
            finish: view.finish,
            graders: [view.grader],
            minGrade: view.grade,
            maxPrice: view.price
          },
          softDescription: null,
          budget: { amountMinor: view.price.amountMinor * 2, currency: view.price.currency }
        }
      })
      expect(created.status).toBe(200)
      const ruleId = created.body["rule"]["id"] as string
      // Without the judge nothing becomes a match by itself; it waits for the collector.
      expect(created.body["unjudgedReason"]).toMatch(/no model API key/)

      const detail = yield* call(`/rules/${ruleId}`, { token })
      expect(detail.body["decisions"].map((d: any) => d.listingId)).toContain(view.listingId)
      const stranger = yield* Effect.promise(() => generateKeyPairSigner())
      const strangerStart = yield* call("/auth/start", { body: { wallet: stranger.address } })
      const strangerToken = (yield* call("/auth/finish", {
        body: { nonce: strangerStart.body["nonce"], signature: yield* signText(stranger, strangerStart.body["message"]) }
      })).body["token"] as string
      expect((yield* call(`/rules/${ruleId}`, { token: strangerToken })).status).toBe(404)

      const price = toUsdCents(view.price.amountMinor, view.price.currency)
      expect((yield* call("/wallet/faucet", { token, body: {} })).status).toBe(200)
      expect((yield* call("/wallet/faucet", { token, body: {} })).status).toBe(429)
      const allowance = yield* call("/wallet/allowance", { token, body: { amountUsd: price / 100 } })
      expect(allowance.status).toBe(200)
      const submitted = yield* call("/wallet/submit", {
        token,
        body: { transaction: yield* signTx(wallet, allowance.body["transaction"]) }
      })
      expect(submitted.status).toBe(200)
      const funds = (yield* call("/wallet/funds", { token })).body
      expect(funds).toMatchObject({ balanceUnits: "500000", allowanceUnits: String(price) })

      const proposed = yield* call("/purchases", { token, body: { ruleId, listingId: view.listingId } })
      expect(proposed.body).toMatchObject({ status: "proposed", next: "awaiting_collector_approval" })
      const purchaseId = proposed.body["purchaseId"] as string
      const approval = yield* call(`/purchases/${purchaseId}/approve/start`, { token, body: {} })
      expect(approval.body["message"]).toContain(purchaseId)
      const paid = yield* call(`/purchases/${purchaseId}/approve/finish`, {
        token,
        body: { nonce: approval.body["nonce"], signature: yield* signText(wallet, approval.body["message"]) }
      })
      expect(paid.body).toMatchObject({ status: "executed" })
      expect((yield* call("/wallet/funds", { token })).body["allowanceUnits"]).toBe("0")
    }))

  it.effect("rejects bad input and limits sign-in attempts per IP", () =>
    Effect.gen(function* () {
      const call = yield* api
      expect((yield* call("/auth/start", { body: { wallet: "nope" } })).status).toBe(400)
      expect((yield* call("/auth/start", { body: { nothing: true } })).status).toBe(400)
      let last = 0
      for (let i = 0; i < 31; i++) last = (yield* call("/auth/start", { body: { wallet: "nope" }, ip: "198.51.100.9" })).status
      expect(last).toBe(429)
    }))
})
