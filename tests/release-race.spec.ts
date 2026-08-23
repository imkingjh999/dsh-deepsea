/**
 * Release semantics: UNCAPPED — one card is on release at a time with
 * UNLIMITED copies; the release rotates purely on its 10–20 min random
 * window (see releaseWindowMs). winners is a counter, not a cap. The
 * per-diver one-copy-per-card uniqueness lives on pow_wins
 * (PK(pubkey, mint_id)), so duplicates by the same diver never double-
 * count. GOLD is rolled per winner — the foil hash mixes the diver's
 * key, so among the winners of the SAME card some hold gold and others
 * plain. Previews (no diver) always show the plain face.
 */
import { describe, expect, it } from 'vitest'
import { poolCardJson } from '../cloudflare/src/card-json.ts'
import {
  ATTEMPT_INTERVAL_MS, RELEASE_WINDOW_MIN_MS, RELEASE_WINDOW_JITTER_MS,
  releaseWindowMs,
} from '../cloudflare/src/pow-core.ts'

const row = {
  mint_id: 'DS-0001-a4604f29', block_height: 1, name: '斑点雀鲷', species: '雀鲷',
  story: '她点亮额顶小灯。', rarity: 'COMMON', zone: 'sunlit', caught_at: null, star: null,
}

describe('race release gold roll', () => {
  it('diver catch cooldown is 5 minutes (win-only, pacing: 1/8 odds → ~40 min/card)', () => {
    expect(ATTEMPT_INTERVAL_MS).toBe(5 * 60 * 1000)
  })

  it('release window is random but at least 10 minutes (10–20 min)', () => {
    for (let id = 1; id <= 200; id += 1) {
      const w = releaseWindowMs(id)
      expect(w).toBeGreaterThanOrEqual(RELEASE_WINDOW_MIN_MS)
      expect(w).toBeLessThanOrEqual(RELEASE_WINDOW_MIN_MS + RELEASE_WINDOW_JITTER_MS)
    }
  })

  it('release window is deterministic per release and varies across releases', () => {
    expect(releaseWindowMs(42)).toBe(releaseWindowMs(42))
    const seen = new Set<number>()
    for (let id = 1; id <= 50; id += 1) seen.add(releaseWindowMs(id))
    // Not all identical — the pseudo-random spread is real.
    expect(seen.size).toBeGreaterThan(1)
  })

  it('gold rolls PER WINNER — same card, different divers can differ', () => {
    // Across a spread of diver keys the same card yields a gold MIX:
    // not all-plain, not all-gold, roughly the ~1/10 hash rate.
    let gold = 0
    const n = 300
    for (let i = 0; i < n; i += 1) {
      if (poolCardJson(row, 'diver-' + i).gold) gold += 1
    }
    expect(gold).toBeGreaterThan(n * 0.03) // some gold among winners
    expect(gold).toBeLessThan(n * 0.25) // ...and some plain
  })

  it('gold is deterministic per (card, diver) — same diver, same foil', () => {
    expect(poolCardJson(row, 'diver-A').gold).toBe(poolCardJson(row, 'diver-A').gold)
    expect(poolCardJson(row, 'diver-B').gold).toBe(poolCardJson(row, 'diver-B').gold)
  })

  it('a different card for the same diver rolls independently', () => {
    let differ = 0
    for (let i = 0; i < 100; i += 1) {
      const a = poolCardJson({ ...row, mint_id: 'DS-0002-' + i }, 'diver-X').gold
      const b = poolCardJson({ ...row, mint_id: 'DS-0003-' + i }, 'diver-X').gold
      if (a !== b) differ += 1
    }
    expect(differ).toBeGreaterThan(0)
  })

  it('preview without a diver key shows the plain face', () => {
    expect(poolCardJson(row).gold).toBe(false)
  })
})
