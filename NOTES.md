# Notes

Working notes, newest day last. The README is the summary; this file keeps the reasoning.

## Day 1

### Decisions

- **Code decides, the model narrows.** The hard filter, red flags and catalog id lookup are code. The judge only sees listings that already passed, and its verdict can only be stricter than code's. The matcher re-runs the TypeScript hard checks on every SQL candidate, and if the two ever disagree the result is a reject.
- **Names, not ids, from the model.** The want parser returns set and card names. Code resolves them, so a made-up id cannot reach a rule. Ambiguity becomes a question for the collector.
- **Red flags are warnings in v1.** They go to the judge as trusted context and do not reject on their own. v1 showed why that is not enough (below).
- **Similarity runs against listing text in v1.** Seller text is noisy and can be written to game the embedding. Embedding the catalog entry instead is the other v2 candidate.
- **Prices compare only within a currency.** A rule in USD never matches a EUR listing, even when the number is smaller. Currency conversion is used for one thing only: the "too cheap against recent sales" flag.
- **Duplicate listings are allowed in the schema.** There is deliberately no unique index on `listings.vault_item_id`, so the same vault item can be listed twice and the red flag has something to catch.
- **Every eval run gets its own Postgres schema,** rebuilt from scratch, so runs never see demo data or each other.

### Things the tests caught

- The SQL versus TypeScript agreement test failed on its first run because migrations in a fresh schema were skipped: the migrator found `public`'s migrations table through the search path. Evals had been writing into the demo schema. The migrations table name is now schema-qualified, and the test runs in a throwaway schema.

### v1 results and the v2 choice

v1: precision 81.8%, recall 94.7%, 8 needs review, 3 of 40 trap listings wrongly matched, 0 of 4 harmful injection changes, want parsing 40 of 40 fields right, 44 model calls for $0.0083.

The five errors:

- R1 / E08b and R5 / E50a, duplicate vault items. Both carried the `duplicate_vault_item` warning. On E08b the judge called it "a system note" that "does not change the match". On E50a it did not mention the warning.
- R1 / E09 and R5 / E09, the same listing priced at about a quarter of recent sales. It carried `price_far_below_market`. The judge called it "a reason for caution but not a text-based issue".
- R4 / E32, a miss. Coralbloom is listed as plant and water type, and the judge decided a flowering coral is not "a water creature". A reasonable person could label this either way. The label stays as written, since tuning the prompt for one arguable case would be fitting the eval.

So the problem is not the model reading the text badly. It is that the prompt asks the judge only about the soft match and the seller text, and code's warnings ride along as context the judge is free to discount. Two candidate fixes:

1. Make the warnings binding in code: a red flag caps the verdict at needs review.
2. Rewrite the judge prompt to take the warnings seriously.

Option 2 would still leave a code-detected risk to a model's judgment, which is the pattern the rest of the design avoids. v2 is option 1, with nothing else changed: same prompt, same similarity settings, same model.

Why needs review and not reject: a duplicate or a cheap price is a reason for a person to look, not proof of fraud. Needs review keeps the listing visible to the collector with the warning, and it is never auto-bought. None of the 19 positive labels carries a red flag, so the change should not cost recall.

Latency and cost are recorded per call in `llm_calls`. For v1: 39 judge calls at 1.6 s mean and 2.3 s p95 latency, 5 parse calls.

### Open

- v2 eval run, same environment as v1.
