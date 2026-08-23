/**
 * Host half of dsh-deepsea.
 *
 * Routes (all behind the browser-trust fence):
 *   POST /deepsea/api/catch   {depth, zone} → runs the full pipeline:
 *         rarity roll (depth-weighted) → MiniMax chat (lore JSON) → MiniMax
 *         image-01 (art) → python3 scripts/holo.py (diffraction + ellipse
 *         layers) → card stored on disk → wire record returned.
 *   GET  /deepsea/api/cards    → registry, newest first.
 *   POST /deepsea/api/upload   → relay battle records to the CF Worker
 *         (the browser cannot sign with the host-held Ed25519 key... it can,
 *         but keeping the identity on the host side matches jinyong-xia's
 *         model where telemetry is opt-in; key lives in the data dir).
 *   GET  /deepsea/assets/:id/:file → card PNGs (content-typed, no-store).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPrivateKey, createPublicKey, sign as edSign, generateKeyPairSync } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage as Req, ServerResponse as Res } from 'node:http'

type RouteHandler = (req: Req, res: Res) => void | Promise<void>
interface HostContext {
  effect(callback: () => () => void, label?: string): () => void
  webServer: { register(route: { kind: 'prefix'; path: string; handler: RouteHandler }): () => void }
}
import { CardStore, toWire, type StoredCard } from './cards.ts'
import type { Rarity } from './client/depth.ts'

export const name = 'dsh-deepsea'
export const inject = ['webServer']

interface HostConfig {
  minimaxApiKeyEnv?: string
  minimaxBaseURL?: string
  minimaxModel?: string
  minimaxImageModel?: string
  dataDir?: string
  telemetry?: boolean
  workerUrl?: string
}

const MIME: Record<string, string> = { '.png': 'image/png', '.json': 'application/json; charset=utf-8' }

/** Host-header loopback fence (same trust model as the /api gateway). */
function isTrusted(req: IncomingMessage): boolean {
  const host = req.headers.host ?? ''
  const hostname = host.split(':')[0] ?? ''
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(text)
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 1 << 20) reject(
      new Error('body too large')) })
    req.on('end', () => { resolve(Buffer.concat(chunks)) })
    req.on('error', reject)
  })
}

/** Load (or first-create) the host Ed25519 identity used for battle uploads. */
async function loadIdentity(root: string): Promise<{ publicKey: string, privateKeyPem: string }> {
  const dir = join(root, 'identity')
  const privPath = join(dir, 'ed25519.pem')
  const pubPath = join(dir, 'ed25519.pub.b64')
  if (existsSync(privPath) && existsSync(pubPath)) {
    const privateKeyPem = await readFile(privPath, 'utf8')
    const publicKey = (await readFile(pubPath, 'utf8')).trim()
    return { publicKey, privateKeyPem }
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(dir, { recursive: true })
  await writeFile(privPath, privateKeyPem, { mode: 0o600 })
  await writeFile(pubPath, publicKeyB64, 'utf8')
  return { publicKey: publicKeyB64, privateKeyPem }
}

/**
 * Server-adjudicated PoW attempt (v3): the Worker mints the challenge,
 * hashes it once and decides the outcome; on a win we mirror the released
 * catalog card into the local store. Resolves the attempt payload (win or
 * loss) so the caller can play the right ending; throws on transport errors.
 */
interface PowOutcome {
  won: boolean
  reason: 'escape' | 'duplicate' | 'full' | string
  challenge: string
  tail: string
  targetTail: string
  winners: number
  /** Worker-fed cooldown (ms) — only set on a real win. Lets the host forward
   *  the canonical cooldown straight to the client without re-hardcoding. */
  retryAfterMs?: number
  card?: {
    mintId: string, height: number, name: string, species: string, story: string,
    rarity: string, zone: string, star?: string, starRank?: number, gold?: boolean,
    assets: { art: string, holo: string, mask: string },
  }
}

async function powAttempt(cfg: HostConfig, workerUrl: string, store: CardStore, depth: number, mode?: string):
  Promise<{ outcome: PowOutcome, card: StoredCard | null, retryAfterMs?: number }> {
  const identity = await loadIdentity(store.cardDir('..'))
  // mode rides the signed payload (server validates the signature over the
  // SAME string with mode included). JSON.stringify drops `undefined`, so
  // a manual attempt (mode undefined) is byte-identical to the legacy
  // payload — old worker builds keep verifying unchanged.
  const payload = {
    publicKey: identity.publicKey,
    nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    mode,
  }
  const signature = edSign(null, Buffer.from(JSON.stringify(payload)), createPrivateKey(identity.privateKeyPem))
    .toString('base64')
  const res = await fetch(`${workerUrl}/api/pow/attempt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, signature }),
    signal: AbortSignal.timeout(8000),
  })
  const raw = await res.text()
  let data: { ok: boolean, value?: PowOutcome, error?: string, retryAfterMs?: number }
  try {
    data = JSON.parse(raw) as {
      ok: boolean, value?: PowOutcome, error?: string, retryAfterMs?: number,
    }
  } catch {
    // Non-JSON body (proxy error page) — a descriptive error beats a raw
    // SyntaxError in the catch route's 500 message.
    throw new Error(`pow attempt non-JSON (HTTP ${res.status}): ${raw.slice(0, 120)}`)
  }
  if (!data.ok) {
    if (data.error === 'too-soon' && typeof data.retryAfterMs === 'number') {
      return { outcome: { won: false, reason: 'too-soon', challenge: '', tail: '', targetTail: '',
        winners: 0 }, card: null, retryAfterMs: data.retryAfterMs }
    }
    throw new Error(`pow attempt rejected: ${data.error ?? res.status}`)
  }
  const outcome = data.value
  if (outcome === undefined) throw new Error('pow attempt returned no outcome')
  if (!outcome.won || outcome.card === undefined) return { outcome, card: null }
  const v = outcome.card
  const { id, dir } = await store.newCard()

  // Mirror the three PNG layers so the card works offline (same as v2 draws).
  const { writeFile: wf } = await import('node:fs/promises')
  let localAssets = true
  for (const layer of ['art', 'holo', 'mask'] as const) {
    try {
      const r = await fetch(`${workerUrl}${v.assets[layer]}`, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) throw new Error(`asset ${layer}: HTTP ${r.status}`)
      await wf(join(dir, `${layer}.png`), Buffer.from(await r.arrayBuffer()))
    } catch {
      localAssets = false
      break
    }
  }
  const card: StoredCard = {
    id, name: v.name, species: v.species, rarity: v.rarity as Rarity, story: v.story,
    depth, zone: v.zone, createdAt: Date.now(), model: 'pow/v3',
    art: localAssets ? '' : `${workerUrl}${v.assets.art}`,
    holo: localAssets ? '' : `${workerUrl}${v.assets.holo}`,
    mask: localAssets ? '' : `${workerUrl}${v.assets.mask}`,
    mintId: v.mintId, blockHeight: v.height,
    star: v.star ?? '', starRank: v.starRank ?? 0,
    gold: v.gold === true,
  }
  await store.write(card)
  return { outcome, card }
}

export function apply(ctx: HostContext, config?: HostConfig): void {
  const cfg = config ?? {}
  const store = new CardStore(cfg.dataDir)
  const workerUrl = cfg.workerUrl ?? 'https://deepsea.openclawd.qzz.io'
  let busy = false
  let queueDepth = 0

  const apiHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isTrusted(req)) { writeJson(res, 403, { ok: false, error: { code: 'forbidden', message:
       'untrusted host' } }); return }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const method = url.pathname.replace(/^\/deepsea\/api/, '') || '/'

    if (req.method === 'GET' && method === '/cards') {
      writeJson(res, 200, { ok: true, value: { cards: (await store.list()).map(toWire) } })
      return
    }

    if (req.method === 'POST' && method === '/catch') {
      if (busy) { queueDepth++; if (queueDepth > 2) { writeJson(res, 429, { ok: false, error: { code: 'busy', message:
         '卡片生成中，稍后再试' } }); return } }
      busy = true
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8')) as
          { depth?: number, zone?: string, mode?: unknown }
        const depth = Math.min(Math.max(typeof body.depth === 'number' ? body.depth : 0, 0), 1)
        const mode = typeof body.mode === 'string' ? body.mode : undefined

        // v3 PoW lottery: the server mints the challenge and adjudicates the
        // single hash; loss reasons map to distinct client endings.
        const { outcome, card, retryAfterMs } = await powAttempt(cfg, workerUrl, store, depth, mode)
        if (outcome.reason === 'too-soon') {
          writeJson(res, 429, { ok: false, error: { code: 'too-soon', message: '刚抓到卡牌，冷却中', retryAfterMs } })
          return
        }
        if (card === null) {
          writeJson(res, 200, { ok: true, value: { escaped: true, reason: outcome.reason,
            challenge: outcome.challenge, tail: outcome.tail, targetTail: outcome.targetTail } })
          return
        }
        writeJson(res, 200, { ok: true, value: { escaped: false, card: toWire(card),
          challenge: outcome.challenge, tail: outcome.tail, targetTail: outcome.targetTail,
          retryAfterMs: outcome.retryAfterMs } })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        writeJson(res, 400, { ok: false, error: { code: 'catch-failed', message } })
      } finally {
        busy = false
        if (queueDepth > 0) queueDepth--
      }
      return
    }

    if (req.method === 'POST' && method === '/upload') {
      try {
        const body = JSON.parse((await readBody(req)).toString('utf8')) as { cards?: StoredCard[] }
        const cards = Array.isArray(body.cards) ? body.cards.slice(0, 200) : []
        const identity = await loadIdentity(store.cardDir('..'))
        const payload = {
          publicKey: identity.publicKey,
          caughtAt: Date.now(),
          // v4 anti-cheat: mintId is the only claim the worker trusts —
          // it counts a card only if (publicKey, mintId) is in its
          // pow_wins ledger. Legacy local cards (no mint) verify as 0.
          cards: cards.map((c) => ({ id: c.id, mintId: c.mintId ?? '', name: c.name, rarity: c.rarity,
            depth: c.depth, zone: c.zone, createdAt: c.createdAt })),
        }
        const payloadText = JSON.stringify(payload)
        const signature = edSign(null, Buffer.from(payloadText), createPrivateKey(identity.privateKeyPem)).toString(
          'base64')
        const r = await fetch(`${workerUrl}/api/upload`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, signature }),
          signal: AbortSignal.timeout(15_000),
        })
        const text = await r.text()
        if (!r.ok) throw new Error(`worker HTTP ${r.status}: ${text.slice(0, 120)}`)
        writeJson(res, 200, { ok: true, value: { uploaded: cards.length } })
      } catch (err) {
        writeJson(res, 400, { ok: false, error: { code: 'upload-failed', message: err instanceof Error ? err.message :
           String(err) } })
      }
      return
    }

    if (req.method === 'GET' && method === '/me') {
      // The local diver's identity — the leaderboard highlights this key.
      try {
        const identity = await loadIdentity(store.cardDir('..'))
        writeJson(res, 200, { ok: true, value: { publicKey: identity.publicKey } })
      } catch {
        writeJson(res, 200, { ok: true, value: { publicKey: '' } })
      }
      return
    }

    if (req.method === 'GET' && method === '/authstart') {
      // v5 GitHub link: sign the link material with the local identity so
      // the worker can prove the initiator holds this diver's private key
      // (nobody can bind someone else's pubkey to their GitHub account).
      // The worker re-verifies the same flat string at /auth/github/start
      // AND at the OAuth callback — the message format must stay
      // byte-stable with cloudflare/src/github-auth.ts linkMessage().
      try {
        const identity = await loadIdentity(store.cardDir('..'))
        const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const ts = Date.now()
        const message = `deepsea-github-link:${identity.publicKey}:${nonce}:${ts}`
        const sig = edSign(null, Buffer.from(message), createPrivateKey(identity.privateKeyPem)).toString('base64')
        const u = `${workerUrl}/auth/github/start?pubkey=${encodeURIComponent(identity.publicKey)}`
          + `&nonce=${encodeURIComponent(nonce)}&ts=${String(ts)}&sig=${encodeURIComponent(sig)}`
        writeJson(res, 200, { ok: true, value: { url: u } })
      } catch (err) {
        writeJson(res, 400, { ok: false, error: { code: 'authstart-failed',
          message: err instanceof Error ? err.message : String(err) } })
      }
      return
    }

    if (req.method === 'GET' && method === '/nextcatch') {
      // Remaining catch-cooldown for THIS diver, straight from the worker —
      // lets the client prime its UI on load instead of learning the block
      // only after a rejected bite (no more "generating card" tease).
      try {
        const identity = await loadIdentity(store.cardDir('..'))
        const r = await fetch(`${workerUrl}/api/pow/next?publicKey=${encodeURIComponent(identity.publicKey)}`,
          { signal: AbortSignal.timeout(4000) })
        const data = JSON.parse(await r.text()) as { ok: boolean, value?: { retryAfterMs?: number } }
        writeJson(res, 200, { ok: true,
          value: { retryAfterMs: data.ok === true ? (data.value?.retryAfterMs ?? 0) : 0 } })
      } catch {
        writeJson(res, 200, { ok: true, value: { retryAfterMs: 0 } })
      }
      return
    }

    writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown API method' } })
  }

  const assetHandler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isTrusted(req)) { res.writeHead(403); res.end(); return }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const m = url.pathname.match(/^\/deepsea\/assets\/([A-Za-z0-9-]+)\/(art|holo|mask|sprite)\.png$/)
    if (m === null) { writeJson(res, 404, { ok: false, error: { code: 'not-found', message:
       'no such asset' } }); return }
    const [, id, file] = m
    const path = join(store.cardDir(id ?? ''), `${file}.png`)
    if (!existsSync(path)) { writeJson(res, 404, { ok: false, error: { code: 'not-found', message:
       'no such asset' } }); return }
    const bytes = await readFile(path)
    res.writeHead(200, { 'content-type': MIME['.png'], 'cache-control': 'no-store' })
    res.end(bytes)
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/deepsea/api', handler: apiHandler }),
    'deepsea: api routes',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/deepsea/assets', handler: assetHandler }),
    'deepsea: card assets',
  )
  void createPublicKey // (identity exports public keys on first run)
}
