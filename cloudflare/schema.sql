-- deepsea-leaderboard — D1 schema (v1)
-- Mirrors pi-jinyong-xia's leaderboard pattern: Ed25519-verified uploads,
-- zero API key, server-side validation bounds.

CREATE TABLE IF NOT EXISTS divers (
  public_key TEXT PRIMARY KEY,          -- base64 DER SPKI (client identity)
  first_seen_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  total_catches INTEGER NOT NULL DEFAULT 0,
  deepest REAL NOT NULL DEFAULT 0,      -- max depth 0..1
  rarest TEXT                           -- best rarity so far (C<R<SR<SSR<UR)
);

CREATE TABLE IF NOT EXISTS catches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL REFERENCES divers(public_key),
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('C','R','SR','SSR','UR')),
  depth REAL NOT NULL CHECK (depth >= 0 AND depth <= 1),
  zone TEXT NOT NULL,
  caught_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catches_time ON catches(caught_at DESC);
CREATE INDEX IF NOT EXISTS idx_catches_pub ON catches(public_key, caught_at DESC);
