import { money, type WatchRule } from "@slabwatch/domain"
import { describe, expect, it } from "@effect/vitest"
import { checkDirectPurchase, checkPurchase, type DirectPolicyInput, type PolicyInput } from "../src/purchases/policy.ts"
import { listing, rule as hard } from "./fixtures.ts"

const rule = (over: Partial<WatchRule> = {}): WatchRule => ({
  id: "R1",
  ownerWallet: "wallet-1",
  rawWant: "test",
  hard: hard(),
  softDescription: null,
  budget: money(300_000, "USD"),
  mode: "confirm",
  status: "active",
  ...over
})

const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  action: "propose",
  rule: rule(),
  listing: listing(),
  redFlags: [],
  allowedRuleIds: new Set(["R1"]),
  readOnly: false,
  otherLivePurchases: 0,
  committedOnRuleMinor: 0,
  committedTodayUsdCents: 0,
  dailyCapUsdCents: 500_000,
  authorization: "none",
  ...over
})

const failed = (over: Partial<PolicyInput>) =>
  checkPurchase(input(over))
    .checks.filter((c) => !c.pass)
    .map((c) => c.name)

describe("purchase policy", () => {
  it("allows a proposal that passes every check", () => {
    expect(checkPurchase(input()).allowed).toBe(true)
  })

  it.each([
    ["read_only", { readOnly: true }],
    ["rule_allowed", { allowedRuleIds: new Set(["R2"]) }],
    ["rule_active", { rule: rule({ status: "paused" }) }],
    ["listing_exists", { listing: null }],
    ["listing_matches_rule", { listing: listing({ grade: 8 }) }],
    ["no_red_flags", { redFlags: ["duplicate_vault_item" as const] }],
    ["not_already_bought", { otherLivePurchases: 1 }],
    ["rule_budget", { committedOnRuleMinor: 150_001 }],
    ["daily_cap", { committedTodayUsdCents: 350_001 }]
  ] satisfies ReadonlyArray<readonly [string, Partial<PolicyInput>]>)("refuses on %s", (name, over) => {
    expect(failed(over)).toEqual([name])
  })

  it("lets a purchase use the budget exactly, and not a cent more", () => {
    expect(failed({ committedOnRuleMinor: 150_000 })).toEqual([])
    expect(failed({ committedOnRuleMinor: 150_001 })).toEqual(["rule_budget"])
  })

  it("never counts a budget in one currency against a price in another", () => {
    const eur = rule({ budget: money(10_000_000, "EUR") })
    expect(failed({ rule: eur })).toContain("rule_budget")
  })

  it("compares the daily cap in USD across currencies", () => {
    const jpyRule = rule({ hard: hard({ maxPrice: money(300_000, "JPY") }), budget: money(1_000_000, "JPY") })
    // 150,000 JPY is $1,000 at the fixed rate.
    const jpy = listing({ price: money(150_000, "JPY") })
    expect(failed({ rule: jpyRule, listing: jpy, dailyCapUsdCents: 99_999 })).toEqual(["daily_cap"])
    expect(failed({ rule: jpyRule, listing: jpy, dailyCapUsdCents: 100_000 })).toEqual([])
  })

  it("needs authorization to execute, and says when only the collector's approval is missing", () => {
    const confirm = checkPurchase(input({ action: "execute" }))
    expect(confirm.allowed).toBe(false)
    expect(confirm.waitingForApproval).toBe(true)
    const auto = checkPurchase(input({ action: "execute", rule: rule({ mode: "auto" }) }))
    expect(auto.waitingForApproval).toBe(false)
    expect(auto.refusals.join(" ")).toMatch(/no unexpired auto-buy approval/)
    expect(checkPurchase(input({ action: "execute", authorization: "collector_approved" })).allowed).toBe(true)
  })

  it("reports every failed check at once, not just the first", () => {
    expect(failed({ readOnly: true, redFlags: ["price_far_below_market"], otherLivePurchases: 2 })).toEqual([
      "read_only",
      "no_red_flags",
      "not_already_bought"
    ])
  })
})

const direct = (over: Partial<DirectPolicyInput> = {}): DirectPolicyInput => ({
  action: "propose",
  listing: listing(),
  redFlags: [],
  readOnly: false,
  otherLivePurchases: 0,
  committedTodayUsdCents: 0,
  dailyCapUsdCents: 500_000,
  authorization: "none",
  ...over
})

const failedDirect = (over: Partial<DirectPolicyInput>) =>
  checkDirectPurchase(direct(over))
    .checks.filter((c) => !c.pass)
    .map((c) => c.name)

describe("direct buy policy", () => {
  it("allows a proposal that passes every check, with no rule involved", () => {
    const result = checkDirectPurchase(direct())
    expect(result.allowed).toBe(true)
    expect(result.checks.map((c) => c.name)).not.toContain("rule_allowed")
  })

  it.each([
    ["read_only", { readOnly: true }],
    ["listing_exists", { listing: null }],
    ["listing_active", { listing: listing({ status: "sold" }) }],
    ["no_red_flags", { redFlags: ["grade_claim_mismatch" as const] }],
    ["not_already_bought", { otherLivePurchases: 1 }],
    ["daily_cap", { committedTodayUsdCents: 350_001 }]
  ] satisfies ReadonlyArray<readonly [string, Partial<DirectPolicyInput>]>)("refuses on %s", (name, over) => {
    expect(failedDirect(over)).toEqual([name])
  })

  it("executes only on the collector's own signature, never on an auto-buy approval", () => {
    const unsigned = checkDirectPurchase(direct({ action: "execute" }))
    expect(unsigned.allowed).toBe(false)
    expect(unsigned.waitingForApproval).toBe(true)
    expect(failedDirect({ action: "execute", authorization: "auto_approval" })).toEqual([
      "authorized"
    ])
    expect(checkDirectPurchase(direct({ action: "execute", authorization: "collector_approved" })).allowed).toBe(true)
  })
})
