import { Effect, Layer } from "effect"
import { AgentLive } from "./agent/Agent.ts"
import { AgentTokensLive } from "./agent/AgentTokens.ts"
import { CatalogRepoLive } from "./catalog/CatalogRepo.ts"
import { AppConfig, AppConfigLive } from "./config.ts"
import { DatabaseLive } from "./db/Database.ts"
import { EmbedderLive } from "./embeddings/Embedder.ts"
import { LlmLive } from "./llm/Llm.ts"
import { MatcherLive } from "./matcher/Matcher.ts"
import { PurchasesLive } from "./purchases/Purchases.ts"
import { RuleParserLive } from "./rules/RuleParser.ts"
import { RuleRepoLive } from "./rules/RuleRepo.ts"
import { CardFitLive } from "./search/CardFit.ts"
import { CardVectorsLive } from "./search/CardVectors.ts"
import { OpenSearchLive } from "./search/opensearch/OpenSearch.ts"
import { SearchServiceOpenSearch } from "./search/opensearch/SearchServiceOpenSearch.ts"
import { SearchServicePg } from "./search/SearchService.ts"
import { SearchUnderstandingLive } from "./search/SearchUnderstanding.ts"
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

/**
 * Market search on Postgres, or on the copy in OpenSearch when SEARCH_ENGINE
 * says so (for comparing the two locally; SearchSync keeps the copy current).
 */
export const SearchLive = Layer.unwrap(
  Effect.gen(function* () {
    const { searchEngine } = yield* AppConfig
    return searchEngine === "opensearch" ? SearchServiceOpenSearch.pipe(Layer.provide(OpenSearchLive)) : SearchServicePg
  })
)

export const ReposLive = Layer.mergeAll(CatalogRepoLive, RuleRepoLive, SearchLive, LlmLive, AgentTokensLive, RateLimitsLive).pipe(
  Layer.provideMerge(BaseLive)
)

/**
 * Everything the app runs on. PAYMENTS picks a simulated ledger or devnet
 * transfers; the chain is a parameter so tests can run the devnet code
 * against an in-process Solana VM.
 */
export const makeAppLive = <E, R>(chain: Layer.Layer<Chain, E, R>) => {
  const Services = Layer.mergeAll(
    MatcherLive,
    RuleParserLive,
    PurchasesLive,
    CardTaggerLive,
    CardVectorsLive,
    SearchUnderstandingLive,
    CardFitLive
  ).pipe(
    Layer.provideMerge(paymentsFor(chain)),
    Layer.provideMerge(ReposLive)
  )
  return Layer.mergeAll(AgentLive, WalletAuthLive).pipe(Layer.provideMerge(Services))
}

export const AppLive = makeAppLive(ChainLive)
