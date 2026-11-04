# Notes

Working notes, newest day last. The README is the summary; this file keeps the reasoning.

## Day 1

### Decisions

- **Code decides, the model narrows.** The hard filter, red flags and catalog id lookup are code. The judge only sees listings that already passed, and its verdict can only be stricter than code's. The matcher re-runs the TypeScript hard checks on every SQL candidate, and if the two ever disagree the result is a reject.
- **Names, not ids, from the model.** The want parser returns set and card names. Code resolves them, so a made-up id cannot reach a rule. Ambiguity becomes a question for the collector.
- **Red flags are warnings in v1.** They go to the judge as trusted context and do not reject on their own. Making them hard rejects is a candidate for the single v2 change, depending on what v1 shows.
- **Similarity runs against listing text in v1.** Seller text is noisy and can be written to game the embedding. Embedding the catalog entry instead is the other v2 candidate.
- **Prices compare only within a currency.** A rule in USD never matches a EUR listing, even when the number is smaller. Currency conversion is used for one thing only: the "too cheap against recent sales" flag.
- **Duplicate listings are allowed in the schema.** There is deliberately no unique index on `listings.vault_item_id`, so the same vault item can be listed twice and the red flag has something to catch.
- **Every eval run gets its own Postgres schema,** rebuilt from scratch, so runs never see demo data or each other.

### Things the tests caught

- The SQL versus TypeScript agreement test failed on its first run because migrations in a fresh schema were skipped: the migrator found `public`'s migrations table through the search path. Evals had been writing into the demo schema. The migrations table name is now schema-qualified, and the test runs in a throwaway schema.

### Open

- v1 eval with Haiku 5.5 and real embeddings. Needs an API key and network access to the embedding model host, which the first build session did not have.
- Pick the one v2 change after reading the v1 errors.
