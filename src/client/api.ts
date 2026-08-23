/** Host API client for the catch pipeline and card registry. */
import type { CardRecord } from './depth.ts'

export interface CatchResult {
  escaped: boolean
  reason: 'escape' | 'duplicate' | 'full' | string
  challenge: string
  tail: string
  targetTail: string
  card?: CardRecord
  retryAfterMs?: number
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(
    body) })
  const raw = await res.text()
  let data: { ok: boolean, value?: T, error?: { message?: string, code?: string, retryAfterMs?: number } }
  try {
    data = JSON.parse(raw) as { ok: boolean, value?: T, error?: { message?: string, code?: string,
      retryAfterMs?: number } }
  } catch {
    // Non-JSON body (proxy 502 page etc.) — surface status + snippet
    // instead of a raw "Unexpected token" SyntaxError.
    throw new Error(`HTTP ${res.status}: ${raw.slice(0, 120)}`)
  }
  if (!data.ok) {
    if (data.error?.code === 'too-soon') {
      return { escaped: true, reason: 'too-soon', challenge: '', tail: '', targetTail: '',
        retryAfterMs: data.error.retryAfterMs } as unknown as T
    }
    throw new Error(data.error?.message ?? `HTTP ${res.status}`)
  }
  return data.value as T
}

export function catchCard(depth: number, zone: string, auto = false): Promise<CatchResult> {
  // mode='auto' tells the worker to relax the win rule by one bit (1/4 vs
  // 1/8) so the hands-free drip keeps producing while the player is away.
  // The host forwards it on the signed payload — manual attempts send
  // 'manual' explicitly so the server branch is unambiguous.
  return post<CatchResult>('/deepsea/api/catch', { depth, zone, mode: auto ? 'auto' : 'manual' })
}

export async function listCards(): Promise<CardRecord[]> {
  try {
    const res = await fetch('/deepsea/api/cards')
    const data = JSON.parse(await res.text()) as { ok: boolean, value?: { cards: CardRecord[] } }
    return data.ok === true && data.value !== undefined ? data.value.cards : []
  } catch { return [] }
}

export async function uploadBattle(cards: CardRecord[]): Promise<void> {
  await post('/deepsea/api/upload', { cards })
}

/** One row of the global diver ranking (see the worker's /api/leaders). */
export interface LeaderRow {
  public_key: string
  total_catches: number
  deepest: number
  rarest: string
  last_active_at: number
  /** Optional per-rarity catch counts (RARE/EPIC/LEGENDARY) — omitted by
   * older workers; the leaderboard renders a dash when undefined. */
  rare_count?: number
  epic_count?: number
  legendary_count?: number
}

const WORKER = 'https://deepsea.openclawd.qzz.io'

export async function fetchLeaders(limit = 50): Promise<LeaderRow[]> {
  try {
    const res = await fetch(`${WORKER}/api/leaders?limit=${String(limit)}`)
    const data = JSON.parse(await res.text()) as { ok: boolean, value?: { leaders?: LeaderRow[] } }
    return data.ok === true && Array.isArray(data.value?.leaders) ? data.value.leaders : []
  } catch { return [] }
}

/** The local diver's public key (empty string when unavailable). */
export async function fetchMe(): Promise<string> {
  try {
    const res = await fetch('/deepsea/api/me')
    const data = JSON.parse(await res.text()) as { ok: boolean, value?: { publicKey?: string } }
    return data.ok === true ? (data.value?.publicKey ?? '') : ''
  } catch { return '' }
}

/** Remaining catch cooldown in ms for this diver (0 = ready). Primes the
 * UI on load so a cooldown-blocked bite never teases "generating card". */
export async function fetchNextCatch(): Promise<number> {
  try {
    const res = await fetch('/deepsea/api/nextcatch')
    const data = JSON.parse(await res.text()) as { ok: boolean, value?: { retryAfterMs?: number } }
    return data.ok === true ? (data.value?.retryAfterMs ?? 0) : 0
  } catch { return 0 }
}

/** Reveal theater: hash the server challenge once with WebCrypto. */
export async function rollChallenge(challenge: string): Promise<string> {
  if (typeof crypto === 'undefined' || crypto.subtle === undefined) return ''
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challenge))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}