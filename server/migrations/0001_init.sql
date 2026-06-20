CREATE TABLE signals (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  origin text NOT NULL,
  origin_name text,
  origin_verified boolean NOT NULL DEFAULT true,
  type text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL,
  ttl integer NOT NULL,
  boost_bits real NOT NULL DEFAULT 0,
  ref_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX signals_tags_idx ON signals USING gin (tags);
CREATE INDEX signals_seq_idx ON signals (seq);
CREATE INDEX signals_expires_idx ON signals (expires_at);

CREATE TABLE rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_type text NOT NULL,
  identity_id text NOT NULL,
  UNIQUE (rule_type, identity_id)
);

CREATE TABLE wire (
  id text PRIMARY KEY,
  name text,
  description text,
  allowed_signal_types jsonb
);
