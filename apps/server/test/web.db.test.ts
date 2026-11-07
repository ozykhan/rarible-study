/**
 * The web app's API end to end, the way the browser uses it: sign in with
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
import { SqlClient } from "effect/sql/SqlClient"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { Purchases } from "../src/purchases/Purchases.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { Treasury } from "../src/solana/Treasury.ts"
import { WebApiRoutes } from "../src/web/WebApi.ts"
import { seed, testLayer } from "./db.ts"
import { ruleFor } from "./rules.ts"

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

const signIn = (call: Effect.Success<typeof api>, wallet: KeyPairSigner, ip?: string) =>
  Effect.gen(function* () {
    const start = yield* call("/auth/start", { body: { wallet: wallet.address }, ...(ip ? { ip } : {}) })
    const done = yield* call("/auth/finish", {
      body: { nonce: start.body["nonce"], signature: yield* signText(wallet, start.body["message"]) },
      ...(ip ? { ip } : {})
    })
    return done.body["token"] as string
  })

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

      // A search with words nothing matches says which ones, and reading it needs a model this server lacks.
      const vague = (yield* call("/listings?q=a%20wibbly%20thing%20from%20the%20ocean")).body
      expect(vague).toMatchObject({
        total: 0,
        unknown: ["wibbly"],
        chips: [
          { label: "sea creatures", q: "wibbly" },
          { label: '"wibbly"', q: "ocean" }
        ]
      })
      expect((yield* call("/search/understand?q=a%20wibbly%20thing%20from%20the%20ocean")).body).toEqual({ status: "unavailable", reason: "no_key" })
      expect((yield* call("/search/understand?q=ashen%20wyrm")).body).toEqual({ status: "not_needed" })

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

  it.effect("buys a listing directly, with no rule, on the buyer's own signature", () =>
    Effect.gen(function* () {
      const call = yield* api
      yield* (yield* Treasury).setup
      const buyer = yield* Effect.promise(() => generateKeyPairSigner())
      const stranger = yield* Effect.promise(() => generateKeyPairSigner())
      const token = yield* signIn(call, buyer)
      const strangerToken = yield* signIn(call, stranger)

      // The market list carries what checkout needs: the dUSD amount and the code's red flags.
      const market = (yield* call("/listings")).body
      const listed = market["listings"] as ReadonlyArray<Record<string, any>>
      // The counts cover every active listing, not only the 40 sent in full.
      expect(market["stats"]["count"]).toBeGreaterThan(listed.length)
      expect(market["stats"]["floorUnits"]).toBeLessThanOrEqual(Math.min(...listed.map((l) => l["payUnits"])))
      expect(Object.keys(market["stats"]["sets"]).sort()).toEqual(["EF", "OS", "SE", "TW"])
      expect(market["total"]).toBe(market["stats"]["count"])

      // A filtered page: one set, cheapest first, paged; the tabs still count every set.
      const ef = (yield* call("/listings?set=EF&sort=price_asc&limit=5&offset=2")).body
      const efListed = ef["listings"] as ReadonlyArray<Record<string, any>>
      expect(efListed.length).toBe(5)
      expect(efListed.every((l) => l["setId"] === "EF")).toBe(true)
      expect(efListed.map((l) => l["payUnits"])).toEqual([...efListed.map((l) => l["payUnits"])].sort((a, b) => a - b))
      expect(ef["total"]).toBe(market["stats"]["sets"]["EF"]["count"])
      expect(ef["counts"]["sets"]["OS"]).toBe(market["stats"]["sets"]["OS"]["count"])
      expect(efListed[0]!["payUnits"]).toBeGreaterThanOrEqual(market["stats"]["sets"]["EF"]["floorUnits"])
      const item = listed.find((l) => l["redFlags"].length === 0 && l["price"]["currency"] === "EUR")!
      const price = toUsdCents(item["price"]["amountMinor"], "EUR")
      expect(item["payUnits"]).toBe(price)
      const flagged = listed.find((l) => l["redFlags"].length > 0)!
      expect(flagged).toBeDefined()

      // One listing by id, as the listing page reads it: the same amount and flags as the market list.
      const one = (yield* call(`/listings/${item["listingId"]}`)).body["listing"]
      expect(one).toMatchObject({ listingId: item["listingId"], status: "active", payUnits: price, redFlags: [] })
      expect((yield* call(`/listings/${flagged["listingId"]}`)).body["listing"]["redFlags"]).toEqual(flagged["redFlags"])
      expect((yield* call("/listings/L-NOPE")).status).toBe(404)

      expect((yield* call("/purchases/direct", { body: { listingId: item["listingId"] } })).status).toBe(401)
      const refused = yield* call("/purchases/direct", { token, body: { listingId: flagged["listingId"] } })
      expect(refused.body["status"]).toBe("refused")
      expect(refused.body["refusals"].length).toBeGreaterThan(0)

      expect((yield* call("/wallet/faucet", { token, body: {} })).status).toBe(200)
      const allowance = yield* call("/wallet/allowance", { token, body: { amountUsd: price / 100 } })
      yield* call("/wallet/submit", { token, body: { transaction: yield* signTx(buyer, allowance.body["transaction"]) } })

      const proposed = yield* call("/purchases/direct", { token, body: { listingId: item["listingId"] } })
      expect(proposed.body).toMatchObject({ status: "proposed", next: "awaiting_collector_approval" })
      const purchaseId = proposed.body["purchaseId"] as string
      // Asking again before signing (say, after closing the wallet) picks up the same purchase.
      const retry = yield* call("/purchases/direct", { token, body: { listingId: item["listingId"] } })
      expect(retry.body["purchaseId"]).toBe(purchaseId)
      // One live purchase per listing, direct or not.
      const again = yield* call("/purchases/direct", { token: strangerToken, body: { listingId: item["listingId"] } })
      expect(again.body["refusals"].join(" ")).toMatch(/already has a live purchase/)

      // Nobody else can sign it, and no agent or MCP caller can execute it.
      expect((yield* call(`/purchases/${purchaseId}/approve/start`, { token: strangerToken, body: {} })).status).toBe(404)
      const byAgent = yield* (yield* Purchases).execute({ actor: "agent:run-1", allowedRuleIds: new Set(), runId: null }, purchaseId)
      expect(byAgent).toMatchObject({ status: "refused" })

      const approval = yield* call(`/purchases/${purchaseId}/approve/start`, { token, body: {} })
      expect(approval.body["message"]).toContain("Rule: none (a direct buy)")
      const paid = yield* call(`/purchases/${purchaseId}/approve/finish`, {
        token,
        body: { nonce: approval.body["nonce"], signature: yield* signText(buyer, approval.body["message"]) }
      })
      expect(paid.body).toMatchObject({ status: "executed" })
      const funds = (yield* call("/wallet/funds", { token })).body
      expect(funds).toMatchObject({ balanceUnits: String(500_000 - price), allowanceUnits: "0" })

      // The refused attempt on the flagged listing stays on record next to the purchase.
      const mine = (yield* call("/me/purchases", { token })).body["purchases"] as ReadonlyArray<Record<string, any>>
      expect(mine.map((p) => [p["listingId"], p["status"]])).toEqual(
        expect.arrayContaining([
          [item["listingId"], "executed"],
          [flagged["listingId"], "refused"]
        ])
      )
      expect(mine.every((p) => p["ruleId"] === null)).toBe(true)
      const theirs = (yield* call("/me/purchases", { token: strangerToken })).body["purchases"] as ReadonlyArray<Record<string, any>>
      expect(theirs.map((p) => p["status"])).toEqual(["refused"])
      // Sold listings leave the market.
      const after = (yield* call("/listings")).body["listings"] as ReadonlyArray<Record<string, any>>
      expect(after.map((l) => l["listingId"])).not.toContain(item["listingId"])
      // Its page stays, and says it sold.
      expect((yield* call(`/listings/${item["listingId"]}`)).body["listing"]["status"]).toBe("sold")
    }))

  it.effect("lets an unsigned direct buy lapse, so it cannot hold a listing", () =>
    Effect.gen(function* () {
      const call = yield* api
      const sql = yield* SqlClient
      const first = yield* Effect.promise(() => generateKeyPairSigner())
      const second = yield* Effect.promise(() => generateKeyPairSigner())
      const firstToken = yield* signIn(call, first, "203.0.113.20")
      const secondToken = yield* signIn(call, second, "203.0.113.21")
      const listed = (yield* call("/listings")).body["listings"] as ReadonlyArray<Record<string, any>>
      const item = listed.find((l) => l["redFlags"].length === 0)!

      const held = yield* call("/purchases/direct", { token: firstToken, body: { listingId: item["listingId"] } })
      expect(held.body["status"]).toBe("proposed")
      expect((yield* call("/purchases/direct", { token: secondToken, body: { listingId: item["listingId"] } })).body["status"]).toBe(
        "refused"
      )

      yield* sql`UPDATE purchases SET created_at = now() - interval '11 minutes' WHERE id = ${held.body["purchaseId"]}`
      const taken = yield* call("/purchases/direct", { token: secondToken, body: { listingId: item["listingId"] } })
      expect(taken.body["status"]).toBe("proposed")
      const late = yield* call(`/purchases/${held.body["purchaseId"]}/approve/start`, { token: firstToken, body: {} })
      expect(late.status).toBe(409)
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

  it.effect("checks chat messages, and shows chat turns and older runs in the watch's log", () =>
    Effect.gen(function* () {
      const call = yield* api
      const sql = yield* SqlClient
      const rules = yield* RuleRepo
      const catalog = yield* CatalogRepo
      const wallet = yield* Effect.promise(() => generateKeyPairSigner())
      const token = yield* signIn(call, wallet, "192.0.2.44")
      const listing = (yield* catalog.getListing(target.listing.id))!
      const mine = ruleFor(listing, { ownerWallet: wallet.address })
      const theirs = ruleFor(listing)
      yield* rules.insert({ rule: mine, softEmbedding: null })
      yield* rules.insert({ rule: theirs, softEmbedding: null })
      const ask = (ruleId: string, message: unknown, withToken = true) =>
        call(`/rules/${ruleId}/chat`, { body: { message }, ip: "192.0.2.44", ...(withToken ? { token } : {}) })

      expect((yield* ask(mine.id, "Is this fair?", false)).status).toBe(401)
      expect((yield* ask(theirs.id, "Is this fair?")).status).toBe(404)
      expect((yield* ask(mine.id, "   ")).status).toBe(400)
      expect((yield* ask(mine.id, "x".repeat(501))).status).toBe(400)
      expect((yield* ask(mine.id, 42)).status).toBe(400)
      const noKey = yield* ask(mine.id, "Is this fair?")
      expect(noKey).toEqual({ status: 503, body: { error: "no model API key is configured on this server" } })

      // A chat turn keeps its question and final text; a run saved before final_text existed still shows its last words.
      yield* sql`
        INSERT INTO agent_runs (id, rule_id, listing_id, trigger, status, outcome, transcript, started_at)
        VALUES ('A-old', ${mine.id}, ${listing.listingId}, 'new_match', 'done', 'proposed',
                ${JSON.stringify([{ role: "assistant", content: [{ type: "text", text: "Proposed it." }] }])}::jsonb, now() - interval '1 minute')`
      yield* sql`
        INSERT INTO agent_runs (id, rule_id, listing_id, trigger, status, outcome, question, final_text)
        VALUES ('A-chat', ${mine.id}, NULL, 'chat', 'done', 'answered', 'Is this fair?', 'Yes, it is near the median.')`
      const detail = yield* call(`/rules/${mine.id}`, { token, ip: "192.0.2.44" })
      expect(detail.body["runs"]).toMatchObject([
        { id: "A-chat", trigger: "chat", question: "Is this fair?", finalText: "Yes, it is near the median.", listingId: null },
        { id: "A-old", trigger: "new_match", question: null, finalText: "Proposed it.", listingId: listing.listingId }
      ])
    }))
})
