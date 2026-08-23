-- deepsea-leaderboard — D1 schema (v2): pre-minted card pool + hash-chain ledger
-- v1 (divers/catches) stays untouched; v2 adds the mint chain and the pool.

-- Hash-chain ledger. Every mint and every catch appends one block;
-- hash = SHA-256(prev_hash || kind || canonical_payload_json), so the whole
-- pool's provenance is publicly recomputable (GET /api/chain).
CREATE TABLE IF NOT EXISTS ledger (
  height     INTEGER PRIMARY KEY,        -- 1-based block number
  prev_hash  TEXT NOT NULL,              -- hex; genesis is 64 zeros
  hash       TEXT NOT NULL UNIQUE,       -- hex sha256
  kind       TEXT NOT NULL CHECK (kind IN ('mint', 'catch')),
  payload    TEXT NOT NULL,              -- canonical JSON (sorted keys)
  created_at INTEGER NOT NULL
);

-- Pre-minted card pool. mint_id doubles as the card's blockchain identity
-- (DS-<height>-<hash8>); art lives in R2 under cards/<mint_id>/.
CREATE TABLE IF NOT EXISTS pool_cards (
  mint_id      TEXT PRIMARY KEY,         -- DS-<height>-<hash8>
  block_height INTEGER NOT NULL,         -- mint block in ledger
  name         TEXT NOT NULL,
  species      TEXT NOT NULL,
  story        TEXT NOT NULL,
  rarity       TEXT NOT NULL CHECK (rarity IN ('C', 'R', 'SR', 'SSR', 'UR')),
  zone         TEXT NOT NULL,            -- sunlit | twilight | midnight | abyss
  art_sha256   TEXT NOT NULL,
  holo_sha256  TEXT NOT NULL,
  mask_sha256  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'in_pool' CHECK (status IN ('in_pool', 'caught')),
  caught_by    TEXT,                     -- diver public key once caught
  caught_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pool_draw ON pool_cards(status, zone, rarity);
CREATE INDEX IF NOT EXISTS idx_pool_status ON pool_cards(status);
