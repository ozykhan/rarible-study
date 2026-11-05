import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"

/**
 * Schema migrations as Effect programs, run in order by the Effect SQL migrator.
 *
 * Text columns with CHECK constraints stand in for Postgres enums: the same
 * safety, and no type casts needed when the driver sends parameters as text.
 */
const init = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`
  yield* sql`
    CREATE TABLE sets (
      id text PRIMARY KEY,
      code text NOT NULL,
      name text NOT NULL,
      release_year int NOT NULL
    )`
  yield* sql`
    CREATE TABLE cards (
      id text PRIMARY KEY,
      set_id text NOT NULL REFERENCES sets(id),
      number text NOT NULL,
      name text NOT NULL,
      rarity text NOT NULL,
      kinds text[] NOT NULL,
      catalog_text text NOT NULL,
      embedding vector(384),
      UNIQUE (set_id, number)
    )`
  yield* sql`
    CREATE TABLE sellers (
      id text PRIMARY KEY,
      handle text NOT NULL UNIQUE,
      joined_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE vault_items (
      id text PRIMARY KEY,
      card_id text NOT NULL REFERENCES cards(id),
      edition text NOT NULL CHECK (edition IN ('first', 'unlimited')),
      finish text NOT NULL CHECK (finish IN ('holo', 'non_holo', 'reverse_holo')),
      grader text NOT NULL CHECK (grader IN ('NVG', 'QSG', 'LCA')),
      grade numeric(3,1) NOT NULL CHECK (grade BETWEEN 1 AND 10 AND grade * 2 = floor(grade * 2)),
      cert_number text NOT NULL,
      vaulted_at timestamptz NOT NULL DEFAULT now()
    )`
  // No unique index on vault_item_id: a vault item listed twice is one of the traps.
  yield* sql`
    CREATE TABLE listings (
      id text PRIMARY KEY,
      vault_item_id text NOT NULL REFERENCES vault_items(id),
      seller_id text NOT NULL REFERENCES sellers(id),
      title text NOT NULL,
      description text NOT NULL,
      price_minor bigint NOT NULL CHECK (price_minor >= 0),
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'JPY')),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'withdrawn')),
      listed_at timestamptz NOT NULL DEFAULT now(),
      source text NOT NULL CHECK (source IN ('seed', 'generator', 'eval')),
      embedding vector(384)
    )`
  yield* sql`CREATE INDEX listings_status_listed_idx ON listings (status, listed_at DESC)`
  yield* sql`CREATE INDEX listings_vault_item_idx ON listings (vault_item_id)`
  // HNSW indexes for cosine distance. At a few hundred rows Postgres will still
  // prefer an exact scan; the index is here for when the table grows.
  yield* sql`CREATE INDEX listings_embedding_idx ON listings USING hnsw (embedding vector_cosine_ops)`
  yield* sql`CREATE INDEX cards_embedding_idx ON cards USING hnsw (embedding vector_cosine_ops)`
  yield* sql`
    CREATE TABLE sales (
      id bigserial PRIMARY KEY,
      card_id text NOT NULL REFERENCES cards(id),
      edition text NOT NULL,
      finish text NOT NULL,
      grader text NOT NULL,
      grade numeric(3,1) NOT NULL,
      price_minor bigint NOT NULL,
      currency text NOT NULL DEFAULT 'USD',
      sold_at timestamptz NOT NULL
    )`
  yield* sql`CREATE INDEX sales_lookup_idx ON sales (card_id, edition, finish, grader, grade, sold_at DESC)`
  yield* sql`
    CREATE TABLE watch_rules (
      id text PRIMARY KEY,
      owner_wallet text,
      raw_want text NOT NULL,
      set_id text REFERENCES sets(id),
      card_id text REFERENCES cards(id),
      edition text NOT NULL CHECK (edition IN ('first', 'unlimited', 'any')),
      finish text NOT NULL CHECK (finish IN ('holo', 'non_holo', 'reverse_holo', 'any')),
      graders text[] NOT NULL DEFAULT '{}',
      min_grade numeric(3,1) NOT NULL,
      max_price_minor bigint NOT NULL,
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'JPY')),
      soft_description text,
      soft_embedding vector(384),
      budget_minor bigint NOT NULL,
      mode text NOT NULL CHECK (mode IN ('confirm', 'auto')),
      status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'exhausted')),
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE match_decisions (
      id bigserial PRIMARY KEY,
      rule_id text NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
      listing_id text NOT NULL REFERENCES listings(id),
      pipeline_version text NOT NULL,
      verdict text NOT NULL CHECK (verdict IN ('match', 'reject', 'needs_review')),
      decided_at text NOT NULL,
      field_checks jsonb NOT NULL,
      red_flags text[] NOT NULL DEFAULT '{}',
      similarity real,
      judge jsonb,
      reasons text[] NOT NULL DEFAULT '{}',
      trace_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (rule_id, listing_id, pipeline_version)
    )`
  yield* sql`
    CREATE TABLE llm_calls (
      id bigserial PRIMARY KEY,
      purpose text NOT NULL,
      model text NOT NULL,
      input_tokens int NOT NULL,
      output_tokens int NOT NULL,
      cache_read_tokens int NOT NULL DEFAULT 0,
      cost_usd_micros bigint NOT NULL,
      latency_ms int NOT NULL,
      ok boolean NOT NULL,
      trace_id text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`CREATE INDEX llm_calls_created_idx ON llm_calls (created_at)`
  yield* sql`
    CREATE TABLE job_cursors (
      name text PRIMARY KEY,
      last_seen_at timestamptz NOT NULL
    )`
})

/**
 * Day 2: what the agent may do and what it did. Purchases move
 * proposed -> approved (by the collector) -> executing -> executed or failed,
 * or end as refused. At most one live purchase per listing, enforced here too.
 */
const agent = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE rule_approvals (
      id text PRIMARY KEY,
      rule_id text NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
      wallet text NOT NULL,
      budget_minor bigint NOT NULL CHECK (budget_minor >= 0),
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'JPY')),
      daily_cap_usd_cents bigint NOT NULL CHECK (daily_cap_usd_cents >= 0),
      mode text NOT NULL CHECK (mode IN ('confirm', 'auto')),
      message text NOT NULL,
      signature text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`CREATE INDEX rule_approvals_rule_idx ON rule_approvals (rule_id, expires_at)`
  yield* sql`
    CREATE TABLE agent_tokens (
      id text PRIMARY KEY,
      label text NOT NULL,
      token_sha256 text NOT NULL UNIQUE,
      allowed_rule_ids text[] NOT NULL,
      can_execute boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    )`
  yield* sql`
    CREATE TABLE agent_runs (
      id text PRIMARY KEY,
      rule_id text NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
      listing_id text REFERENCES listings(id),
      trigger text NOT NULL CHECK (trigger IN ('new_match', 'manual', 'eval')),
      status text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
      outcome text,
      model_calls int NOT NULL DEFAULT 0,
      tool_calls int NOT NULL DEFAULT 0,
      transcript jsonb NOT NULL DEFAULT '[]',
      trace_id text,
      started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz
    )`
  yield* sql`
    CREATE TABLE purchases (
      id text PRIMARY KEY,
      rule_id text NOT NULL REFERENCES watch_rules(id) ON DELETE CASCADE,
      listing_id text NOT NULL REFERENCES listings(id),
      run_id text REFERENCES agent_runs(id),
      actor text NOT NULL,
      price_minor bigint NOT NULL,
      currency text NOT NULL CHECK (currency IN ('USD', 'EUR', 'JPY')),
      price_usd_cents bigint NOT NULL,
      status text NOT NULL CHECK (status IN ('proposed', 'approved', 'executing', 'executed', 'failed', 'refused')),
      reason text,
      refusals text[] NOT NULL DEFAULT '{}',
      tx_signature text,
      trace_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      approved_at timestamptz,
      executing_at timestamptz,
      finished_at timestamptz
    )`
  yield* sql`
    CREATE UNIQUE INDEX purchases_one_live_per_listing ON purchases (listing_id)
    WHERE status IN ('proposed', 'approved', 'executing', 'executed')`
  yield* sql`CREATE INDEX purchases_rule_idx ON purchases (rule_id, status)`
  yield* sql`ALTER TABLE llm_calls ADD COLUMN run_id text`
})

export const migrations = {
  "0001_init": init,
  "0002_agent": agent
}
