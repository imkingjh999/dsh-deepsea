import { describe, expect, it } from 'vitest'
import { releaseIndex, WIN_DIVISOR } from '../cloudflare/src/pow-core.ts'
import { rollChallenge } from '../src/client/api.ts'

describe('pow release rotation', () => {
  it('round-robins deterministically through the catalog', () => {
    expect(releaseIndex(0, 108)).toBe(0)
    expect(releaseIndex(107, 108)).toBe(107)
    expect(releaseIndex(108, 108)).toBe(0)
    expect(releaseIndex(216, 108)).toBe(0)
  })

  it('handles empty catalog and wraps negatives safely', () => {
    expect(releaseIndex(0, 0)).toBe(-1)
    expect(releaseIndex(-1, 108)).toBe(107)
  })
})

describe('v36 win rule drift gate', () => {
  it('drift gate: WIN_DIVISOR is 5 — 20% win / 80% escape, uniform for manual and auto', () => {
    // v36: the win rule moved from a nibble-mask (power-of-two odds only)
    // to digest-tail % WIN_DIVISOR. 2^32 mod 5 = 1 → the residue bias
    // across the hash space is ~2e-8 — effectively exact uniform 1/5.
    // User-mandated uniform odds for manual and auto alike (both at 80%
    // escape rate, matching the hands-free connect rate). Drift gate — if
    // anyone touches the divisor this test will tell them.
    expect(WIN_DIVISOR).toBe(5)
  })
})

describe('rollChallenge', () => {
  it('computes standard sha-256 (known vector)', async () => {
    expect(await rollChallenge('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})