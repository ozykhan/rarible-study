# Slabwatch

A study project: an AI shopping agent for a mock marketplace of tokenized, graded trading cards.

You describe a card you want in plain words. The app turns that into a watch rule, matches new listings with code first and a model second, and (from day 2) lets an agent buy within limits that code enforces, paying with SPL tokens on Solana devnet.

**Solana devnet only.** Every card, set, character, grading company and seller in this repo is invented. There is no real marketplace data, no real money and no mainnet code path.

This is a three-day study project, not a product. Nothing here is audited or production ready.

## Status

| Day | Scope | State |
| --- | --- | --- |
| 1 | Fictional seed with traps, watch rules from plain language, SQL and pgvector matching, labelled eval set, v1 numbers | Built, tested, v1 measured |
| 2 | MCP server, agent loop with limits in code, injection tests, tracing | Planned |
| 3 | Next.js wallet page on devnet, deploy, write-up | Planned |

## How a want becomes a watch rule

"Origin Set Cinderwing Drake, 1st edition holo, NVG 9 or better, under $2,000" goes to Claude Haiku 5.5 with a JSON schema as structured output. The model returns names and numbers, never ids. Code then resolves names to catalog ids with a small typo tolerance. Anything unknown or ambiguous becomes a question for the collector instead of a guess. For example, Cinderwing Drake exists in two sets, so the draft rule asks which one. A missing price is also a question, never a default.

## How matching works

Each rule runs a listing through four stages. A stage can only keep a listing or make its verdict stricter.

1. **Hard filter, in SQL.** Set, card, edition, finish, grader, minimum grade, currency and maximum price. A TypeScript copy of the same checks explains each result and is what the purchase policy will re-run before paying. A test checks that the two agree on 150 random rules over the seed.
2. **Red flags, in code.** The same vault item listed twice, a price under 40% of recent sales for that exact variant and grade, and seller text that claims a grade or grader that differs from the vault record.
3. **Similarity, with pgvector.** Only for rules with a soft description such as "a water creature". Listings are ranked by cosine similarity with local bge-small embeddings, and only the closest go on to the judge.
4. **Judge, a model call.** It decides the soft description and reads the seller text for problems. Seller text is wrapped and marked untrusted, and the prompt says to never follow instructions in it. The judge can reject or ask for review. It cannot accept anything code rejected.

## What is measured

The eval set in [`evals/`](evals) has 5 watch rules and 57 listings labelled by hand before any pipeline run. 40 of the listings carry a trap: wrong edition, finish, set, card, grader or currency, a low grade, a price over budget, a grade claim that contradicts the vault record, a duplicate listing, a price too good to be true, a near miss on the soft description, or text that tries to steer an AI buyer. Each of the 5 listings with injected text has a clean twin that differs only in its description.

`pnpm eval` runs every (rule, listing) pair through one pipeline version and records:

- precision and recall against the labels
- how many trap listings were wrongly matched to at least one rule
- injection influence: for each injected listing that reached the model, whether its verdict differs from its clean twin's, and whether it is more permissive (counted as harmful)
- how many want parsing fields the model got right against the hand-written rules
- model calls, tokens, latency and cost

Each run writes `evals/results/<version>.json` and adds a row to `evals/results/summary.md`. The plan is to run v1, read the errors, change exactly one thing for v2, and record both.

### Results

| Version | Precision | Recall | Needs review | Trap listings wrongly matched | Injection: harmful changes | Want parsing: fields right | Model calls | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | 81.8% | 94.7% | 8 | 3 of 40 | 0 of 4 | 40 of 40 | 44 | $0.0083 |
| v2 | 100.0% | 94.7% | 12 | 0 of 40 | 0 of 4 | 40 of 40 | 44 | $0.0083 |

Both runs use Claude Haiku 5.5 and bge-small embeddings on the same eval set. Exact rows with commit and timestamp are in `evals/results/summary.md`.

**Reading v1.** 4 of the 5 wrong decisions were false positives on listings that code had already flagged: two duplicate vault items and one price far below recent sales (matched to two rules). Each time the warning was in the judge's prompt and the judge matched anyway. Where it gave a reason, it treated the warning as outside its job because the seller text itself looked fine. The one miss was a plant and water card that the judge decided was not "a water creature", which is arguable. Injected text never made a verdict more permissive. In the two cases where it changed anything, the judge moved the injected listing from match to needs review. One injected listing never reached a model because it failed every rule's hard filter.

**v2 changes one thing:** a code red flag now caps the verdict at needs review, so no model can match past it. The collector still sees the listing with the warning, and an agent cannot auto-buy it. All four false positives became needs review, no new errors appeared, and recall and cost did not move. The one remaining error is the same arguable miss as in v1.

**How much to trust this.** 57 listings is a small set, each version ran once, and the v2 change was picked after reading v1's errors on the same set. So v2's score shows the fix does what it was meant to do. It is not an independent estimate of precision on new listings.

`pnpm eval -- v1 --offline` checks the plumbing with no model calls, and CI runs it on every push.

## Guardrails

Built so far:

- The model can veto a match but never approve one that code rejected.
- Catalog ids come from code, never from the model.
- A daily model spend cap ($2 by default) is checked before every call and refuses clearly when reached. Every call is logged with tokens, cost and latency.
- Seller text is escaped and marked untrusted in every prompt.
- Secrets live only in `.env` (git-ignored) or the hosting platform's environment. gitleaks runs as a pre-commit hook and in CI. A key that reaches git history gets rotated, not just deleted.

Planned for day 2 and 3:

- Purchase limits in code: per-rule budget, a daily cap and a rule-id allow-list, re-checked right before payment.
- A bearer token on the MCP endpoint, plus per-IP and per-wallet rate limits and a read-only demo mode.
- Devnet keypairs only, never in the repo or the frontend bundle.

## Run it locally

Needs Node 22.12 or newer, pnpm 10 and Docker.

```sh
pnpm install
cp .env.example .env        # add ANTHROPIC_API_KEY to use the model stages
pnpm bootstrap              # Postgres with pgvector, migrations, seed
pnpm dev                    # backend on :3001, with a new listing every 45 seconds
pnpm test
pnpm eval                   # v1 eval, needs the API key
```

`EMBEDDER=hash` in `.env` swaps the local embedding model for a deterministic hash embedder, which is useful offline and in tests but meaningless for similarity.

## Layout

```
packages/domain   Effect Schema types: money, catalog, watch rules, match decisions, hard checks
packages/seed     the fictional catalog, prices, sales history and the listing generator
apps/server       Effect backend: Postgres and pgvector, embeddings, model calls, rule parser, matcher
evals             labelled eval set, metrics and the eval runner
```

## Built with coding agents

I built this with Claude Code as a coding agent. I set the scope, the plan and the constraints, and reviewed the changes. The agent wrote most of the code, the tests and the labelled eval set.

## What's next

- Day 2: the MCP server (search_listings, get_listing, get_price_history, propose_purchase, execute_purchase), the agent loop with code limits, injection tests against the agent, and tracing.
- Day 3: the wallet page on devnet with a signed budget approval and SPL token transfers to a mock escrow, deploy and a write-up.

## License

MIT. See [LICENSE](LICENSE).
