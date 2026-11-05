import { formatMoney, hardChecks, type ListingView, type RedFlag, type WatchRule } from "@slabwatch/domain"
import { toUsdCents } from "@slabwatch/seed"
import { describeFlag } from "../matcher/redFlags.ts"

/**
 * The purchase policy: plain code, no model involved. It runs when a purchase
 * is proposed and again, under a lock, right before money moves. Whatever the
 * agent was told or tricked into asking for, these checks decide.
 */
export type PolicyAction = "propose" | "execute"

export type PolicyCheckName =
  | "read_only"
  | "rule_allowed"
  | "rule_active"
  | "listing_exists"
  | "listing_matches_rule"
  | "no_red_flags"
  | "not_already_bought"
  | "rule_budget"
  | "daily_cap"
  | "authorized"

export interface PolicyCheck {
  readonly name: PolicyCheckName
  readonly pass: boolean
  readonly detail: string
}

/** How an execution is authorized. Proposals need none. */
export type Authorization =
  /** The collector signed a budget approval for this rule in auto mode, and it has not expired. */
  | "auto_approval"
  /** The collector approved this specific proposal. */
  | "collector_approved"
  | "none"

export interface PolicyInput {
  readonly action: PolicyAction
  readonly rule: WatchRule
  readonly listing: ListingView | null
  readonly redFlags: ReadonlyArray<RedFlag>
  /** Rule ids the caller (an agent run or an MCP token) may act for. */
  readonly allowedRuleIds: ReadonlySet<string>
  readonly readOnly: boolean
  /** Other live purchases (proposed, approved, executing or executed) of this listing. */
  readonly otherLivePurchases: number
  /** Executing and executed purchases on this rule, in the rule's currency. */
  readonly committedOnRuleMinor: number
  /** Executing and executed purchases today (UTC) by the same owner, in USD cents. */
  readonly committedTodayUsdCents: number
  readonly dailyCapUsdCents: number
  readonly authorization: Authorization
}

export interface PolicyResult {
  readonly allowed: boolean
  readonly checks: ReadonlyArray<PolicyCheck>
  /** Only the failed checks, as sentences for the agent and the collector. */
  readonly refusals: ReadonlyArray<string>
  /** True when the only thing missing is the collector's approval. */
  readonly waitingForApproval: boolean
}

const usd = (cents: number) => formatMoney({ amountMinor: cents, currency: "USD" })

export const checkPurchase = (input: PolicyInput): PolicyResult => {
  const { rule, listing } = input
  const checks: Array<PolicyCheck> = []
  const add = (name: PolicyCheckName, pass: boolean, detail: string) => checks.push({ name, pass, detail })

  add("read_only", !input.readOnly, input.readOnly ? "this demo is read-only: purchases are turned off" : "purchases are enabled")
  add(
    "rule_allowed",
    input.allowedRuleIds.has(rule.id),
    input.allowedRuleIds.has(rule.id) ? `rule ${rule.id} is on the allow-list` : `rule ${rule.id} is not on this caller's allow-list`
  )
  add("rule_active", rule.status === "active", `rule ${rule.id} is ${rule.status}`)

  if (listing === null) {
    add("listing_exists", false, "the listing does not exist")
  } else {
    const failed = hardChecks(rule.hard, listing).filter((c) => !c.pass)
    add(
      "listing_matches_rule",
      failed.length === 0,
      failed.length === 0
        ? "the listing meets every field of the rule"
        : failed.map((c) => `${c.field}: rule wants ${c.expected}, listing has ${c.actual}`).join("; ")
    )
    add(
      "no_red_flags",
      input.redFlags.length === 0,
      input.redFlags.length === 0 ? "no red flags" : input.redFlags.map((f) => describeFlag[f]).join("; ")
    )
    add(
      "not_already_bought",
      input.otherLivePurchases === 0,
      input.otherLivePurchases === 0 ? "no other purchase of this listing is in progress" : "this listing already has a live purchase"
    )
    const sameCurrency = listing.price.currency === rule.budget.currency
    const afterRule = input.committedOnRuleMinor + listing.price.amountMinor
    add(
      "rule_budget",
      sameCurrency && afterRule <= rule.budget.amountMinor,
      `${formatMoney({ amountMinor: input.committedOnRuleMinor, currency: rule.budget.currency })} already spent on this rule, ` +
        `this purchase would make ${formatMoney({ amountMinor: afterRule, currency: rule.budget.currency })} ` +
        `of a ${formatMoney(rule.budget)} budget`
    )
    const priceUsd = toUsdCents(listing.price.amountMinor, listing.price.currency)
    const afterDay = input.committedTodayUsdCents + priceUsd
    add(
      "daily_cap",
      afterDay <= input.dailyCapUsdCents,
      `${usd(input.committedTodayUsdCents)} spent today, this purchase would make ${usd(afterDay)} of a ${usd(input.dailyCapUsdCents)} daily cap`
    )
  }

  if (input.action === "execute") {
    const authorized = input.authorization !== "none"
    add(
      "authorized",
      authorized,
      input.authorization === "auto_approval"
        ? "the collector signed an auto-buy approval for this rule"
        : input.authorization === "collector_approved"
          ? "the collector approved this purchase"
          : rule.mode === "auto"
            ? "there is no unexpired auto-buy approval for this rule"
            : "the rule is in confirm mode and the collector has not approved this purchase yet"
    )
  }

  const failed = checks.filter((c) => !c.pass)
  return {
    allowed: failed.length === 0,
    checks,
    refusals: failed.map((c) => c.detail),
    waitingForApproval: failed.length === 1 && failed[0]?.name === "authorized" && rule.mode === "confirm"
  }
}
