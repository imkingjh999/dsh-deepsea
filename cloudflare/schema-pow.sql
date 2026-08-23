-- v3 PoW lottery: per-diver rate limit, card releases, ownership ledger.
CREATE TABLE IF NOT EXISTS pow_divers (
  pubkey TEXT PRIMARY KEY,
  last_attempt_at INTEGER NOT NULL DEFAULT 0,
  attempt_seq INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mint_id TEXT NOT NULL,
  target TEXT NOT NULL,
  winners INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS pow_wins (
  pubkey TEXT NOT NULL,
  mint_id TEXT NOT NULL,
  release_id INTEGER NOT NULL,
  won_at INTEGER NOT NULL,
  PRIMARY KEY (pubkey, mint_id)
);