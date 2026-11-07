/**
 * The MCP endpoint end to end, through the official SDK client: bearer
 * tokens, which tools each token sees, untrusted seller text, and the
 * purchase policy behind the tools. Requests go straight into the Effect
 * router as web Requests, so no port is opened.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { expect, layer } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServer } from "effect/http"
import { SqlClient } from "effect/sql/SqlClient"
import { AgentTokens } from "../src/agent/AgentTokens.ts"
import { CatalogRepo } from "../src/catalog/CatalogRepo.ts"
import { McpRoute } from "../src/mcp/McpHttp.ts"
import { RuleRepo } from "../src/rules/RuleRepo.ts"
import { ruleFor } from "./rules.ts"
import { seed, testLayer } from "./db.ts"

const TestLive = testLayer("mcp", { PURCHASE_DAILY_CAP_USD: "100000" })

const web = HttpRouter.toWebHandler(McpRoute.pipe(Layer.provide(HttpServer.layerServices)), { disableLogger: true })

/** A fetch that hands the request to the router with the test's services. */
const fetchWith = Effect.gen(function* () {
  const ctx = yield* Effect.context<never>()
  return (url: string | URL, init?: RequestInit) => web.handler(new Request(url, init), ctx as never)
})

const connect = (token: string | null) =>
  Effect.gen(function* () {
    const fetch = yield* fetchWith
    const client = new Client({ name: "slabwatch-test", version: "0.0.0" })
    const transport = new StreamableHTTPClientTransport(new URL("http://slabwatch.test/mcp"), {
      fetch,
      requestInit: token === null ? {} : { headers: { authorization: `Bearer ${token}` } }
    })
    yield* Effect.acquireRelease(
      Effect.promise(() => client.connect(transport)),
      () => Effect.promise(() => client.close())
    )
    return client
  })

const call = (client: Client, name: string, args: Record<string, unknown>) =>
  Effect.promise(() => client.callTool({ name, arguments: args })).pipe(
    Effect.map((r) => {
      const text = (r.content as Array<{ type: string; text: string }>)[0]?.text ?? ""
      // The SDK itself answers unknown tools and schema failures, in plain text.
      let body: Record<string, any>
      try {
        body = JSON.parse(text) as Record<string, any>
      } catch {
        body = { error: text }
      }
      return { isError: r.isError === true, body }
    })
  )

const cleanListing = seed.listings.find(
  (l) => l.trap === "none" && l.listing.currency === "USD" && seed.listings.filter((x) => x.vaultItem.id === l.vaultItem.id).length === 1
)
const injected = seed.listings.find((l) => l.trap === "injection")

layer(TestLive, { timeout: "120 seconds", excludeTestServices: true })("MCP endpoint", (it) => {
  it.effect("refuses requests without a valid bearer token", () =>
    Effect.gen(function* () {
      const fetch = yield* fetchWith
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
      const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" }
      const none = yield* Effect.promise(() => fetch("http://slabwatch.test/mcp", { method: "POST", body, headers }))
      expect(none.status).toBe(401)
      expect(none.headers.get("www-authenticate")).toMatch(/Bearer/)
      const wrong = yield* Effect.promise(() =>
        fetch("http://slabwatch.test/mcp", { method: "POST", body, headers: { ...headers, authorization: "Bearer swt_not-a-real-token" } })
      )
      expect(wrong.status).toBe(401)

      const tokens = yield* AgentTokens
      const minted = yield* tokens.mint({ label: "revoked", allowedRuleIds: [], canExecute: false })
      yield* tokens.revoke(minted.id)
      const revoked = yield* Effect.promise(() =>
        fetch("http://slabwatch.test/mcp", { method: "POST", body, headers: { ...headers, authorization: `Bearer ${minted.token}` } })
      )
      expect(revoked.status).toBe(401)
    }))

  it.effect("a token without execute rights never sees execute_purchase", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const tokens = yield* AgentTokens
        const proposeOnly = yield* tokens.mint({ label: "propose", allowedRuleIds: [], canExecute: false })
        const full = yield* tokens.mint({ label: "full", allowedRuleIds: [], canExecute: true })
        const a = yield* connect(proposeOnly.token)
        const b = yield* connect(full.token)
        const names = (c: Client) => Effect.promise(() => c.listTools()).pipe(Effect.map((r) => r.tools.map((t) => t.name).sort()))
        expect(yield* names(a)).toEqual(["get_listing", "get_price_history", "propose_purchase", "search_listings"])
        expect(yield* names(b)).toEqual(["execute_purchase", "get_listing", "get_price_history", "propose_purchase", "search_listings"])
        const sneaky = yield* call(a, "execute_purchase", { purchase_id: "P-anything" })
        expect(sneaky.isError).toBe(true)
        expect(sneaky.body["error"]).toMatch(/not found|not available/)
        expect(a.getInstructions()).toMatch(/untrusted/)
      })
    ))

  it.effect("search leaves seller text out; get_listing returns it marked untrusted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        if (injected === undefined) throw new Error("the seed has no injection listing")
        const tokens = yield* AgentTokens
        const t = yield* tokens.mint({ label: "reader", allowedRuleIds: [], canExecute: false })
        const client = yield* connect(t.token)
        const sql = yield* SqlClient
        // The market's tags for the card, which search finds it by, reach the agent with the catalog's facts.
        yield* sql`UPDATE cards SET tags = '{animal,armored}' WHERE id = ${injected.vaultItem.cardId}`
        const found = yield* call(client, "search_listings", { card_id: injected.vaultItem.cardId, limit: 20 })
        expect(found.isError).toBe(false)
        expect(found.body["count"]).toBeGreaterThan(0)
        expect(JSON.stringify(found.body)).not.toContain(injected.listing.description)
        for (const l of found.body["listings"]) expect(l["described_as"]).toEqual(["animals", "armored"])
        const one = yield* call(client, "get_listing", { listing_id: injected.listing.id })
        expect(one.body["seller_text"]).toMatchObject({ trusted: false, description: injected.listing.description })
        expect(one.body["catalog_card"]["kinds"].length).toBeGreaterThan(0)
        expect(one.body["catalog_card"]["described_as"]).toEqual(["animals", "armored"])
        yield* sql`UPDATE cards SET tags = '{}' WHERE id = ${injected.vaultItem.cardId}`
        const untagged = yield* call(client, "get_listing", { listing_id: injected.listing.id })
        expect(untagged.body["catalog_card"]["described_as"]).toEqual([])
        const bad = yield* call(client, "get_listing", { listing_id: "" })
        expect(bad.isError).toBe(true)
      })
    ))

  it.effect("purchases go through the same policy: allow-list, then confirm mode", () =>
    Effect.scoped(
      Effect.gen(function* () {
        if (cleanListing === undefined) throw new Error("the seed has no clean listing")
        const catalog = yield* CatalogRepo
        const rules = yield* RuleRepo
        const sql = yield* SqlClient
        const listing = yield* catalog.getListing(cleanListing.listing.id)
        if (listing === null) throw new Error("missing listing")
        const mine = ruleFor(listing)
        const theirs = ruleFor(listing)
        yield* rules.insert({ rule: mine, softEmbedding: null })
        yield* rules.insert({ rule: theirs, softEmbedding: null })

        const tokens = yield* AgentTokens
        const t = yield* tokens.mint({ label: "buyer", allowedRuleIds: [mine.id], canExecute: true })
        const client = yield* connect(t.token)
        expect(client.getInstructions()).toContain(mine.id)

        const other = yield* call(client, "propose_purchase", { rule_id: theirs.id, listing_id: listing.listingId, reason: "x" })
        expect(other.body).toMatchObject({ status: "refused" })
        expect(other.body["refusals"].join(" ")).toMatch(/allow-list/)

        const proposed = yield* call(client, "propose_purchase", { rule_id: mine.id, listing_id: listing.listingId, reason: "fits" })
        expect(proposed.body).toMatchObject({ status: "proposed" })
        expect(proposed.body["next"]).toMatch(/collector has to approve/)
        const executed = yield* call(client, "execute_purchase", { purchase_id: proposed.body["purchase_id"] })
        expect(executed.body).toMatchObject({ status: "awaiting_collector_approval" })

        const rows = yield* sql<{ readonly actor: string; readonly status: string }>`
          SELECT actor, status FROM purchases WHERE rule_id IN (${mine.id}, ${theirs.id}) ORDER BY created_at`
        expect(rows).toEqual([
          { actor: `mcp:${t.id}`, status: "refused" },
          { actor: `mcp:${t.id}`, status: "proposed" }
        ])
      })
    ))
})
