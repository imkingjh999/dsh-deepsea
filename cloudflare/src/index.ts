/**
 * deepsea-leaderboard — Cloudflare Worker (D1).
 *
 * Zero API-key battle-record backend with Ed25519 signature verification
 * (pattern: pi-jinyong-xia/xia-leaderboard). The plugin's host half holds a
 * per-installation Ed25519 key pair and signs every upload; the Worker only
 * trusts payloads signed by a registered public key.
 *
 * Endpoints:
 *   POST /api/upload      — v4 anti-cheat: READ-ONLY confirmation of
 *                           already-adjudicated wins (Ed25519 signed);
 *                           a card counts only if (publicKey, mintId)
 *                           exists in pow_wins — forged cards are
 *                           silently dropped, nothing is ever written
 *   GET  /api/wall        — latest catches across all divers (limit, offset)
 *   GET  /api/stats       — global counters + rarity histogram
 *   GET  /api/diver/:key  — one diver's profile + recent catches
 *
 * v4 anti-cheat: every public stat reads pow_wins (the server-adjudicated
 * ledger) joined to pool_cards — leaders, wall, stats and diver profiles
 * can no longer be inflated by self-reported uploads. The legacy
 * catches/divers tables are retired as data sources.
 *
 * v5 GitHub identity: only divers who bound their key to a GitHub account
 * (OAuth via /auth/github/*) appear on the public leaderboard, shown by
 * their GitHub username. Binding requires an Ed25519 signature over the
 * link material (github-auth.ts), so nobody can claim someone else's
 * stats; one GitHub account maps to one key. pow_wins remains the only
 * stats source — the link is purely an identity layer.
 *   GET  /auth/github/start     — verify sig, 302 to GitHub authorize
 *   GET  /auth/github/callback  — code→token→user, upsert github_links
 *   GET  /api/link?publicKey=   — this key's binding (login/avatar/none)
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
import { candidateMints, type UploadCard } from './upload-gate.ts'
import { decodeState, encodeState, linkFresh, linkMessage } from './github-auth.ts'
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
  /** GitHub OAuth App credentials (wrangler secret put GITHUB_CLIENT_SECRET;
   * client id is public — var GITHUB_CLIENT_ID). */
  GITHUB_CLIENT_ID?: string
  GITHUB_CLIENT_SECRET?: string
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
      if (!Array.isArray(cards) || cards.length === 0 || cards.length > RULES.MAX_CARDS_PER_BATCH) {
        return json({ ok: false, error: 'bad cards' }, 400)
      }
      // The signature still proves possession of the submitting key
      // (sybil keys sign fine — they just never win anything to report).
      // Signature covers everything except the signature field itself.
      const message = JSON.stringify({ publicKey, caughtAt, cards })
      if (!(await verify(publicKey, message, signature))) {
        return json({ ok: false, error: 'signature mismatch' }, 403)
      }
      // v4 anti-cheat: uploads are READ-ONLY confirmations. A card counts
      // only when the server itself adjudicated the win — (publicKey,
      // mintId) must exist in pow_wins. Forged rarity/depth/names are
      // ignored entirely: nothing is written, so the wall, the leaders
      // and the stats (all of which read pow_wins) can never be polluted.
      // Legacy batches without mintId verify as 0 — old hosts keep
      // working, they simply have nothing the server can confirm.
      const mintIds = candidateMints(cards)
      let verified = 0
      if (mintIds.length > 0) {
        const ph = mintIds.map(() => '?').join(',')
        const rows = await env.DB.prepare(
          `SELECT mint_id FROM pow_wins WHERE pubkey = ? AND mint_id IN (${ph})`,
        ).bind(publicKey, ...mintIds).all<{ mint_id: string }>()
        verified = rows.results.length
      }
      return json({ ok: true, value: { stored: verified, verified } })
    }

    /* ---------------- v5 GitHub identity routes ---------------- */

    if (req.method === 'GET' && path === '/auth/github/start') {
      if (env.GITHUB_CLIENT_ID === undefined || env.GITHUB_CLIENT_SECRET === undefined) {
        return json({ ok: false, error: 'github oauth not configured' }, 503)
      }
      const pubkey = url.searchParams.get('pubkey') ?? ''
      const nonce = url.searchParams.get('nonce') ?? ''
      const ts = Number(url.searchParams.get('ts') ?? '')
      const sig = url.searchParams.get('sig') ?? ''
      if (pubkey.length === 0 || pubkey.length > 200 || nonce.length < 8 || nonce.length > 64 ||
          !Number.isFinite(ts) || sig.length === 0 || sig.length > 200) {
        return json({ ok: false, error: 'bad params' }, 400)
      }
      if (!linkFresh(ts, Date.now())) return json({ ok: false, error: 'link expired, retry' }, 400)
      if (!(await verify(pubkey, linkMessage(pubkey, nonce, ts), sig))) {
        return json({ ok: false, error: 'signature mismatch' }, 403)
      }
      const state = encodeState({ pubkey, nonce, ts, sig })
      const redirect = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        env.GITHUB_CLIENT_ID)}&redirect_uri=${encodeURIComponent(
        'https://deepsea.openclawd.qzz.io/auth/github/callback')}&scope=read:user&state=${encodeURIComponent(state)}`
      return Response.redirect(redirect, 302)
    }

    if (req.method === 'GET' && path === '/auth/github/callback') {
      if (env.GITHUB_CLIENT_ID === undefined || env.GITHUB_CLIENT_SECRET === undefined) {
        return json({ ok: false, error: 'github oauth not configured' }, 503)
      }
      const code = url.searchParams.get('code') ?? ''
      const stateRaw = url.searchParams.get('state') ?? ''
      const state = decodeState(stateRaw)
      if (code.length === 0 || state === null) return json({ ok: false, error: 'bad callback' }, 400)
      if (!linkFresh(state.ts, Date.now())) return json({ ok: false, error: 'link expired, retry' }, 400)
      // Re-verify the signature at callback time: the state param is
      // attacker-controllable, the signature over it is not.
      if (!(await verify(state.pubkey, linkMessage(state.pubkey, state.nonce, state.ts), state.sig))) {
        return json({ ok: false, error: 'signature mismatch' }, 403)
      }
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'deepsea-leaderboard' },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
          code, redirect_uri: 'https://deepsea.openclawd.qzz.io/auth/github/callback',
        }),
      })
      const tokenData = await tokenRes.json() as { access_token?: string }
      if (typeof tokenData.access_token !== 'string' || tokenData.access_token === '') {
        return json({ ok: false, error: 'github denied the code' }, 403)
      }
      const userRes = await fetch('https://api.github.com/user', {
        headers: { authorization: `Bearer ${tokenData.access_token}`, accept: 'application/vnd.github+json',
          'user-agent': 'deepsea-leaderboard' },
      })
      const user = await userRes.json() as { id?: number, login?: string, avatar_url?: string }
      if (typeof user.id !== 'number' || typeof user.login !== 'string' || user.login === '') {
        return json({ ok: false, error: 'github user lookup failed' }, 502)
      }
      // GitHub identity owns the row: rebinding a GitHub account to a new
      // key replaces the old key's row (device change), and re-linking a
      // key to a new GitHub account replaces the old login.
      await env.DB.prepare(
        `INSERT INTO github_links (pubkey, github_id, github_login, avatar_url, linked_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(pubkey) DO UPDATE SET github_id = excluded.github_id,
           github_login = excluded.github_login, avatar_url = excluded.avatar_url,
           linked_at = excluded.linked_at
         ON CONFLICT(github_id) DO UPDATE SET pubkey = excluded.pubkey,
           avatar_url = excluded.avatar_url, linked_at = excluded.linked_at`,
      ).bind(state.pubkey, user.id, user.login, String(user.avatar_url ?? '').slice(0, 300), Date.now()).run()
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>deepsea</title></head>
<body style="background:#01030a;color:#cfe6ff;font:14px/1.6 system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center">
<div style="text-align:center">🐟 GitHub 绑定成功：@${user.login}<br>可关闭此页，回到深海窗口查看排行榜</div></body></html>`
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    }

    if (req.method === 'GET' && path === '/api/link') {
      const publicKey = url.searchParams.get('publicKey') ?? ''
      if (publicKey.length === 0 || publicKey.length > 200) return json({ ok: false, error: 'bad publicKey' }, 400)
      const row = await env.DB.prepare(
        'SELECT github_login, avatar_url FROM github_links WHERE pubkey = ?',
      ).bind(publicKey).first<{ github_login: string, avatar_url: string } | null>()
      return json({ ok: true, value: { login: row?.github_login ?? '', avatarUrl: row?.avatar_url ?? '' } })
    }

    if (req.method === 'GET' && path === '/api/leaders') {
      // Global diver ranking, v5: aggregated straight from pow_wins (the
      // server-adjudicated ledger) joined to pool_cards — self-reported
      // data can no longer inflate any number. rarest is derived from the
      // won cards' true rarities. v5: only GitHub-linked divers appear
      // (the INNER-style WHERE on the LEFT JOIN drops unlinked keys —
      // "sign in before you can submit to the leaderboard"), shown by
      // their GitHub username. Unlinked divers simply don't exist here.
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100)
      const rows = await env.DB.prepare(
        'SELECT w.pubkey AS public_key, COUNT(*) AS total_catches, MAX(w.won_at) AS last_active_at, ' +
          'COALESCE(SUM(CASE WHEN p.rarity = \'RARE\' THEN 1 ELSE 0 END), 0) AS rare_count, ' +
          'COALESCE(SUM(CASE WHEN p.rarity = \'EPIC\' THEN 1 ELSE 0 END), 0) AS epic_count, ' +
          'COALESCE(SUM(CASE WHEN p.rarity = \'LEGENDARY\' THEN 1 ELSE 0 END), 0) AS legendary_count, ' +
          'CASE WHEN SUM(CASE WHEN p.rarity = \'LEGENDARY\' THEN 1 ELSE 0 END) > 0 THEN \'LEGENDARY\' ' +
          'WHEN SUM(CASE WHEN p.rarity = \'EPIC\' THEN 1 ELSE 0 END) > 0 THEN \'EPIC\' ' +
          'WHEN SUM(CASE WHEN p.rarity = \'RARE\' THEN 1 ELSE 0 END) > 0 THEN \'RARE\' ' +
          'ELSE \'COMMON\' END AS rarest, ' +
          'g.github_login, g.avatar_url ' +
          'FROM pow_wins w JOIN pool_cards p ON p.mint_id = w.mint_id ' +
          'JOIN github_links g ON g.pubkey = w.pubkey ' +
          'GROUP BY w.pubkey ' +
          'ORDER BY total_catches DESC, last_active_at DESC LIMIT ?')
        .bind(limit).all()
      return json({ ok: true, value: { leaders: rows.results } })
    }

    if (req.method === 'GET' && path === '/api/wall') {
      // v4: the wall streams server-adjudicated wins only — card_id is
      // the mint, caught_at is the ledger's won_at. depth is not returned
      // (it was self-reported and is retired everywhere).
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200)
      const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)
      const rows = await env.DB.prepare(
        'SELECT p.mint_id AS card_id, p.name, p.rarity, p.zone, w.won_at AS caught_at, g.github_login ' +
          'FROM pow_wins w JOIN pool_cards p ON p.mint_id = w.mint_id ' +
          'LEFT JOIN github_links g ON g.pubkey = w.pubkey ' +
          'ORDER BY w.won_at DESC LIMIT ? OFFSET ?')
        .bind(limit, offset).all()
      return json({ ok: true, value: { catches: rows.results } })
    }

    if (req.method === 'GET' && path === '/api/stats') {
      // v4: stats count only server-adjudicated wins.
      const totals = await env.DB.prepare(
        'SELECT COUNT(*) AS catches, COUNT(DISTINCT pubkey) AS divers FROM pow_wins').first<{ catches: number,
           divers: number } | null>()
      const histogram = await env.DB.prepare(
        'SELECT p.rarity AS rarity, COUNT(*) AS n FROM pow_wins w JOIN pool_cards p ON p.mint_id = w.mint_id ' +
          'GROUP BY p.rarity').all()
      return json({ ok: true, value: { totals: totals ?? { catches: 0, divers: 0 }, histogram: histogram.results } })
    }

    const diverMatch = path.match(/^\/api\/diver\/([A-Za-z0-9+/=]+)$/)
    if (req.method === 'GET' && diverMatch !== null) {
      // v4: a diver's profile is their win ledger, nothing else.
      const key = decodeURIComponent(diverMatch[1] ?? '')
      const diver = await env.DB.prepare(
        'SELECT COUNT(*) AS total_catches, MIN(w.won_at) AS first_seen_at, MAX(w.won_at) AS last_active_at, ' +
          'CASE WHEN SUM(CASE WHEN p.rarity = \'LEGENDARY\' THEN 1 ELSE 0 END) > 0 THEN \'LEGENDARY\' ' +
          'WHEN SUM(CASE WHEN p.rarity = \'EPIC\' THEN 1 ELSE 0 END) > 0 THEN \'EPIC\' ' +
          'WHEN SUM(CASE WHEN p.rarity = \'RARE\' THEN 1 ELSE 0 END) > 0 THEN \'RARE\' ' +
          'ELSE \'COMMON\' END AS rarest, g.github_login ' +
          'FROM pow_wins w JOIN pool_cards p ON p.mint_id = w.mint_id ' +
          'LEFT JOIN github_links g ON g.pubkey = w.pubkey WHERE w.pubkey = ?')
        .bind(key).first()
      if (diver === null) return json({ ok: false, error: 'unknown diver' }, 404)
      const recent = await env.DB.prepare(
        'SELECT p.mint_id AS card_id, p.name, p.rarity, p.zone, w.won_at AS caught_at FROM pow_wins w ' +
          'JOIN pool_cards p ON p.mint_id = w.mint_id ' +
          'WHERE w.pubkey = ? ORDER BY w.won_at DESC LIMIT 30',
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
