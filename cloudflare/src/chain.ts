/**
 * Shared chain primitives for the deepsea ledger (hash chain in D1).
 * Extracted from index.ts so rechain.ts can reuse the exact same
 * canonicalization — chain verification depends on byte-identical payloads.
 */

export const GENESIS_HASH = '0'.repeat(64)

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Append one block. The height race is resolved by retrying on unique-key
 * conflict (single-writer mints and single-diver draws rarely collide).
 */
export async function appendBlock(env: ChainEnv, kind: 'mint' | 'catch', payload: unknown): Promise<{
  height: number, hash: string,
}> {
  const body = canonicalJson(payload)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = await env.DB.prepare(
      'SELECT height, hash FROM ledger ORDER BY height DESC LIMIT 1',
    ).first<{ height: number, hash: string } | null>()
    const height = (head?.height ?? 0) + 1
    const prevHash = head?.hash ?? GENESIS_HASH
    const hash = await sha256Hex(`${prevHash}|${kind}|${body}`)
    try {
      await env.DB.prepare(
        'INSERT INTO ledger (height, prev_hash, hash, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(height, prevHash, hash, kind, body, Date.now()).run()
      return { height, hash }
    } catch (err) {
      if (attempt === 2) throw err
    }
  }
  throw new Error('ledger append failed')
}

export function blockId(height: number, hash: string): string {
  return `DS-${String(height).padStart(4, '0')}-${hash.slice(0, 8)}`
}

export interface ChainEnv {
  DB: D1Database
}
