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

### v2 result

v2: precision 100.0%, recall 94.7%, 12 needs review, 0 of 40 trap listings wrongly matched, 0 of 4 harmful injection changes, want parsing 40 of 40, 44 calls for $0.0083.

The four v1 false positives (R1 / E08b, R1 / E09, R5 / E09, R5 / E50a) all became needs review. True positives stayed at 18 and no new errors appeared. R4 / E32 is still the only error. Injection results did not change: 2 of 4 verdicts changed, both toward needs review, and 1 injected listing was stopped by code.

The caveat: the change was chosen by reading v1's errors on this same set of 57 listings, and each version ran once. The result shows the fix works as intended on the cases that motivated it. A fresh labelled set would be needed to estimate precision on listings the pipeline has never seen.

## Day 2

### Decisions

- **One tool layer.** The MCP server and the in-process agent call the same `runTool`, so they share input validation (zod, because the MCP SDK takes zod), output shape and the purchase policy. The same zod schemas produce the JSON Schema the model sees.
- **The policy is a pure function** from facts to a list of checks. It returns every failure at once, which makes refusals readable for the model and the collector, and lets the unit tests cover each check, the exact budget edge, a currency mismatch and a JPY daily cap without a database.
- **Execution re-reads everything.** Proposing records intent; executing locks the purchase row, takes an advisory lock on the owner's wallet, reads the listing, red flags, spending and approval fresh, and runs the policy again. A seller who changes the price after the proposal gets a refusal.
- **Pay outside the transaction.** The purchase is marked executing inside the locked transaction, which commits, and only then does payment start. Executing rows count against the budget and cap, so a second execution waiting on the lock already sees the money as spent, and a slow devnet transfer on day 3 will not hold a database lock. A failed payment marks the row failed, which frees the budget again.
- **Confirm mode removes the tool, not just the permission.** A confirm-mode run is never offered `execute_purchase`. Code refuses it as well, for a model that asks for a tool it was not given.
- **The daily cap belongs to the owner,** across all their rules, in USD cents, counted from when an execution started. The signed approval carries its own cap and the lower of the two applies.
- **Seller text appears in one place.** `search_listings` returns fields only, so a list of results cannot carry instructions. `get_listing` returns the seller text inside `seller_text` with `trusted: false` and a note.
- **A manual tool loop.** The SDK's tool runner would work, but the loop needs a spend check before every model call, a step limit, every tool result of a turn in one message, and the transcript stored at the end. That is a few dozen lines. Thinking stays at the model default, effort is low, and `tool_choice` is auto (forcing a tool would skip thinking). Assistant turns go back into the history unchanged, thinking blocks included.
- **Outcome from the database.** A run's outcome (executed, proposed, refused, no purchase, or why it stopped) is read from the purchases table, never taken from the model's final text.
- **MCP is stateless.** A fresh MCP server and transport per request: nothing is shared between callers, and the bearer token decides the rules and the tools. Tokens are random 32 bytes, shown once, stored as SHA-256.
- **The watcher starts where it is.** Its cursor starts at the first pass, so a fresh server does not wake the agent for the whole seed. It advances before agent runs start, so each listing is looked at once even if a run fails.

### Things the tests caught

- The first concurrency test raced two executions on the same rule and passed even with the advisory lock removed: the transactions were too short to overlap, and the pool opened connections lazily. It now holds the owner's lock in another transaction for 300 ms and checks that execution waits it out; with the lock removed, this test fails. A sequential test covers the budget case.
- The watcher test found that without an API key every rule was skipped, because v2 asks the judge about every candidate. The same would happen in the demo once the spend cap is hit. The watcher now falls back to code-only checks and caps anything that passes at needs review, so the agent never acts on a listing the judge did not see. The matcher itself still fails loudly, which is what the evals want.
- A cursor that went through a JS `Date` lost microseconds and could pick up the same listing twice. Cursor comparisons now stay in SQL.

### Open

- Run `pnpm --filter @slabwatch/evals eval:agent` against the live model and record the numbers.
- Prompt caching for the agent's system prompt and tools is not set up yet; the per-run cost is small enough that it has not been measured.
- Day 3: the wallet page, signature checks on approvals, devnet payments, rate limits and the read-only demo, deploy.
