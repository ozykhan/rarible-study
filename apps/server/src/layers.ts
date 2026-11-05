import { Layer } from "effect"
import { AgentLive } from "./agent/Agent.ts"
import { AgentTokensLive } from "./agent/AgentTokens.ts"
import { CatalogRepoLive } from "./catalog/CatalogRepo.ts"
import { AppConfigLive } from "./config.ts"
import { DatabaseLive } from "./db/Database.ts"
import { EmbedderLive } from "./embeddings/Embedder.ts"
import { LlmLive } from "./llm/Llm.ts"
import { MatcherLive } from "./matcher/Matcher.ts"
import { PaymentsSimulated } from "./purchases/Payments.ts"
import { PurchasesLive } from "./purchases/Purchases.ts"
import { RuleParserLive } from "./rules/RuleParser.ts"
import { RuleRepoLive } from "./rules/RuleRepo.ts"

/**
 * How the app is wired. Each layer declares what it needs; Layer.provide
 * feeds the lower ones into the upper ones, and the compiler checks that
 * nothing is missing. Tests swap single layers (for example the embedder).
 */
export const BaseLive = Layer.mergeAll(DatabaseLive, EmbedderLive).pipe(Layer.provideMerge(AppConfigLive))

export const ReposLive = Layer.mergeAll(CatalogRepoLive, RuleRepoLive, LlmLive, AgentTokensLive).pipe(Layer.provideMerge(BaseLive))

/** Day 2 pays through a simulated ledger; day 3 swaps in the devnet layer here. */
export const PaymentsLive = PaymentsSimulated

export const ServicesLive = Layer.mergeAll(MatcherLive, RuleParserLive, PurchasesLive).pipe(
  Layer.provideMerge(PaymentsLive),
  Layer.provideMerge(ReposLive)
)

export const AppLive = AgentLive.pipe(Layer.provideMerge(ServicesLive))
