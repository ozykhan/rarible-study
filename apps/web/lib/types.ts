export type Currency = "USD" | "EUR" | "JPY"
export interface Money {
  readonly amountMinor: number
  readonly currency: Currency
}

export interface Status {
  readonly network: string
  readonly payments: "simulated" | "devnet"
  readonly readOnly: boolean
  readonly agentEnabled: boolean
  readonly modelConfigured: boolean
  readonly llm: { readonly model: string; readonly dailyCapUsd: number; readonly spentTodayUsd: number }
  readonly purchaseDailyCapUsd: number
  readonly faucetUsd: number
  readonly devnet: { readonly mint: string; readonly escrowAccount: string; readonly delegate: string; readonly treasury: string } | null
}

export interface SigningRequest {
  readonly nonce: string
  readonly message: string
  readonly expiresAt: string
}

export interface Funds {
  readonly wallet: string
  readonly tokenAccount: string
  readonly tokenAccountExists: boolean
  readonly balanceUnits: string
  readonly allowanceUnits: string
  readonly lamports: string
}

export interface HardCriteria {
  readonly setId: string | null
  readonly cardId: string | null
  readonly edition: "first" | "unlimited" | "any"
  readonly finish: "holo" | "non_holo" | "reverse_holo" | "any"
  readonly graders: ReadonlyArray<string>
  readonly minGrade: number
  readonly maxPrice: Money
}

export interface Rule {
  readonly id: string
  readonly ownerWallet: string | null
  readonly rawWant: string
  readonly hard: HardCriteria
  readonly softDescription: string | null
  readonly budget: Money
  readonly mode: "confirm" | "auto"
  readonly status: "draft" | "active" | "paused" | "exhausted"
  readonly setName: string | null
  readonly cardName: string | null
}

export interface Draft {
  readonly draft: {
    readonly rawWant: string
    readonly hard: HardCriteria
    readonly softDescription: string | null
    readonly questions: ReadonlyArray<string>
  }
  readonly setName: string | null
  readonly cardName: string | null
}

export interface Listing {
  readonly listingId: string
  readonly setId?: string
  readonly cardId?: string
  readonly setName: string
  readonly cardName: string
  readonly cardNumber: string
  readonly edition: string
  readonly finish: string
  readonly grader: string
  readonly grade: number
  readonly certNumber: string
  readonly price: Money
  readonly sellerHandle: string
  readonly title: string
  readonly description: string
  readonly status: "active" | "sold" | "withdrawn"
  readonly listedAt: string
  /** On the market list only: what the listing costs in dUSD units (cents), the amount checkout funds and pays. */
  readonly payUnits?: number
  /** On the market list only: the code's red flags. A flagged listing cannot be bought directly. */
  readonly redFlags?: ReadonlyArray<RedFlag>
}

/** How many listings are active and the lowest price in dUSD units, across the market and per set id. */
export interface MarketStats {
  readonly count: number
  readonly floorUnits: number | null
  readonly sets: Readonly<Record<string, { readonly count: number; readonly floorUnits: number | null }>>
}

/** What the set tabs count: listings that match the search and grader, in all and per set id. */
export interface MarketCounts {
  readonly all: number
  readonly sets: Readonly<Record<string, number>>
}

/** GET /listings: one page for the filters, how many match them, the tab counts and the whole market's stats. */
export interface MarketResponse {
  readonly listings: ReadonlyArray<Listing>
  readonly total: number
  readonly counts: MarketCounts
  readonly stats: MarketStats
}

export type RedFlag = "duplicate_vault_item" | "price_far_below_market" | "grade_claim_mismatch"

export interface Decision {
  readonly listingId: string
  readonly verdict: "match" | "reject" | "needs_review"
  readonly decidedAt: string
  readonly reasons: ReadonlyArray<string>
  readonly redFlags: ReadonlyArray<string>
  readonly similarity: number | null
  readonly listing: Listing | null
}

export interface Purchase {
  readonly id: string
  readonly listingId: string
  readonly actor: string
  readonly price: Money
  readonly status: "proposed" | "approved" | "executing" | "executed" | "failed" | "refused"
  readonly reason: string | null
  readonly refusals: ReadonlyArray<string>
  readonly txSignature: string | null
}

export interface AgentRun {
  readonly id: string
  readonly listingId: string | null
  readonly trigger: string
  readonly status: string
  readonly outcome: string | null
  readonly modelCalls: number
  readonly toolCalls: number
  readonly startedAt: string
  readonly finalText: string
}

export interface RuleDetail {
  readonly rule: Rule
  readonly approvals: ReadonlyArray<{ readonly id: string; readonly dailyCapUsdCents: number; readonly expiresAt: string }>
  readonly decisions: ReadonlyArray<Decision>
  readonly purchases: ReadonlyArray<Purchase>
  readonly runs: ReadonlyArray<AgentRun>
}

/** One purchase paid from the signed-in wallet: a direct buy (no rule) or one made for a watch rule. */
export interface MyPurchase {
  readonly id: string
  readonly ruleId: string | null
  readonly listingId: string
  readonly price: Money
  readonly status: Purchase["status"]
  readonly txSignature: string | null
}

export type ProposeResult =
  | { readonly status: "proposed"; readonly purchaseId: string; readonly price: Money; readonly next: string }
  | { readonly status: "refused"; readonly purchaseId: string | null; readonly refusals: ReadonlyArray<string> }

export type ExecuteResult =
  | { readonly status: "executed"; readonly purchaseId: string; readonly txSignature: string }
  | { readonly status: "awaiting_collector_approval"; readonly purchaseId: string }
  | { readonly status: "refused"; readonly purchaseId: string; readonly refusals: ReadonlyArray<string> }
  | { readonly status: "failed"; readonly purchaseId: string; readonly error: string }
