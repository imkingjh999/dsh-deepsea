/**
 * GitHub OAuth link flow — pure helpers (no Worker/D1 types, cf.
 * pow-core.ts / upload-gate.ts; root tsconfig must stay importable).
 *
 * The link proves TWO things before a diver's stats may appear on the
 * public leaderboard:
 *   1. the initiator holds the diver's Ed25519 private key (signature
 *      over the link material — an attacker cannot bind someone else's
 *      pubkey to their own GitHub account), and
 *   2. the initiator controls the GitHub account (standard OAuth code
 *      exchange done by the worker routes).
 *
 * The signed message is a flat string (never JSON) so host and worker
 * cannot drift apart on field ordering:
 *   deepsea-github-link:<pubkey>:<nonce>:<ts>
 */

export const LINK_PREFIX = 'deepsea-github-link'

/** Signed material — flat string, byte-stable across host and worker. */
export function linkMessage(pubkey: string, nonce: string, ts: number): string {
  return `${LINK_PREFIX}:${pubkey}:${nonce}:${ts}`
}

export interface LinkState {
  pubkey: string
  nonce: string
  ts: number
  sig: string
}

/** Serialize state for the OAuth `state` param (base64url of JSON). */
export function encodeState(s: LinkState): string {
  const json = JSON.stringify(s)
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
  return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/** Parse the OAuth `state` param back; null when malformed. */
export function decodeState(raw: string): LinkState | null {
  try {
    const b64 = raw.replaceAll('-', '+').replaceAll('_', '/')
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    const bin = atob(b64 + pad)
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
    const s = JSON.parse(json) as Partial<LinkState>
    if (typeof s.pubkey !== 'string' || typeof s.nonce !== 'string' ||
        typeof s.ts !== 'number' || typeof s.sig !== 'string') return null
    if (s.pubkey.length === 0 || s.pubkey.length > 200) return null
    if (s.nonce.length < 8 || s.nonce.length > 64) return null
    if (s.sig.length === 0 || s.sig.length > 200) return null
    return { pubkey: s.pubkey, nonce: s.nonce, ts: s.ts, sig: s.sig }
  } catch {
    return null
  }
}

/** Link material freshness window — 10 minutes from signing to callback. */
export const LINK_TTL_MS = 10 * 60 * 1000

/** True when ts is within the freshness window of now. */
export function linkFresh(ts: number, now: number): boolean {
  return now - ts >= 0 && now - ts <= LINK_TTL_MS
}
