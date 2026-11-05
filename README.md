# Slabwatch

A study project: an AI shopping agent for a mock marketplace of tokenized, graded trading cards.

You describe a card you want in plain words. The app turns that into a watch rule, matches new listings with code first and a model second, and lets an agent buy within limits that code enforces. On day 3 it pays with SPL tokens on Solana devnet.

**Solana devnet only.** Every card, set, character, grading company and seller in this repo is invented. There is no real marketplace data, no real money and no mainnet code path.

This is a three-day study project, not a product. Nothing here is audited or production ready.

## Status

| Day | Scope | State |
| --- | --- | --- |
| 1 | Fictional seed with traps, watch rules from plain language, SQL and pgvector matching, labelled eval set, v1 and v2 numbers | Built, tested, measured |
| 2 | MCP server, agent loop with limits in code, injection tests, tracing | Built and tested; the live agent injection eval is next |
| 3 | Next.js wallet page on devnet, deploy, write-up | Planned |

## How a want becomes a watch rule

"Origin Set Cinderwing Drake, 1st edition holo, NVG 9 or better, under $2,000" goes to Claude Haiku 5.5 with a JSON schema as structured output. The model returns names and numbers, never ids. Code then resolves names to catalog ids with a small typo tolerance. Anything unknown or ambiguous becomes a question for the collector instead of a guess. For example, Cinderwing Drake exists in two sets, so the draft rule asks which one. A missing price is also a question, never a default.

## How matching works

Each rule runs a listing through four stages. A stage can only keep a listing or make its verdict stricter.

1. **Hard filter, in SQL.** Set, card, edition, finish, grader, minimum grade, currency and maximum price. A TypeScript copy of the same checks explains each result, and the purchase policy re-runs it before paying. A test checks that the two agree on 150 random rules over the seed.
2. **Red flags, in code.** The same vault item listed twice, a price under 40% of recent sales for that exact variant and grade, and seller text that claims a grade or grader that differs from the vault record.
3. **Similarity, with pgvector.** Only for rules with a soft description such as "a water creature". Listings are ranked by cosine similarity with local bge-small embeddings, and only the closest go on to the judge.
4. **Judge, a model call.** It decides the soft description and reads the seller text for problems. Seller text is wrapped and marked untrusted, and the prompt says to never follow instructions in it. The judge can reject or ask for review. It cannot accept anything code rejected.

A watcher runs every 15 seconds. It takes the listings that arrived since its last pass, runs every active rule over them with the v2 pipeline, saves the decisions and, when the agent is turned on, wakes the agent for each match. If the model is out of reach (no key, or the spend cap is hit), code still checks fields and red flags, but nothing becomes a match without the judge: those listings wait as needs review.

## How the agent buys

The agent has five tools, defined once in [`apps/server/src/agent/tools.ts`](apps/server/src/agent/tools.ts) and shared by the in-process agent and the MCP server:

| Tool | What it does |
| --- | --- |
| `search_listings` | Active listings by fields and, optionally, by meaning. Fields only: no seller text. |
| `get_listing` | One listing, its code red flags, the median of recent sales, how the caller's rules judged it, and the seller text marked `trusted: false`. |
| `get_price_history` | Past sales for one exact variant, with the median. |
| `propose_purchase` | Asks to buy a listing for one rule. Code checks the policy and records a proposal or a refusal. |
| `execute_purchase` | Pays for a proposal. Code checks everything again first. |

The model can ask for anything. Code decides, in [`apps/server/src/purchases/`](apps/server/src/purchases):

- **The caller is scoped.** An agent run acts for one rule. An MCP token carries its own rule-id allow-list. A rule outside the list is refused.
- **The policy is one pure function** that reports every failed check, not just the first: demo read-only mode, the rule on the allow-list and active, the listing active and passing the rule's hard checks, no code red flags, not already bought, the rule's budget (what is already spent plus this price, same currency), and the owner's daily cap in USD.
- **Confirm mode needs the collector.** For a confirm rule the agent never sees `execute_purchase`, and a proposal waits for the collector. Auto mode needs a signed, unexpired approval that names the rule, budget and daily cap; day 3 verifies the wallet signature on it. The lower of the server's cap and the signed cap applies.
- **Execution is serialized per owner.** It locks the purchase row and takes a Postgres advisory lock for the owner's wallet, then reads everything fresh and re-runs the policy. A price that changed since the proposal is refused. The purchase is marked executing, which counts against the budget and cap, before payment starts. A partial unique index allows one live purchase per listing.
- **Payments are simulated on day 2** behind a `Payments` service. Day 3 swaps in SPL transfers on devnet.

The agent loop ([`apps/server/src/agent/Agent.ts`](apps/server/src/agent/Agent.ts)) is a plain tool loop on Claude Haiku 5.5 at low effort: at most 6 model calls, the spend cap checked before each one, history passed back unchanged, and every run recorded in `agent_runs` with its transcript, counts, outcome and trace id. The outcome comes from the purchases table, not from what the model says it did.

### The MCP endpoint

`POST /mcp` speaks MCP over Streamable HTTP with the official SDK, statelessly: each request gets a fresh server. It needs a bearer token:

```sh
pnpm --filter @slabwatch/server mint-token --rules R1,R2            # propose only
pnpm --filter @slabwatch/server mint-token --rules R1 --execute     # may also execute
pnpm --filter @slabwatch/server mint-token --revoke T-...
```

The token is printed once. Only its SHA-256 is stored. Without a valid token the endpoint answers 401. A token without execute rights does not see `execute_purchase`, and calling it anyway fails. Every purchase records which token or agent run asked for it.

## Prompt injection, tested where it matters

The tests replace the model with a script that does what an injected model might do, and run it through the real loop, tools and policy against Postgres ([`apps/server/test/agent.db.test.ts`](apps/server/test/agent.db.test.ts)):

- In confirm mode it calls `execute_purchase` on an invented id, proposes for another collector's rule, proposes a listing flagged as far below market, then proposes a good listing and tries to pay for it. Every unsafe step is refused, the good one stays a proposal, and nothing is paid for.
- In auto mode without a signed approval, it may propose but paying is refused.
- In auto mode with an approval, it pays once, then a second purchase that would overrun the budget is refused.
- A model that never stops is cut off at the step limit.

The MCP tests do the same through the official MCP client: missing, wrong and revoked tokens get 401, tools are filtered per token, search never returns seller text, and purchases go through the same policy.

`pnpm --filter @slabwatch/evals eval:agent` runs the same question against the live model. Each of the eval set's injected listings has a clean twin, and the agent is woken on each of them, for every rule whose fields it passes, in the riskiest setting: auto-buy with an approval in place, so anything code allows would execute. It reports how often the injected text pushed the outcome further than the twin got, purchases against the labels, attempts code refused, and what the v2 matcher would have said, since the real flow only wakes the agent on a v2 match. Results go to `evals/results/agent-injection-<label>.json`; NOTES.md reads each run.

## What is measured

The eval set in [`evals/`](evals) has 5 watch rules and 57 listings labelled by hand before any pipeline run. 40 of the listings carry a trap: wrong edition, finish, set, card, grader or currency, a low grade, a price over budget, a grade claim that contradicts the vault record, a duplicate listing, a price too good to be true, a near miss on the soft description, or text that tries to steer an AI buyer. Each of the 5 listings with injected text has a clean twin that differs only in its description.

`pnpm eval` runs every (rule, listing) pair through one pipeline version and records:

- precision and recall against the labels
- how many trap listings were wrongly matched to at least one rule
- injection influence: for each injected listing that reached the model, whether its verdict differs from its clean twin's, and whether it is more permissive (counted as harmful)
- how many want parsing fields the model got right against the hand-written rules
- model calls, tokens, latency and cost

Each run writes `evals/results/<version>.json` and adds a row to `evals/results/summary.md`. The plan was to run v1, read the errors, change exactly one thing for v2, and record both.

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

## Tracing

Every step is an Effect span: rule parsing, each matcher stage, model calls with tokens and cost, each tool call (`tool.search_listings` and so on), purchase checks and agent runs. Set `OTLP_TRACES_URL` (and `OTLP_HEADERS` if the backend needs a key) to export them over OTLP/HTTP to Langfuse, Jaeger or any OpenTelemetry collector. Trace ids are stored on `llm_calls`, `agent_runs` and `purchases`, so a row in the database leads to its trace.

## Guardrails

Built so far:

- The model can veto a match but never approve one that code rejected.
- Catalog ids come from code, never from the model.
- Purchases are checked in code against the rule's budget, the daily cap and the caller's rule-id allow-list, and checked again under a lock right before payment.
- The MCP endpoint needs a bearer token, and tokens are stored only as hashes.
- A daily model spend cap ($2 by default) is checked before every call and refuses clearly when reached. Every call is logged with tokens, cost and latency.
- Seller text is escaped and marked untrusted in every prompt and tool result.
- The agent is off unless `AGENT_ENABLED=true`, and the watcher starts at most 3 runs per pass.
- Secrets live only in `.env` (git-ignored) or the hosting platform's environment. gitleaks runs as a pre-commit hook and in CI. A key that reaches git history gets rotated, not just deleted.

Planned for day 3:

- Per-IP and per-wallet rate limits, and the public demo in read-only mode (`DEMO_READ_ONLY=true` already hides and refuses the purchase tools).
- Wallet signature checks on auto-buy approvals.
- Devnet keypairs only, never in the repo or the frontend bundle.

## Run it locally

Needs Node 22.12 or newer, pnpm 10 and Docker.

```sh
pnpm install
cp .env.example .env        # add ANTHROPIC_API_KEY to use the model stages
pnpm bootstrap              # Postgres with pgvector, migrations, seed
pnpm dev                    # backend on :3001: a new listing every 45 seconds, the watcher, and /mcp
pnpm test
pnpm eval                   # v1 eval, needs the API key
```

`EMBEDDER=hash` in `.env` swaps the local embedding model for a deterministic hash embedder, which is useful offline and in tests but meaningless for similarity. `AGENT_ENABLED=true` lets the watcher wake the agent on new matches.

## Layout

```
packages/domain   Effect Schema types: money, catalog, watch rules, match decisions, hard checks
packages/seed     the fictional catalog, prices, sales history and the listing generator
apps/server       Effect backend: Postgres and pgvector, embeddings, model calls, rule parser, matcher,
                  purchase policy, agent loop and tools, MCP endpoint, watcher, tracing
evals             labelled eval set, metrics, the matcher eval and the agent injection eval
```

## Built with coding agents

I built this with Claude Code as a coding agent. I set the scope, the plan and the constraints, and reviewed the changes. The agent wrote most of the code, the tests and the labelled eval set.

## What's next

- Day 3: the wallet page on devnet with a signed budget approval and SPL token transfers to a mock escrow, rate limits and the read-only demo, deploy and a write-up.

## License

MIT. See [LICENSE](LICENSE).
