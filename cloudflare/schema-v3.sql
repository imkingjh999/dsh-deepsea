-- deepsea-leaderboard — D1 schema (v3): Hearthstone-style 4-tier rarity.
-- SQLite cannot ALTER a CHECK constraint, so both rarity-constrained tables
-- are rebuilt. Old -> new mapping: C->COMMON, R->RARE, SR->EPIC,
-- SSR->EPIC (v2 pool) or SSR->LEGENDARY (minted creatures were top-tier),
-- UR->LEGENDARY. Mint/catch ledger payloads are historic bytes and stay
-- untouched — /api/chain/verify hashes the stored payload as-is.

CREATE TABLE IF NOT EXISTS pool_cards_v3 (
  mint_id      TEXT PRIMARY KEY,
  block_height INTEGER NOT NULL,
  name         TEXT NOT NULL,
  species      TEXT NOT NULL,
  story        TEXT NOT NULL,
  rarity       TEXT NOT NULL CHECK (rarity IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')),
  zone         TEXT NOT NULL,
  art_sha256   TEXT NOT NULL,
  holo_sha256  TEXT NOT NULL,
  mask_sha256  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_pool' CHECK (status IN ('in_pool', 'caught')),
  caught_by    TEXT,
  caught_at    INTEGER
);
INSERT INTO pool_cards_v3
  SELECT mint_id, block_height, name, species, story,
    CASE rarity
      WHEN 'C' THEN 'COMMON' WHEN 'R' THEN 'RARE' WHEN 'SR' THEN 'EPIC'
      WHEN 'SSR' THEN 'LEGENDARY' WHEN 'UR' THEN 'LEGENDARY'
      ELSE 'COMMON' END,
    zone, art_sha256, holo_sha256, mask_sha256, status, caught_by, caught_at
  FROM pool_cards;
DROP TABLE pool_cards;
ALTER TABLE pool_cards_v3 RENAME TO pool_cards;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_name ON pool_cards(name);
CREATE INDEX IF NOT EXISTS idx_pool_draw ON pool_cards(status, zone, rarity);
CREATE INDEX IF NOT EXISTS idx_pool_status ON pool_cards(status);

CREATE TABLE IF NOT EXISTS catches_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_key TEXT NOT NULL REFERENCES divers(public_key),
  card_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('COMMON', 'RARE', 'EPIC', 'LEGENDARY')),
  depth REAL NOT NULL CHECK (depth >= 0 AND depth <= 1),
  zone TEXT NOT NULL,
  caught_at INTEGER NOT NULL
);
INSERT INTO catches_v3
  SELECT id, public_key, card_id, name,
    CASE rarity
      WHEN 'C' THEN 'COMMON' WHEN 'R' THEN 'RARE' WHEN 'SR' THEN 'EPIC'
      WHEN 'SSR' THEN 'LEGENDARY' WHEN 'UR' THEN 'LEGENDARY'
      ELSE 'COMMON' END,
    depth, zone, caught_at
  FROM catches;
DROP TABLE catches;
ALTER TABLE catches_v3 RENAME TO catches;
CREATE INDEX IF NOT EXISTS idx_catches_time ON catches(caught_at DESC);
CREATE INDEX IF NOT EXISTS idx_catches_pub ON catches(public_key, caught_at DESC);

-- divers.rarest is free TEXT; remap for consistency.
UPDATE divers SET rarest = CASE rarest
  WHEN 'C' THEN 'COMMON' WHEN 'R' THEN 'RARE' WHEN 'SR' THEN 'EPIC'
  WHEN 'SSR' THEN 'LEGENDARY' WHEN 'UR' THEN 'LEGENDARY'
  ELSE rarest END;;
