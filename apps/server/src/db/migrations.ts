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

/**
 * Day 3: the wallet. A signing request holds the exact text the server asked
 * a wallet to sign, used once. A session is a hashed bearer token for a
 * wallet that signed in. Rate limit buckets live here so they survive a
 * restart and are shared if the server ever runs twice.
 */
const wallet = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE signing_requests (
      nonce text PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('sign_in', 'auto_approval', 'purchase_approval')),
      wallet text NOT NULL,
      message text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}',
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE wallet_sessions (
      id text PRIMARY KEY,
      wallet text NOT NULL,
      token_sha256 text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE rate_limits (
      key text NOT NULL,
      window_start timestamptz NOT NULL,
      hits int NOT NULL,
      PRIMARY KEY (key, window_start)
    )`
  yield* sql`
    CREATE TABLE faucet_grants (
      id bigserial PRIMARY KEY,
      wallet text NOT NULL,
      token_units bigint NOT NULL,
      lamports bigint NOT NULL,
      signature text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`CREATE INDEX faucet_grants_wallet_idx ON faucet_grants (wallet, created_at)`
  yield* sql`ALTER TABLE rule_approvals ADD COLUMN nonce text UNIQUE`
})

/**
 * Direct buys: a collector buys a listing without a watch rule. Every
 * purchase now names the wallet that pays for it, and only a purchase made
 * for a rule has a rule.
 */
const directBuy = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`ALTER TABLE purchases ADD COLUMN buyer_wallet text`
  yield* sql`UPDATE purchases p SET buyer_wallet = r.owner_wallet FROM watch_rules r WHERE r.id = p.rule_id`
  yield* sql`ALTER TABLE purchases ALTER COLUMN rule_id DROP NOT NULL`
  yield* sql`
    ALTER TABLE purchases ADD CONSTRAINT purchases_rule_or_buyer
    CHECK (rule_id IS NOT NULL OR buyer_wallet IS NOT NULL)`
  yield* sql`CREATE INDEX purchases_buyer_idx ON purchases (buyer_wallet, status)`
})

/**
 * Market search that holds up at a million listings. The database keeps three
 * things in step with the tables people write to, so no code path can forget:
 *
 * - cards.search_terms: the words a card can be found by (its name, kinds,
 *   set name and set code), set by a trigger whenever a card is written.
 * - search_vocab: every such word once, for "is this a word we know" and, with
 *   trigram similarity, "did you mean".
 * - listing_search: one narrow row per active listing, with what search
 *   filters and sorts on, copied from the listing, its vault item and its card.
 *   Statement triggers on listings add, refresh and drop rows, so a bulk insert
 *   of 5,000 listings is one INSERT here, not 5,000.
 *
 * The seller's own title and description are left out on purpose: they can
 * claim things the slab does not say.
 */
const search = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public`
  yield* sql`
    ALTER TABLE listings DROP CONSTRAINT listings_source_check,
      ADD CONSTRAINT listings_source_check CHECK (source IN ('seed', 'generator', 'eval', 'bulk'))`

  // Lowercase runs of letters and digits, the same split the query parser uses.
  yield* sql`
    CREATE FUNCTION search_words(t text) RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT coalesce(array_agg(w), '{}') FROM regexp_split_to_table(lower(t), '[^[:alnum:]]+') AS w WHERE w <> ''
    $$`
  // The same arithmetic as toUsdCents in @slabwatch/seed, in float8 like JavaScript, rounding half up like Math.round.
  yield* sql`
    CREATE FUNCTION usd_cents(price_minor bigint, currency text) RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
      SELECT CASE currency
        WHEN 'USD' THEN price_minor
        WHEN 'EUR' THEN floor(price_minor::float8 / 0.92 + 0.5)::bigint
        ELSE floor(price_minor::float8 / 150 * 100 + 0.5)::bigint
      END
    $$`

  yield* sql`ALTER TABLE cards ADD COLUMN search_terms tsvector NOT NULL DEFAULT ''`
  yield* sql`
    CREATE FUNCTION card_search_terms() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.search_terms := array_to_tsvector(search_words(
        NEW.name || ' ' || array_to_string(NEW.kinds, ' ') || ' ' ||
        coalesce((SELECT s.name || ' ' || s.code FROM sets s WHERE s.id = NEW.set_id), '')));
      RETURN NEW;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_search_terms BEFORE INSERT OR UPDATE OF name, kinds, set_id ON cards
    FOR EACH ROW EXECUTE FUNCTION card_search_terms()`
  yield* sql`UPDATE cards SET name = name`

  yield* sql`CREATE TABLE search_vocab (term text PRIMARY KEY)`
  // text_pattern_ops serves "term LIKE 'wyr%'" whatever the database collation is.
  yield* sql`CREATE INDEX search_vocab_prefix_idx ON search_vocab (term text_pattern_ops)`
  yield* sql`CREATE INDEX search_vocab_trgm_idx ON search_vocab USING gin (term gin_trgm_ops)`
  yield* sql`
    CREATE FUNCTION add_search_vocab() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO search_vocab (term)
      SELECT DISTINCT unnest(tsvector_to_array(search_terms)) FROM written_cards
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_vocab_insert AFTER INSERT ON cards
    REFERENCING NEW TABLE AS written_cards FOR EACH STATEMENT EXECUTE FUNCTION add_search_vocab()`
  yield* sql`
    CREATE TRIGGER cards_vocab_update AFTER UPDATE ON cards
    REFERENCING NEW TABLE AS written_cards FOR EACH STATEMENT EXECUTE FUNCTION add_search_vocab()`
  yield* sql`INSERT INTO search_vocab (term) SELECT DISTINCT unnest(tsvector_to_array(search_terms)) FROM cards`

  yield* sql`
    CREATE TABLE listing_search (
      listing_id text PRIMARY KEY REFERENCES listings(id) ON DELETE CASCADE,
      card_id text NOT NULL,
      set_id text NOT NULL,
      card_number text NOT NULL,
      edition text NOT NULL,
      finish text NOT NULL,
      grader text NOT NULL,
      grade numeric(3,1) NOT NULL,
      cert_number text NOT NULL,
      seller_id text NOT NULL,
      usd_cents bigint NOT NULL,
      listed_at timestamptz NOT NULL,
      terms tsvector NOT NULL
    )`
  // One index per sort, each ending in the newest first, plus the words and the exact lookups.
  yield* sql`CREATE INDEX listing_search_terms_idx ON listing_search USING gin (terms)`
  yield* sql`CREATE INDEX listing_search_recent_idx ON listing_search (listed_at DESC, listing_id)`
  yield* sql`CREATE INDEX listing_search_price_idx ON listing_search (usd_cents, listed_at DESC)`
  yield* sql`CREATE INDEX listing_search_grade_idx ON listing_search (grade DESC, listed_at DESC)`
  yield* sql`CREATE INDEX listing_search_set_idx ON listing_search (set_id, listed_at DESC)`
  yield* sql`CREATE INDEX listing_search_card_idx ON listing_search (card_id)`
  yield* sql`CREATE INDEX listing_search_seller_idx ON listing_search (seller_id, listed_at DESC)`
  yield* sql`CREATE INDEX listing_search_cert_idx ON listing_search (cert_number)`

  yield* sql`
    CREATE FUNCTION sync_listing_search() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        DELETE FROM listing_search ls USING written_listings w WHERE ls.listing_id = w.id;
      END IF;
      INSERT INTO listing_search (listing_id, card_id, set_id, card_number, edition, finish, grader, grade,
                                  cert_number, seller_id, usd_cents, listed_at, terms)
      SELECT w.id, c.id, c.set_id, c.number, v.edition, v.finish, v.grader, v.grade,
             v.cert_number, w.seller_id, usd_cents(w.price_minor, w.currency), w.listed_at, c.search_terms
      FROM written_listings w
      JOIN vault_items v ON v.id = w.vault_item_id
      JOIN cards c ON c.id = v.card_id
      WHERE w.status = 'active';
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER listings_search_insert AFTER INSERT ON listings
    REFERENCING NEW TABLE AS written_listings FOR EACH STATEMENT EXECUTE FUNCTION sync_listing_search()`
  yield* sql`
    CREATE TRIGGER listings_search_update AFTER UPDATE ON listings
    REFERENCING NEW TABLE AS written_listings FOR EACH STATEMENT EXECUTE FUNCTION sync_listing_search()`
  // A renamed card carries its new words to its listings.
  yield* sql`
    CREATE FUNCTION card_terms_to_listings() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE listing_search SET terms = NEW.search_terms WHERE card_id = NEW.id;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_terms_to_listings AFTER UPDATE OF name, kinds, set_id ON cards
    FOR EACH ROW EXECUTE FUNCTION card_terms_to_listings()`
  yield* sql`UPDATE listings SET status = status WHERE status = 'active'`

  // What other queries need once listings number in the millions.
  yield* sql`CREATE INDEX vault_items_card_idx ON vault_items (card_id)`
  yield* sql`
    CREATE INDEX vault_items_vlt_number_idx ON vault_items ((substring(id from 5)::int))
    WHERE id ~ '^VLT-[0-9]+$'`
  yield* sql`
    CREATE INDEX listings_generator_active_idx ON listings (listed_at DESC)
    WHERE source = 'generator' AND status = 'active'`
})

/**
 * Card tags, written by a model once per card (tags/CardTagger.ts) from the
 * hand-written vocabulary in tags/vocabulary.ts. Tags join the card's search
 * terms as "#id" lexemes, so the existing triggers carry them to every
 * listing and one GIN index serves words and tags together. User words are
 * letters and digits only, so they can never prefix-match a "#" lexeme, and
 * tag lexemes stay out of the "did you mean" word list.
 */
const cardTags = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    ALTER TABLE cards
      ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
      ADD COLUMN tagged_version int,
      ADD COLUMN tagged_at timestamptz`
  // The tagger's queue: cards never tagged, tagged under an older vocabulary, or whose text changed since.
  yield* sql`CREATE INDEX cards_tag_queue_idx ON cards ((coalesce(tagged_version, 0)), id)`
  yield* sql`CREATE INDEX cards_tags_idx ON cards USING gin (tags)`
  // New text means the tags may no longer fit. The old ones stay searchable until the tagger catches up.
  yield* sql`
    CREATE FUNCTION card_text_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.catalog_text IS DISTINCT FROM OLD.catalog_text THEN
        NEW.tagged_version := NULL;
      END IF;
      RETURN NEW;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_text_changed BEFORE UPDATE OF catalog_text ON cards
    FOR EACH ROW EXECUTE FUNCTION card_text_changed()`

  yield* sql`
    CREATE OR REPLACE FUNCTION card_search_terms() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      NEW.search_terms := array_to_tsvector(search_words(
        NEW.name || ' ' || array_to_string(NEW.kinds, ' ') || ' ' ||
        coalesce((SELECT s.name || ' ' || s.code FROM sets s WHERE s.id = NEW.set_id), '')
      ) || array(SELECT '#' || t FROM unnest(NEW.tags) AS t));
      RETURN NEW;
    END $$`
  yield* sql`DROP TRIGGER cards_search_terms ON cards`
  yield* sql`
    CREATE TRIGGER cards_search_terms BEFORE INSERT OR UPDATE OF name, kinds, set_id, tags ON cards
    FOR EACH ROW EXECUTE FUNCTION card_search_terms()`

  // Listings follow their card's terms, and only when the terms really changed: retagging a card with the same tags writes nothing.
  yield* sql`
    CREATE OR REPLACE FUNCTION card_terms_to_listings() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.search_terms IS DISTINCT FROM OLD.search_terms THEN
        UPDATE listing_search SET terms = NEW.search_terms WHERE card_id = NEW.id;
      END IF;
      RETURN NULL;
    END $$`
  yield* sql`DROP TRIGGER cards_terms_to_listings ON cards`
  yield* sql`
    CREATE TRIGGER cards_terms_to_listings AFTER UPDATE OF name, kinds, set_id, tags ON cards
    FOR EACH ROW EXECUTE FUNCTION card_terms_to_listings()`

  yield* sql`
    CREATE OR REPLACE FUNCTION add_search_vocab() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO search_vocab (term)
      SELECT DISTINCT t FROM written_cards, unnest(tsvector_to_array(search_terms)) AS t
      WHERE left(t, 1) <> '#'
      ON CONFLICT DO NOTHING;
      RETURN NULL;
    END $$`
})

/**
 * Described searches a model has read, so the same search is read once. The
 * key is the search normalized (case, punctuation, word order); `version`
 * names the tag vocabulary and prompt it was read with, and a row from
 * another version is a miss. `result` is the checked reading: the search
 * text code reads it as, or that nothing usable was found.
 */
const searchUnderstandings = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE search_understandings (
      key text PRIMARY KEY,
      version text NOT NULL,
      query text NOT NULL,
      result jsonb NOT NULL,
      cost_usd_micros int NOT NULL DEFAULT 0,
      hits int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_hit_at timestamptz
    )`
})

/**
 * A vector per card for ordering search results by meaning
 * (search/CardVectors.ts). It is built from the card's catalog text and its
 * tags, so it is its own column: `embedding` holds the catalog text alone and
 * the matcher depends on it. A card whose text or tags change is marked
 * stale and keeps its old vector until a new one is written, so it never
 * drops out of the order.
 */
const cardSearchVectors = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    ALTER TABLE cards
      ADD COLUMN search_vector vector(384),
      ADD COLUMN search_vector_stale boolean NOT NULL DEFAULT true`
  yield* sql`CREATE INDEX cards_search_vector_queue_idx ON cards (id) WHERE search_vector_stale`
  yield* sql`
    CREATE FUNCTION card_search_text_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.catalog_text IS DISTINCT FROM OLD.catalog_text OR NEW.tags IS DISTINCT FROM OLD.tags THEN
        NEW.search_vector_stale := true;
      END IF;
      RETURN NEW;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_search_text_changed BEFORE UPDATE OF catalog_text, tags ON cards
    FOR EACH ROW EXECUTE FUNCTION card_search_text_changed()`
  // Best match ranks the cards a search matches before it looks at their listings,
  // then reads each card's newest matching listing: one index probe per card.
  yield* sql`CREATE INDEX cards_search_terms_idx ON cards USING gin (search_terms)`
  yield* sql`CREATE INDEX listing_search_card_recent_idx ON listing_search (card_id, listed_at DESC, listing_id)`
  yield* sql`DROP INDEX listing_search_card_idx`
})

/**
 * Which cards fit a description no filter can hold ("guards treasure"), as a
 * model judged them (search/CardFit.ts). One row per card judged, keyed by
 * the description normalized and the judging prompt's version, so the same
 * description is judged once per card whatever search it came from. A card
 * whose text changes loses its rows: they judged the old text.
 */
const cardFits = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE card_fits (
      concept text NOT NULL,
      version text NOT NULL,
      card_id text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      fits boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (concept, version, card_id)
    )`
  yield* sql`CREATE INDEX card_fits_card_idx ON card_fits (card_id)`
  yield* sql`
    CREATE FUNCTION card_fits_forget() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.catalog_text IS DISTINCT FROM OLD.catalog_text THEN
        DELETE FROM card_fits WHERE card_id = NEW.id;
      END IF;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_fits_forget AFTER UPDATE OF catalog_text ON cards
    FOR EACH ROW EXECUTE FUNCTION card_fits_forget()`
})

/**
 * What changed for a search engine's copy (search/opensearch). Postgres stays
 * the source of truth; an engine keeps its own copy of the listings, cards
 * and words, and this outbox says which ones to copy again. Each row names
 * one listing, card or word; the copier reads its current state, writes it
 * (or deletes it) in the engine, then deletes the row, so a change is never
 * missed, only seen a moment late, and seeing it twice does no harm.
 *
 * Nothing is recorded until a copy is registered in search_copies: the live
 * demo searches Postgres alone, so its outbox stays empty.
 */
const searchOutbox = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    CREATE TABLE search_outbox (
      id bigserial PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('listing', 'card', 'word')),
      key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`
  yield* sql`
    CREATE TABLE search_copies (
      name text PRIMARY KEY,
      started_at timestamptz NOT NULL DEFAULT now()
    )`
  // listing_search already follows every listing and card change (0005, 0006), so its rows are what changed.
  yield* sql`
    CREATE FUNCTION search_outbox_listings() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM search_copies) THEN
        IF TG_OP = 'DELETE' THEN
          INSERT INTO search_outbox (kind, key) SELECT 'listing', listing_id FROM old_rows;
        ELSE
          INSERT INTO search_outbox (kind, key) SELECT 'listing', listing_id FROM new_rows;
        END IF;
      END IF;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER listing_search_outbox_insert AFTER INSERT ON listing_search
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_listings()`
  yield* sql`
    CREATE TRIGGER listing_search_outbox_update AFTER UPDATE ON listing_search
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_listings()`
  yield* sql`
    CREATE TRIGGER listing_search_outbox_delete AFTER DELETE ON listing_search
    REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_listings()`
  // A card's copy holds what a search asks of the card itself: its words and tags, set, number and vector.
  yield* sql`
    CREATE FUNCTION search_outbox_cards() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM search_copies) THEN
        IF TG_OP = 'UPDATE' THEN
          INSERT INTO search_outbox (kind, key)
          SELECT 'card', n.id FROM new_rows n JOIN old_rows o ON o.id = n.id
          WHERE n.search_terms IS DISTINCT FROM o.search_terms OR n.search_vector IS DISTINCT FROM o.search_vector
             OR n.set_id IS DISTINCT FROM o.set_id OR n.number IS DISTINCT FROM o.number;
        ELSE
          INSERT INTO search_outbox (kind, key) SELECT 'card', id FROM new_rows;
        END IF;
      END IF;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER cards_outbox_insert AFTER INSERT ON cards
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_cards()`
  yield* sql`
    CREATE TRIGGER cards_outbox_update AFTER UPDATE ON cards
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_cards()`
  yield* sql`
    CREATE FUNCTION search_outbox_words() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM search_copies) THEN
        INSERT INTO search_outbox (kind, key) SELECT 'word', term FROM new_rows;
      END IF;
      RETURN NULL;
    END $$`
  yield* sql`
    CREATE TRIGGER search_vocab_outbox AFTER INSERT ON search_vocab
    REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION search_outbox_words()`
})

/**
 * Card search vectors become whole numbers, as CardVectors.searchVector makes
 * them from now on: each scaled to length 2048 and rounded. Best match then
 * orders by their dot product with the query's, which Postgres and OpenSearch
 * compute exactly, so a near tie cannot fall one way in one engine and the
 * other way in the other. This converts the vectors already written.
 */
const wholeSearchVectors = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    WITH n AS (
      SELECT id, sqrt((SELECT sum(x::float8 * x::float8) FROM unnest(search_vector::real[]) AS x)) AS length
      FROM cards WHERE search_vector IS NOT NULL
    )
    UPDATE cards c SET search_vector = (
      SELECT array_agg(round(u.x::float8 / n.length * 2048)::real ORDER BY u.i)::vector
      FROM unnest(c.search_vector::real[]) WITH ORDINALITY AS u(x, i)
    )
    FROM n WHERE c.id = n.id AND n.length > 0`
})

/**
 * Chat with the agent about one watch. A chat turn is an agent run with
 * trigger 'chat' and the collector's question; the agent's answer is its
 * final text. final_text is kept on every run from now on, so the watch's
 * log reads one short column instead of each run's whole transcript (older
 * runs fall back to the transcript). The indexes serve "this watch's latest
 * runs", which the agent page asks for every few seconds, and "this watch's
 * latest decisions", which each chat turn reads.
 */
const agentChat = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`
    ALTER TABLE agent_runs
      DROP CONSTRAINT agent_runs_trigger_check,
      ADD CONSTRAINT agent_runs_trigger_check CHECK (trigger IN ('new_match', 'manual', 'eval', 'chat')),
      ADD COLUMN question text,
      ADD COLUMN final_text text`
  yield* sql`CREATE INDEX agent_runs_rule_started_idx ON agent_runs (rule_id, started_at DESC)`
  yield* sql`CREATE INDEX match_decisions_rule_created_idx ON match_decisions (rule_id, created_at DESC)`
})

/**
 * Looking up the card a collector names when drafting a watch: a trigram
 * index on lowercased card names serves "a name spelled like this" (%) and
 * "a name with a word spelled like this" (<%), so the rule parser asks the
 * database about the words it was given instead of holding the catalog.
 */
const cardNames = Effect.gen(function* () {
  const sql = yield* SqlClient
  yield* sql`CREATE INDEX cards_name_trgm_idx ON cards USING gin (lower(name) gin_trgm_ops)`
})

export const migrations = {
  "0001_init": init,
  "0002_agent": agent,
  "0003_wallet": wallet,
  "0004_direct_buy": directBuy,
  "0005_search": search,
  "0006_card_tags": cardTags,
  "0007_search_understandings": searchUnderstandings,
  "0008_card_search_vectors": cardSearchVectors,
  "0009_card_fits": cardFits,
  "0010_search_outbox": searchOutbox,
  "0011_whole_search_vectors": wholeSearchVectors,
  "0012_agent_chat": agentChat,
  "0013_card_names": cardNames
}
