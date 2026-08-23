/** Pure PoW helpers — no Worker/D1 types, safe for any tsconfig. */

/** Race lottery: UNCAPPED — every correct solver mints a copy. One release
 * = one card with UNLIMITED copies. The release rotates purely on the
 * per-release random window (10–20 min, see releaseWindowMs below); the
 * winners counter is bookkeeping only and never closes the release. The
 * per-diver one-copy-per-card uniqueness still lives in pow_wins
 * (PK(pubkey, mint_id)). */

/** Tail hex chars used for display/slicing (尾部展示与切片长度). NOT the
 * win rule — see WIN_DIVISOR below. The client shows this many chars
 * of the digest/target tail when a bite misses. */
export const DIFFICULTY = 1
/** Win divisor: the attempt's digest tail (last 8 hex chars → 32-bit)
 * must be divisible by this → win odds exactly 1/5 (escape 80%,
 * matching the hands-free connect rate — user-mandated uniform odds
 * for manual and auto alike). 2^32 mod 5 = 1, so the residue bias is
 * ~2e-8 — effectively exact. Replaces the old nibble-mask rule (bits
 * could only express power-of-two odds). */
export const WIN_DIVISOR = 5
/** Per-diver catch cooldown after a WIN ONLY: only a real card mint stamps
 * `last_attempt_at` (escape / duplicate / full / network error leave the
 * row untouched — diver may try again immediately). 5 min, paced to the
 * release window (10–20 min) so a steady player nets roughly one card per
 * release. */
export const ATTEMPT_INTERVAL_MS = 5 * 60 * 1000

/** Release window: random per release, at least 10 minutes. Deterministic
 * hash of the release id → varies 10–20 min, no schema change needed. */
export const RELEASE_WINDOW_MIN_MS = 10 * 60 * 1000
export const RELEASE_WINDOW_JITTER_MS = 10 * 60 * 1000
export function releaseWindowMs(releaseId: number): number {
  let h = (2166136261 ^ releaseId) >>> 0
  h = Math.imul(h, 16777619) >>> 0
  h = ((h ^ (h >>> 13)) >>> 0) // ^ yields a SIGNED int32 — re-unsigned it
  h = Math.imul(h, 0x5bd1e995) >>> 0
  h = ((h ^ (h >>> 15)) >>> 0)
  return RELEASE_WINDOW_MIN_MS + (h % (RELEASE_WINDOW_JITTER_MS + 1))
}

/** The release queue rotates through the catalog in star-rank order
 *  (rarity DESC, then mint sequence ASC) — deterministic round-robin. */
export function releaseIndex(releaseCount: number, catalogSize: number): number {
  if (catalogSize <= 0) return -1
  return ((releaseCount % catalogSize) + catalogSize) % catalogSize
}