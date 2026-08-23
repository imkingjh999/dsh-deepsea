-- GitHub identity links (v5): a diver may bind their local Ed25519 key to a
-- GitHub account; only linked divers appear on the public leaderboard.
-- One GitHub account maps to at most one active key (rebinding replaces
-- the old key — the GitHub identity owns the row, matching device-change).
CREATE TABLE IF NOT EXISTS github_links (
  pubkey TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL UNIQUE,
  github_login TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  linked_at INTEGER NOT NULL
);
