/**
 * v5 GitHub link flow — pure helper coverage (github-auth.ts).
 *
 * The link material is signed by the host's Ed25519 identity and must be
 * byte-stable between host and worker; the state blob rides the OAuth
 * redirect round-trip (base64url) and is re-verified at callback time.
 */
import { describe, expect, it } from 'vitest'
import {
  LINK_TTL_MS, decodeState, encodeState, linkFresh, linkMessage,
} from '../cloudflare/src/github-auth.ts'

const state = { pubkey: 'MCowBQYDK2VwAyEA'.repeat(3), nonce: '12345678-abcd', ts: 1787485173766, sig: 'sig==' }

describe('linkMessage — flat signing material', () => {
  it('is prefix:pubkey:nonce:ts (byte-stable contract host↔worker)', () => {
    expect(linkMessage('PUB', 'NONCE', 42)).toBe('deepsea-github-link:PUB:NONCE:42')
  })
})

describe('state codec — OAuth redirect round-trip', () => {
  it('encode → decode is lossless (base64url, no +/= in output)', () => {
    const enc = encodeState(state)
    expect(enc).not.toMatch(/[+/=]/)
    expect(decodeState(enc)).toEqual(state)
  })
  it('rejects malformed payloads instead of throwing', () => {
    expect(decodeState('!!!not-base64!!!')).toBeNull()
    expect(decodeState(encodeState({ ...state, pubkey: '' }))).toBeNull()
    expect(decodeState(encodeState({ ...state, nonce: 'short' }))).toBeNull()
    expect(decodeState(encodeState({ ...state, sig: '' }))).toBeNull()
  })
})

describe('linkFresh — 10-minute anti-replay window', () => {
  it('accepts inside the window, rejects future ts and stale ts', () => {
    const now = state.ts + 60_000
    expect(linkFresh(state.ts, now)).toBe(true)
    expect(linkFresh(now + 1, now)).toBe(false) // future (clock skew guard)
    expect(linkFresh(state.ts, state.ts + LINK_TTL_MS + 1)).toBe(false)
    expect(linkFresh(state.ts, state.ts + LINK_TTL_MS)).toBe(true)
  })
})
