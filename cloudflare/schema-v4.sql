-- v4 rookie retention (前五分钟新手运势): per-diver first-seen stamp for
-- the 5-minute beginner's-luck window (win divisor 2 instead of 5).
-- The stamp is written lazily by the worker at the diver's FIRST attempt;
-- divers that already existed are back-stamped to 1 (epoch-second 1) so
-- the boost only ever applies to divers whose first attempt happens
-- after this migration — veterans never get a free window.
ALTER TABLE pow_divers ADD COLUMN first_seen_at INTEGER NOT NULL DEFAULT 0;
UPDATE pow_divers SET first_seen_at = 1 WHERE first_seen_at = 0;
