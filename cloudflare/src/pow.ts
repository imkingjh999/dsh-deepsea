/**
 * Server-adjudicated PoW lottery (v3 draw flow, UNCAPPED).
 *
 * One card from the 108-card catalog is on release at a time, with
 * UNLIMITED copies: every correct solver mints a copy, and the next card
 * rotates in only when the release's random window (10–20 min from open)
 * elapses — there is no winners-count cap. On each bite the client asks
 * for an attempt; the SERVER mints the challenge (target + pubkey +
 * per-diver counter), hashes it once, and decides the outcome — the
 * client's own WebCrypto hash is pure reveal theater, never trusted. Win
 * rule: sha256(challenge)'s tail (last 8 hex chars → 32-bit unsigned)
 * must be divisible by WIN_DIVISOR (5) → win odds exactly 1/5, escape
 * 80%, uniform for manual and auto alike. Replaces the old nibble-mask
 * rule (which could only express power-of-two odds). DIFFICULTY is no
 * longer the win rule; it is only the tail length used for display and
 * slicing (e.g. `digest.slice(-1)`). Per-diver one-copy-per-card
 * uniqueness lives on pow_wins (PK(pubkey, mint_id)) and is enforced
 * here as `duplicate`.
 */
import { sha256Hex } from './chain.ts'
import {
  releaseIndex, releaseWindowMs,
  DIFFICULTY, WIN_DIVISOR, ATTEMPT_INTERVAL_MS,
} from './pow-core.ts'
export { releaseIndex } from './pow-core.ts'
// Race lottery knobs live in pow-core (pure, test-importable).
export { DIFFICULTY, WIN_DIVISOR, ATTEMPT_INTERVAL_MS } from './pow-core.ts'
import { json, poolCardJson, verify } from './index.ts'

interface PoolRow {
  mint_id: string, block_height: number, name: string, species: string, story: string,
  rarity: string, zone: string, caught_at: number | null, star: string | null,
}

interface ReleaseRow {
  id: number, mint_id: string, target: string, winners: number,
  opened_at: number, closed_at: number | null,
}

const RARITY_RANK: Record<string, number> = { LEGENDARY: 0, EPIC: 1, RARE: 2, COMMON: 3 }

function randomTarget(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function catalogCard(env: { DB: D1Database }, index: number): Promise<PoolRow | null> {
  const rows = await env.DB.prepare(
    `SELECT mint_id, block_height, name, species, story, rarity, zone, caught_at, star FROM pool_cards
     ORDER BY CASE rarity WHEN 'LEGENDARY' THEN 0 WHEN 'EPIC' THEN 1 WHEN 'RARE' THEN 2 ELSE 3 END,
       mint_id`
  ).all<PoolRow>()
  const list = rows.results
  if (list.length === 0) return null
  return list[((index % list.length) + list.length) % list.length] ?? null
}

async function activeRelease(env: { DB: D1Database }): Promise<ReleaseRow | null> {
  return await env.DB.prepare(
    'SELECT id, mint_id, target, winners, opened_at, closed_at FROM releases '
      + 'WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1'
  ).first<ReleaseRow | null>()
}

/** Open the next release (atomic: only inserts when none is active). */
async function openRelease(env: { DB: D1Database }): Promise<ReleaseRow | null> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM releases')
    .first<{ n: number } | null>()
  const idx = releaseIndex((count?.n ?? 0), 108)
  const card = await catalogCard(env, idx)
  if (card === null) return null
  await env.DB.prepare(
    `INSERT INTO releases (mint_id, target, winners, opened_at)
     SELECT ?, ?, 0, ? WHERE NOT EXISTS (SELECT 1 FROM releases WHERE closed_at IS NULL)`
  ).bind(card.mint_id, randomTarget(), Date.now()).run()
  return await activeRelease(env)
}

/**
 * The CURRENT release, lazily rotating: UNCAPPED — a release ends when
 * its random window (10–20 min, deterministic per release id — see
 * pow-core.releaseWindowMs) elapses. winners is bookkeeping only and
 * never closes the release. There is no cron in Workers, so the window
 * check runs on every read (attempt or /api/release poll) — the first
 * request after expiry closes it and the next card opens.
 */
async function currentRelease(env: { DB: D1Database }): Promise<ReleaseRow | null> {
  const now = Date.now()
  const rel = await activeRelease(env)
  if (rel !== null) {
    const expired = rel.opened_at + releaseWindowMs(rel.id) <= now
    // UNCAPPED: winners count is bookkeeping only — it never triggers a
    // close. The release rotates purely on the window elapsing.
    if (!expired) return rel
    await env.DB.prepare('UPDATE releases SET closed_at = ? WHERE id = ? AND closed_at IS NULL')
      .bind(now, rel.id).run()
  }
  return await openRelease(env)
}

export async function handleRelease(env: { DB: D1Database }): Promise<Response> {
  const rel = await currentRelease(env)
  if (rel === null) return json({ ok: false, error: 'catalog empty' }, 503)
  const windowMs = releaseWindowMs(rel.id)
  const card = await env.DB.prepare(
    'SELECT mint_id, block_height, name, species, story, rarity, zone, caught_at, star '
      + 'FROM pool_cards WHERE mint_id = ?'
  ).bind(rel.mint_id).first<PoolRow | null>()
  if (card === null) return json({ ok: false, error: 'release card missing' }, 500)
  return json({ ok: true, value: {
    releaseId: rel.id, card: poolCardJson(card), target: rel.target,
    winners: rel.winners, difficulty: DIFFICULTY,
    odds: WIN_DIVISOR,
    openedAt: rel.opened_at, windowMs, closesAt: rel.opened_at + windowMs,
  } })
}

interface AttemptPayload { publicKey: string, nonce: string, signature: string, mode?: string }

export async function handleAttempt(req: Request, env: { DB: D1Database }): Promise<Response> {
  let payload: AttemptPayload
  try { payload = (await req.json()) as AttemptPayload } catch { return json({ ok: false, error: 'bad json' }, 400) }
  const { publicKey, nonce, signature } = payload
  if (typeof publicKey !== 'string' || publicKey.length === 0 || publicKey.length > 200) {
    return json({ ok: false, error: 'bad publicKey' }, 400)
  }
  if (typeof nonce !== 'string' || nonce.length < 8 || nonce.length > 64) {
    return json({ ok: false, error: 'bad nonce' }, 400)
  }
  // mode rides the SIGNED message so a client can't flip it after the
  // fact. `undefined` fields are dropped by JSON.stringify, so the
  // serialized form is byte-identical to the legacy {publicKey, nonce}
  // message when mode is absent — old hosts keep verifying unchanged.
  const message = JSON.stringify({ publicKey, nonce, mode: payload.mode })
  if (!(await verify(publicKey, message, signature))) {
    return json({ ok: false, error: 'signature mismatch' }, 403)
  }

  const now = Date.now()
  // Per-diver win-only gate on CHALLENGE ISSUANCE (not on submission) —
  // grinding offline is impossible because the input is unknowable before.
  // INSERT OR IGNORE keeps the first-touch row lazily initialized.
  await env.DB.prepare('INSERT OR IGNORE INTO pow_divers (pubkey, last_attempt_at) VALUES (?, 0)')
    .bind(publicKey).run()
  // Read the cooldown stamp first — then bump the per-attempt counter on
  // every attempt (so the challenge stays fresh) — but only stamp
  // last_attempt_at when a card is actually minted. A miss (escape /
  // duplicate / full / network error) does NOT consume the 5-min wait:
  // the diver may grab again immediately. Gate check is read-then-act so
  // a race can only delay, not skip, the cooldown.
  const preRow = await env.DB.prepare('SELECT last_attempt_at FROM pow_divers WHERE pubkey = ?')
    .bind(publicKey).first<{ last_attempt_at: number | null } | null>()
  const last = preRow?.last_attempt_at ?? 0
  if (last > now - ATTEMPT_INTERVAL_MS) {
    const wait = Math.max(last + ATTEMPT_INTERVAL_MS - now, 0)
    return json({ ok: false, error: 'too-soon', retryAfterMs: wait }, 429)
  }
  // Fresh attempt: bump the counter (challenge seq) but leave
  // last_attempt_at untouched — the stamp only lands on a real win.
  await env.DB.prepare(
    'UPDATE pow_divers SET attempt_seq = attempt_seq + 1 WHERE pubkey = ?'
  ).bind(publicKey).run()
  const seqRow = await env.DB.prepare('SELECT attempt_seq FROM pow_divers WHERE pubkey = ?')
    .bind(publicKey).first<{ attempt_seq: number } | null>()
  const seq = seqRow?.attempt_seq ?? 1

  const rel = await currentRelease(env)
  if (rel === null) return json({ ok: false, error: 'catalog empty' }, 503)

  const challenge = `${rel.target}:${publicKey}:${seq}`
  const digest = await sha256Hex(challenge)
  // Win rule: parse the LAST 8 hex chars (32-bit unsigned int) and check
  // divisibility by WIN_DIVISOR (5). 2^32 mod 5 = 1 → the residue bias
  // across the 2^32 hash space is ~2e-8 — effectively exact uniform
  // 1/5 odds. mode no longer affects odds (kept for the UI's quiet-banner
  // behavior on auto attempts); manual and auto are uniformly 1/5.
  const tail8 = parseInt(digest.slice(-8), 16)
  const won = Number.isFinite(tail8) && tail8 % WIN_DIVISOR === 0
  if (!won) {
    return json({ ok: true, value: {
      won: false, reason: 'escape', challenge, tail: digest.slice(-DIFFICULTY),
      targetTail: rel.target.slice(-DIFFICULTY), winners: rel.winners,
    } })
  }

  // Winning hash — one copy per diver per card: a repeat win falls through
  // without consuming a winner slot.
  const owned = await env.DB.prepare('SELECT 1 FROM pow_wins WHERE pubkey = ? AND mint_id = ?')
    .bind(publicKey, rel.mint_id).first()
  if (owned !== null) {
    return json({ ok: true, value: {
      won: false, reason: 'duplicate', challenge, tail: digest.slice(-DIFFICULTY),
      targetTail: rel.target.slice(-DIFFICULTY), winners: rel.winners,
    } })
  }
  // UNCAPPED claim: just bump winners on an unclosed release. The cap
  // predicate is gone — rotation is window-only, computed lazily in
  // currentRelease. The AND closed_at IS NULL still narrows the row to
  // the live release; the `changes !== 1` guard below is a defensive
  // backstop for the rare window where a concurrent request closes the
  // release between our currentRelease read and this UPDATE
  // (regular path: never triggers).
  const claim = await env.DB.prepare(
    'UPDATE releases SET winners = winners + 1 WHERE id = ? AND closed_at IS NULL'
  ).bind(rel.id).run()
  if (claim.meta.changes !== 1) {
    // Defensive backstop: the window closed between our currentRelease
    // read and the UPDATE — rare race. Regular path returns above.
    return json({ ok: true, value: {
      won: false, reason: 'full', challenge, tail: digest.slice(-DIFFICULTY),
      targetTail: rel.target.slice(-DIFFICULTY), winners: rel.winners,
    } })
  }
  await env.DB.prepare('INSERT INTO pow_wins (pubkey, mint_id, release_id, won_at) VALUES (?, ?, ?, ?)')
    .bind(publicKey, rel.mint_id, rel.id, now).run()
  // Win-claim succeeded — stamp last_attempt_at now so the next attempt
  // hits the 5-minute gate. Loss outcomes (escape / duplicate / full) leave
  // the row unchanged so the diver can immediately try again.
  await env.DB.prepare(
    'UPDATE pow_divers SET wins = wins + 1, last_attempt_at = ? WHERE pubkey = ?'
  ).bind(now, publicKey).run()
  const card = await env.DB.prepare(
    'SELECT mint_id, block_height, name, species, story, rarity, zone, caught_at, star '
      + 'FROM pool_cards WHERE mint_id = ?'
  ).bind(rel.mint_id).first<PoolRow | null>()
  if (card === null) return json({ ok: false, error: 'release card missing' }, 500)
  return json({ ok: true, value: {
    won: true, challenge, tail: digest.slice(-DIFFICULTY),
    targetTail: rel.target.slice(-DIFFICULTY), winners: rel.winners + 1,
    // Feed the cooldown down to the client so the UI never has to hard-code
    // a constant that could drift away from the worker's gate.
    retryAfterMs: ATTEMPT_INTERVAL_MS,
    // Diver key mixed into the gold roll → within one release some winners
    // hold gold, others plain.
    card: poolCardJson(card, publicKey),
  } })
}

/**
 * GET /api/pow/next?publicKey=… — how long until this diver may catch
 * again (0 = ready now). Lets clients prime their UI on load instead of
 * discovering the cooldown only after a rejected bite.
 */
export async function handlePowNext(req: Request, env: { DB: D1Database }): Promise<Response> {
  const publicKey = new URL(req.url).searchParams.get('publicKey') ?? ''
  if (publicKey.length === 0 || publicKey.length > 200) {
    return json({ ok: false, error: 'bad publicKey' }, 400)
  }
  const row = await env.DB.prepare('SELECT last_attempt_at FROM pow_divers WHERE pubkey = ?')
    .bind(publicKey).first<{ last_attempt_at: number | null } | null>()
  const now = Date.now()
  const retryAfterMs = row === null || row.last_attempt_at === null
    ? 0
    : Math.max(row.last_attempt_at + ATTEMPT_INTERVAL_MS - now, 0)
  return json({ ok: true, value: { retryAfterMs } })
}