/**
 * deepsea-leaderboard — Cloudflare Worker (D1).
 *
 * Zero API-key battle-record backend with Ed25519 signature verification
 * (pattern: pi-jinyong-xia/xia-leaderboard). The plugin's host half holds a
 * per-installation Ed25519 key pair and signs every upload; the Worker only
 * trusts payloads signed by a registered public key.
 *
 * Endpoints:
 *   POST /api/upload      — upsert a battle batch (Ed25519 signed)
 *   GET  /api/wall        — latest catches across all divers (limit, offset)
 *   GET  /api/stats       — global counters + rarity histogram
 *   GET  /api/diver/:key  — one diver's profile + recent catches
 *
 * v2 — pre-minted card pool + hash-chain ledger (schema-v2.sql):
 *   POST /admin/mint           — mint one pool card (Bearer ADMIN_TOKEN);
 *                                appends a 'mint' block, stores PNGs in R2
 *   POST /api/draw             — atomically claim a pool card for a diver
 *                                (Ed25519 signed, like upload); appends a
 *                                'catch' block
 *   GET  /assets/cards/:id/:layer.png — card art/holo/mask from R2
 *   GET  /api/pool/stats       — remaining pool inventory per zone+rarity
 *   GET  /api/star?name=       — server-side star assignment for a card name
 *   GET  /api/chain            — ledger export (height, hash, kind)
 *   GET  /api/chain/verify     — recompute the whole chain, report breaks
 */
import { starOf, starRankOf, starRankOfStar, goldOf } from './stars.ts'
export { poolCardJson } from './card-json.ts'
import { appendBlock, blockId, GENESIS_HASH, sha256Hex } from './chain.ts'
import { handleRechain } from './rechain.ts'
import { handleAttempt, handlePowNext, handleRelease } from './pow.ts'
import { handleAsset, handleMint, handleVerifyAssets } from './handlers.ts'

export interface Env {
  DB: D1Database
  BUCKET: R2Bucket
  /** Shared secret for the mint CLI (wrangler secret put ADMIN_TOKEN). */
  ADMIN_TOKEN?: string
}

interface UploadCard {
  id: string
  name: string
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
  depth: number
  zone: string
  createdAt: number
}

interface UploadPayload {
  publicKey: string
  caughtAt: number
  cards: UploadCard[]
  signature: string
}

export const RARITY_ORDER = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const
const RULES = {
  MAX_CARDS_PER_BATCH: 200,
  MAX_NAME: 64,
  MIN_INTERVAL_SEC: 20,
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' },
  })
}

/** Ed25519 verify via WebCrypto (DER SPKI public key, detached signature). */
export async function verify(publicKeyB64: string, message: string, signatureB64: string): Promise<boolean> {
  try {
    const der = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0))
    const key = await crypto.subtle.importKey('spki', der, { name: 'Ed25519' }, false, ['verify'])
    const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0))
    const data = new TextEncoder().encode(message)
    return await crypto.subtle.verify('Ed25519', key, sig, data)
  } catch {
    return false
  }
}

function validateCards(cards: UploadCard[]): string | null {
  if (!Array.isArray(cards) || cards.length === 0) return 'cards empty'
  if (cards.length > RULES.MAX_CARDS_PER_BATCH) return 'too many cards'
  for (const c of cards) {
    if (typeof c.id !== 'string' || c.id.length > 40) return 'bad card id'
    if (typeof c.name !== 'string' || c.name.length > RULES.MAX_NAME) return 'bad card name'
    if (!(RARITY_ORDER as readonly string[]).includes(c.rarity)) return 'bad rarity'
    if (typeof c.depth !== 'number' || c.depth < 0 || c.depth > 1) return 'bad depth'
    if (typeof c.createdAt !== 'number' || c.createdAt <= 0) return 'bad createdAt'
  }
  return null
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'POST' && path === '/api/upload') {
      let payload: UploadPayload
      try { payload = (await req.json()) as UploadPayload } catch { return json({ ok: false, error: 'bad json' }, 400) }
      const { publicKey, caughtAt, cards, signature } = payload
      if (typeof publicKey !== 'string' || publicKey.length > 200) return json({ ok: false, error: 'bad publicKey' },
         400)
      if (typeof caughtAt !== 'number') return json({ ok: false, error: 'bad caughtAt' }, 400)
      const invalid = validateCards(cards)
      if (invalid !== null) return json({ ok: false, error: invalid }, 400)
      // Signature covers everything except the signature field itself.
      const message = JSON.stringify({ publicKey, caughtAt, cards })
      if (!(await verify(publicKey, message, signature))) {
        return json({ ok: false, error: 'signature mismatch' }, 403)
      }

      const now = Date.now()
      const existing = await env.DB.prepare('SELECT last_active_at, total_catches FROM divers WHERE public_key = ?')
        .bind(publicKey).first<{ last_active_at: number, total_catches: number } | null>()
      if (existing !== null && existing.last_active_at !== null) {
        if (now - existing.last_active_at < RULES.MIN_INTERVAL_SEC * 1000) {
          return json({ ok: false, error: 'rate limited' }, 429)
        }
      }
      const deepest = Math.max(...cards.map((c) => c.depth))
      const rarest = cards.reduce((best, c) =>
        (RARITY_ORDER as readonly string[]).indexOf(c.rarity) > (RARITY_ORDER as readonly string[]).indexOf(best) ?
           c.rarity : best, 'COMMON' as UploadCard['rarity'])
      if (existing === null) {
        await env.DB.prepare(
          'INSERT INTO divers (public_key, first_seen_at, last_active_at, ' +
            'total_catches, deepest, rarest) VALUES (?, ?, ?, 0, ?, ?)',
        )
          .bind(publicKey, now, now, deepest, rarest).run()
      } else {
        await env.DB.prepare(
          'UPDATE divers SET last_active_at = ?, deepest = MAX(deepest, ?), rarest = ? WHERE public_key = ?',
        )
          .bind(now, deepest, rarest, publicKey).run()
      }
      // One D1 BATCH for all rows: a per-card await ran ~180ms/card over
      // the network (198 cards ≈ 36s — past the host's 15s fetch timeout,
      // which surfaced as 上传失败). A batch is a single subrequest and
      // lands in well under a second. INSERT OR IGNORE + the unique
      // (public_key, card_id) index make re-uploads idempotent, so
      // total_catches counts only genuinely NEW rows.
      const seen = new Set<string>()
      const stmts: D1PreparedStatement[] = []
      for (const c of cards) {
        const key = `${c.id}:${publicKey}`
        if (seen.has(key)) continue // one row per card per diver
        seen.add(key)
        stmts.push(env.DB.prepare(
          'INSERT OR IGNORE INTO catches (public_key, card_id, name, rarity, depth, zone, caught_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(publicKey, c.id, c.name, c.rarity, c.depth, String(c.zone).slice(0, 24), c.createdAt))
      }
      let stored = 0
      if (stmts.length > 0) {
        const results = await env.DB.batch(stmts)
        for (const r of results) stored += r.meta.changes
      }
      // Count only the rows actually inserted (dedup on re-upload).
      await env.DB.prepare(
        'UPDATE divers SET total_catches = total_catches + ? WHERE public_key = ?',
      ).bind(stored, publicKey).run()
      return json({ ok: true, value: { stored } })
    }

    if (req.method === 'GET' && path === '/api/leaders') {
      // Global diver ranking: most catches first, newest catch breaks ties.
      // The per-rarity counts come from a LEFT JOIN on catches — divers
      // with zero RARE/EPIC/LEGENDARY catches still surface (SUM returns
      // NULL for the no-match branch, hence the COALESCE to 0).
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100)
      const rows = await env.DB.prepare(
        'SELECT d.public_key, d.total_catches, d.deepest, d.rarest, d.last_active_at, ' +
          'COALESCE(SUM(CASE WHEN c.rarity = \'RARE\' THEN 1 ELSE 0 END), 0) AS rare_count, ' +
          'COALESCE(SUM(CASE WHEN c.rarity = \'EPIC\' THEN 1 ELSE 0 END), 0) AS epic_count, ' +
          'COALESCE(SUM(CASE WHEN c.rarity = \'LEGENDARY\' THEN 1 ELSE 0 END), 0) AS legendary_count ' +
          'FROM divers d LEFT JOIN catches c ON c.public_key = d.public_key ' +
          'WHERE d.total_catches > 0 ' +
          'GROUP BY d.public_key ' +
          'ORDER BY d.total_catches DESC, d.last_active_at DESC LIMIT ?')
        .bind(limit).all()
      return json({ ok: true, value: { leaders: rows.results } })
    }

    if (req.method === 'GET' && path === '/api/wall') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200)
      const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
      const rows = await env.DB.prepare(
        'SELECT card_id, name, rarity, depth, zone, caught_at FROM catches ORDER BY caught_at DESC LIMIT ? OFFSET ?')
        .bind(limit, offset).all()
      return json({ ok: true, value: { catches: rows.results } })
    }

    if (req.method === 'GET' && path === '/api/stats') {
      const totals = await env.DB.prepare(
        'SELECT COUNT(*) AS catches, COUNT(DISTINCT public_key) AS divers FROM catches').first<{ catches: number,
           divers: number } | null>()
      const histogram = await env.DB.prepare(
        'SELECT rarity, COUNT(*) AS n FROM catches GROUP BY rarity').all()
      return json({ ok: true, value: { totals: totals ?? { catches: 0, divers: 0 }, histogram: histogram.results } })
    }

    const diverMatch = path.match(/^\/api\/diver\/([A-Za-z0-9+/=]+)$/)
    if (req.method === 'GET' && diverMatch !== null) {
      const key = decodeURIComponent(diverMatch[1] ?? '')
      const diver = await env.DB.prepare(
        'SELECT total_catches, deepest, rarest, first_seen_at, last_active_at FROM divers WHERE public_key = ?')
        .bind(key).first()
      if (diver === null) return json({ ok: false, error: 'unknown diver' }, 404)
      const recent = await env.DB.prepare(
        'SELECT card_id, name, rarity, depth, zone, caught_at FROM catches ' +
          'WHERE public_key = ? ORDER BY caught_at DESC LIMIT 30',
      )
        .bind(key).all()
      return json({ ok: true, value: { diver, catches: recent.results } })
    }

    /* ---------------- v2 routes ---------------- */

    if (req.method === 'POST' && path === '/admin/mint') {
      return handleMint(req, env)
    }

    if (req.method === 'POST' && path === '/admin/rechain') {
      return handleRechain(req, env)
    }

    if (req.method === 'GET' && path === '/admin/names') {
      // Every minted card name — the mint CLI's uniqueness avoid-list.
      if (env.ADMIN_TOKEN === undefined || env.ADMIN_TOKEN === '') {
        return json({ ok: false, error: 'mint disabled (no ADMIN_TOKEN)' }, 503)
      }
      const auth = req.headers.get('authorization') ?? ''
      if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: 'forbidden' }, 403)
      const rows = await env.DB.prepare('SELECT name FROM pool_cards ORDER BY name').all<{ name: string }>()
      return json({ ok: true, value: rows.results.map((row) => row.name) })
    }

    if (req.method === 'GET' && path === '/api/release') {
      return await handleRelease(env)
    }

    if (req.method === 'POST' && path === '/api/pow/attempt') {
      return await handleAttempt(req, env)
    }

    if (req.method === 'GET' && path === '/api/pow/next') {
      return await handlePowNext(req, env)
    }

    if (req.method === 'GET' && path === '/api/pool/stats') {
      const rows = await env.DB.prepare(
        'SELECT zone, rarity, COUNT(*) AS remaining FROM pool_cards WHERE status = \'in_pool\' GROUP BY zone, rarity',
      ).all()
      const tip = await env.DB.prepare(
        'SELECT height, hash FROM ledger ORDER BY height DESC LIMIT 1',
      ).first<{ height: number, hash: string } | null>()
      return json({ ok: true, value: { remaining: rows.results, tip } })
    }

    if (req.method === 'GET' && path === '/api/chain') {
      const rows = await env.DB.prepare(
        'SELECT height, prev_hash, hash, kind, created_at FROM ledger ORDER BY height',
      ).all()
      return json({ ok: true, value: { blocks: rows.results } })
    }

    if (req.method === 'GET' && path === '/api/star') {
    const name = url.searchParams.get('name') ?? ''
    if (name.length === 0 || name.length > 64) return json({ ok: false, error: 'bad name' }, 400)
    const poolRow = await env.DB.prepare('SELECT star FROM pool_cards WHERE name = ?')
      .bind(name).first<{ star: string | null }>()
    const star = poolRow?.star ?? starOf(name)
    return json({ ok: true, value: { name, star, starRank: starRankOfStar(star) } })
  }
  if (req.method === 'GET' && path === '/api/chain/verify-assets') {
      return handleVerifyAssets(env, url)
    }

    if (req.method === 'GET' && path === '/api/chain/verify') {
      const rows = await env.DB.prepare(
        'SELECT height, prev_hash, hash, kind, payload FROM ledger ORDER BY height',
      ).all<{ height: number, prev_hash: string, hash: string, kind: string, payload: string }>()
      let prev = GENESIS_HASH
      for (const block of rows.results) {
        if (block.prev_hash !== prev) {
          return json({ ok: true, value: { valid: false, brokenAt: block.height, reason: 'prev_hash mismatch' } })
        }
        const expect = await sha256Hex(`${block.prev_hash}|${block.kind}|${block.payload}`)
        if (expect !== block.hash) {
          return json({ ok: true, value: { valid: false, brokenAt: block.height, reason: 'hash mismatch' } })
        }
        prev = block.hash
      }
      return json({ ok: true, value: { valid: true, blocks: rows.results.length } })
    }

    const faunaMatch = path.match(/^\/assets\/fauna\/([a-z0-9_]+)\.png$/)
    if (req.method === 'GET' && faunaMatch !== null) {
      // MiniMax-painted fauna sprites (see scripts/gen-fauna.ts), served
      // straight from R2 with immutable caching.
      const kind = faunaMatch[1] ?? ''
      const obj = await env.BUCKET.get('fauna/' + kind + '.png')
      if (obj === null) return json({ ok: false, error: 'not found' }, 404)
      const bytes = await obj.arrayBuffer()
      return new Response(bytes, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      })
    }

    const decorMatch = path.match(/^\/assets\/decor\/([a-z0-9_]+)\.png$/)
    if (req.method === 'GET' && decorMatch !== null) {
      // MiniMax-painted seabed-plant sprites (see scripts/gen-decor.ts),
      // served straight from R2 with immutable caching — same shape as
      // the fauna route, just a different key namespace.
      const name = decorMatch[1] ?? ''
      const obj = await env.BUCKET.get('decor/' + name + '.png')
      if (obj === null) return json({ ok: false, error: 'not found' }, 404)
      const bytes = await obj.arrayBuffer()
      return new Response(bytes, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      })
    }

    const surfaceMatch = path.match(/^\/assets\/surface\/([a-z0-9_]+)\.png$/)
    if (req.method === 'GET' && surfaceMatch !== null) {
      // v49 water-surface props (island / boat silhouettes, see
      // scripts/gen-surface-v49.ts) — alpha-processed transparent PNGs
      // from R2, same shape as the decor route.
      const name = surfaceMatch[1] ?? ''
      const obj = await env.BUCKET.get('surface/' + name + '.png')
      if (obj === null) return json({ ok: false, error: 'not found' }, 404)
      const bytes = await obj.arrayBuffer()
      return new Response(bytes, {
        headers: {
          'content-type': 'image/png',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      })
    }

    const assetMatch = path.match(/^\/assets\/cards\/([^/]+)\/(art|holo|mask)\.png$/)
    if (req.method === 'GET' && assetMatch !== null) {
      return handleAsset(env, assetMatch[1] ?? '', assetMatch[2] ?? '')
    }

    const audioMatch = path.match(/^\/assets\/audio\/([a-z0-9_]+)\.mp3$/)
    if (req.method === 'GET' && audioMatch !== null) {
      // Game audio (bgm loop, sfx, rarity voice lines) from R2; the client
      // busts the immutable cache with a ?v= version param.
      const obj = await env.BUCKET.get('audio/' + (audioMatch[1] ?? '') + '.mp3')
      if (obj === null) return json({ ok: false, error: 'not found' }, 404)
      const bytes = await obj.arrayBuffer()
      return new Response(bytes, {
        headers: {
          'content-type': 'audio/mpeg',
          'cache-control': 'public, max-age=31536000, immutable',
          'access-control-allow-origin': '*',
        },
      })
    }

    return json({ ok: false, error: 'not found' }, 404)
  },
}
