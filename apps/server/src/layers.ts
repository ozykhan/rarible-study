import { Layer } from "effect"
import { CatalogRepoLive } from "./catalog/CatalogRepo.ts"
import { AppConfigLive } from "./config.ts"
import { DatabaseLive } from "./db/Database.ts"
import { EmbedderLive } from "./embeddings/Embedder.ts"
import { LlmLive } from "./llm/Llm.ts"
import { MatcherLive } from "./matcher/Matcher.ts"
import { RuleParserLive } from "./rules/RuleParser.ts"
import { RuleRepoLive } from "./rules/RuleRepo.ts"

/**
 * How the app is wired. Each layer declares what it needs; Layer.provide
 * feeds the lower ones into the upper ones, and the compiler checks that
 * nothing is missing. Tests swap single layers (for example the embedder).
 */
export const BaseLive = Layer.mergeAll(DatabaseLive, EmbedderLive).pipe(Layer.provideMerge(AppConfigLive))

export const ReposLive = Layer.mergeAll(CatalogRepoLive, RuleRepoLive, LlmLive).pipe(Layer.provideMerge(BaseLive))

export const AppLive = Layer.mergeAll(MatcherLive, RuleParserLive).pipe(Layer.provideMerge(ReposLive))
