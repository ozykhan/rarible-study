import { Layer } from "effect"
import { AgentLive } from "./agent/Agent.ts"
import { AgentTokensLive } from "./agent/AgentTokens.ts"
import { CatalogRepoLive } from "./catalog/CatalogRepo.ts"
import { AppConfigLive } from "./config.ts"
import { DatabaseLive } from "./db/Database.ts"
import { EmbedderLive } from "./embeddings/Embedder.ts"
import { LlmLive } from "./llm/Llm.ts"
import { MatcherLive } from "./matcher/Matcher.ts"
import { PurchasesLive } from "./purchases/Purchases.ts"
import { RuleParserLive } from "./rules/RuleParser.ts"
import { RuleRepoLive } from "./rules/RuleRepo.ts"
import { SearchServicePg } from "./search/SearchService.ts"
import type { Chain } from "./solana/Chain.ts"
import { CardTaggerLive } from "./tags/CardTagger.ts"
import { ChainLive, paymentsFor } from "./solana/PaymentsDevnet.ts"
import { WalletAuthLive } from "./wallet/WalletAuth.ts"
import { RateLimitsLive } from "./web/RateLimits.ts"

/**
 * How the app is wired. Each layer declares what it needs; Layer.provide
 * feeds the lower ones into the upper ones, and the compiler checks that
 * nothing is missing. Tests swap single layers (for example the embedder).
 */
export const BaseLive = Layer.mergeAll(DatabaseLive, EmbedderLive).pipe(Layer.provideMerge(AppConfigLive))

export const ReposLive = Layer.mergeAll(CatalogRepoLive, RuleRepoLive, SearchServicePg, LlmLive, AgentTokensLive, RateLimitsLive).pipe(
  Layer.provideMerge(BaseLive)
)

/**
 * Everything the app runs on. PAYMENTS picks a simulated ledger or devnet
 * transfers; the chain is a parameter so tests can run the devnet code
 * against an in-process Solana VM.
 */
export const makeAppLive = <E, R>(chain: Layer.Layer<Chain, E, R>) => {
  const Services = Layer.mergeAll(MatcherLive, RuleParserLive, PurchasesLive, CardTaggerLive).pipe(
    Layer.provideMerge(paymentsFor(chain)),
    Layer.provideMerge(ReposLive)
  )
  return Layer.mergeAll(AgentLive, WalletAuthLive).pipe(Layer.provideMerge(Services))
}

export const AppLive = makeAppLive(ChainLive)
