-- Subwire server schema (v2: one server, many subwires). Applied with
-- search_path set to the server's schema, so all names here are unqualified.

CREATE TABLE IF NOT EXISTS subwires (
  slug text PRIMARY KEY,
  name text,
  description text,
  allowed_signal_types jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signals (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  subwire text NOT NULL REFERENCES subwires(slug) ON DELETE CASCADE,
  origin text NOT NULL,
  origin_name text,
  origin_verified boolean NOT NULL DEFAULT true,
  type text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL,
  ttl integer NOT NULL,
  boost_bits real NOT NULL DEFAULT 0,
  pinned boolean NOT NULL DEFAULT false,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS signals_seq_idx ON signals (seq);
CREATE INDEX IF NOT EXISTS signals_subwire_seq_idx ON signals (subwire, seq);
CREATE INDEX IF NOT EXISTS signals_subwire_expires_idx ON signals (subwire, expires_at);
CREATE INDEX IF NOT EXISTS signals_subwire_created_idx ON signals (subwire, created_at DESC, id);
CREATE INDEX IF NOT EXISTS signals_subwire_origin_idx ON signals (subwire, origin, created_at DESC);
CREATE INDEX IF NOT EXISTS signals_ref_idx ON signals (ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS signals_tags_gin ON signals USING GIN (tags);

CREATE TABLE IF NOT EXISTS subwire_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subwire text NOT NULL REFERENCES subwires(slug) ON DELETE CASCADE,
  rule_type text NOT NULL CHECK (rule_type IN ('allow', 'deny')),
  identity_id text NOT NULL,
  UNIQUE (subwire, rule_type, identity_id)
);
