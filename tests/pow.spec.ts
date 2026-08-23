import { describe, expect, it } from 'vitest'
import {
  releaseIndex, WIN_DIVISOR, WIN_DIVISOR_ROOKIE, ROOKIE_WINDOW_MS,
  isRookie, winDivisorFor,
} from '../cloudflare/src/pow-core.ts'
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

describe('v50 rookie retention window (前五分钟新手运势)', () => {
  const T0 = 1_700_000_000_000
  const MIN = 60 * 1000

  it('drift gate: rookie divisor is 2 (1/2 odds), window is exactly 5 minutes', () => {
    expect(WIN_DIVISOR_ROOKIE).toBe(2)
    expect(ROOKIE_WINDOW_MS).toBe(5 * 60 * 1000)
  })

  it('inside the first 5 minutes the divisor drops to the rookie rule', () => {
    expect(isRookie(T0, T0)).toBe(true) // the very first attempt
    expect(isRookie(T0, T0 + MIN)).toBe(true)
    expect(isRookie(T0, T0 + 5 * MIN - 1)).toBe(true) // last ms inside
    expect(winDivisorFor(T0, T0)).toBe(WIN_DIVISOR_ROOKIE)
    expect(winDivisorFor(T0, T0 + 2 * MIN)).toBe(WIN_DIVISOR_ROOKIE)
  })

  it('at/after the 5-minute boundary the veteran 1/5 rule resumes', () => {
    expect(isRookie(T0, T0 + 5 * MIN)).toBe(false) // boundary is exclusive
    expect(isRookie(T0, T0 + 6 * MIN)).toBe(false)
    expect(winDivisorFor(T0, T0 + 5 * MIN)).toBe(WIN_DIVISOR)
    expect(winDivisorFor(T0, T0 + 2 * 60 * MIN)).toBe(WIN_DIVISOR)
  })

  it('an unstamped (0) or back-stamped (1, migration-v4 veterans) row is never rookie', () => {
    // 0 = freshly-created row before its lazy stamp — never rookie (the
    // worker stamps first_seen_at = now AT the first attempt, so the
    // stamp-then-check ordering must not leak a false negative→positive
    // flip-flop: 0 is rejected defensively).
    expect(isRookie(0, T0)).toBe(false)
    // 1 = the epoch-second back-stamp schema-v4.sql wrote for every diver
    // that already existed — veterans never get a free window.
    expect(isRookie(1, T0)).toBe(false)
    expect(isRookie(1, 2_000_000_000_000)).toBe(false)
    expect(winDivisorFor(1, T0)).toBe(WIN_DIVISOR)
  })

  it('clock skew guard: a `now` before the stamp is not rookie', () => {
    expect(isRookie(T0, T0 - 1)).toBe(false)
  })
})