/**
 * POST /admin/rechain — rebuild the card pool on a FRESH chain.
 *
 * Deep-sea relaunch: D1 keeps exactly `keep` (default 108) unique creature
 * cards; the old ledger is wiped and the kept cards are re-minted onto the
 * new chain (same art — R2 objects are copied server-side, no MiniMax cost,
 * no bandwidth through the caller). User catches after this point append
 * catch blocks to the NEW chain only.
 *
 * Body: { action: 'init', keep?: number } → wipe ledger + trim pool to the
 *       keep-set (oldest-first per zone×rarity cell, proportional mix),
 *       return the ordered old mint_ids to re-mint.
 *       { action: 'mint', ids: string[] } → for each old id still present:
 *       copy R2 layers → append mint block → swap rows (delete old, insert
 *       new). Idempotent per id: already-minted names are skipped.
 */
import { appendBlock, blockId } from './chain.ts'
import { starOf } from './stars.ts'

interface PoolRow {
  mint_id: string, block_height: number, name: string, species: string,
  story: string, rarity: string, zone: string,
  art_sha256: string, holo_sha256: string, mask_sha256: string,
}

interface RechainEnv {
  DB: D1Database
  BUCKET: R2Bucket
  ADMIN_TOKEN?: string
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  })
}

/** Proportional per-cell trim: keep `keep` cards total, oldest-first in
 * each (zone, rarity) cell, preserving the current zone×rarity mix. */
export function computeKeep(rows: readonly PoolRow[], keep: number): PoolRow[] {
  const cells = new Map<string, PoolRow[]>()
  for (const row of rows) {
    const key = row.zone + '/' + row.rarity
    const list = cells.get(key) ?? []
    list.push(row)
    cells.set(key, list)
  }
  for (const list of cells.values()) {
    list.sort((a, b) => a.block_height - b.block_height)
  }
  const total = rows.length
  if (total <= keep) return [...rows].sort((a, b) => a.block_height - b.block_height)
  const targets = new Map<string, number>()
  let assigned = 0
  for (const [key, list] of cells) {
    const t = Math.max(1, Math.round((list.length / total) * keep))
    targets.set(key, Math.min(t, list.length))
    assigned += targets.get(key) ?? 0
  }
  // Fix rounding drift against the keep total.
  const keys = [...cells.keys()].sort()
  let i = 0
  while (assigned > keep) {
    const key = keys[i % keys.length] ?? ''
    const room = 0
    const cur = targets.get(key) ?? 0
    if (cur > 1) { targets.set(key, cur - 1); assigned -= 1 }
    i += 1
    if (i > keys.length * 4 && room === 0 && assigned > keep) break
  }
  while (assigned < keep) {
    const key = keys[i % keys.length] ?? ''
    const cur = targets.get(key) ?? 0
    const avail = cells.get(key)?.length ?? 0
    if (cur < avail) { targets.set(key, cur + 1); assigned += 1 }
    i += 1
  }
  const kept: PoolRow[] = []
  for (const [key, list] of cells) {
    kept.push(...list.slice(0, targets.get(key) ?? 0))
  }
  return kept.sort((a, b) => (a.zone + a.rarity + a.block_height)
    .localeCompare(b.zone + b.rarity + String(b.block_height)))
}

export async function handleRechain(req: Request, env: RechainEnv): Promise<Response> {
  if (env.ADMIN_TOKEN === undefined || env.ADMIN_TOKEN === '') {
    return json({ ok: false, error: 'rechain disabled (no ADMIN_TOKEN)' }, 503)
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: 'forbidden' }, 403)
  let body: { action?: string, keep?: number, ids?: string[] }
  try { body = (await req.json()) as typeof body } catch { return json({ ok: false, error: 'bad json' }, 400) }

  if (body.action === 'init') {
    const keep = typeof body.keep === 'number' && body.keep > 0 ? Math.floor(body.keep) : 108
    const rows = (await env.DB.prepare(
      'SELECT mint_id, block_height, name, species, story, rarity, zone, art_sha256, '
        + 'holo_sha256, mask_sha256 FROM pool_cards WHERE status = ?',
    ).bind('in_pool').all<PoolRow>()).results
    const kept = computeKeep(rows, keep)
    const keepSet = new Set(kept.map((row) => row.mint_id))
    const drop = rows.filter((row) => !keepSet.has(row.mint_id)).map((row) => row.mint_id)
    // Fresh chain: wipe the ledger, drop every row NOT in the keep-set.
    // D1 caps bound params per statement (~100), so delete in chunks of 90.
    await env.DB.prepare('DELETE FROM ledger').run()
    await env.DB.prepare('DELETE FROM pool_cards WHERE status = ?').bind('caught').run()
    for (let i = 0; i < drop.length; i += 90) {
      const chunk = drop.slice(i, i + 90)
      await env.DB.prepare(
        'DELETE FROM pool_cards WHERE mint_id IN (' + chunk.map(() => '?').join(',') + ')',
      ).bind(...chunk).run()
    }
    return json({ ok: true, value: { keep, kept: keepSet.size, dropped: drop.length, ids: [...keepSet] } })
  }

  if (body.action === 'mint') {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 20) : []
    const done: string[] = []
    const skipped: string[] = []
    for (const id of ids) {
      const row = await env.DB.prepare(
        'SELECT mint_id, block_height, name, species, story, rarity, zone, art_sha256, '
          + 'holo_sha256, mask_sha256 FROM pool_cards WHERE mint_id = ? AND status = ?',
      ).bind(id, 'in_pool').first<PoolRow | null>()
      if (row === null) { skipped.push(id); continue }
      // Copy art server-side: R2 get old → put under the new mint id.
      const layers: R2ObjectBody[] = []
      let missing = false
      for (const layer of ['art', 'holo', 'mask'] as const) {
        const obj = await env.BUCKET.get(`cards/${id}/${layer}.png`)
        if (obj === null) { missing = true; break }
        layers.push(obj)
      }
      if (missing || layers.length !== 3) { skipped.push(id); continue }
      const block = await appendBlock(env, 'mint', {
        name: row.name, species: row.species, rarity: row.rarity, zone: row.zone,
        artSha256: row.art_sha256, holoSha256: row.holo_sha256, maskSha256: row.mask_sha256,
      })
      const newId = blockId(block.height, block.hash)
      for (let li = 0; li < 3; li += 1) {
        const layer = (['art', 'holo', 'mask'] as const)[li] ?? 'art'
        const body2 = layers[li] ?? layers[0]
        if (body2 === undefined) break
        await env.BUCKET.put(`cards/${newId}/${layer}.png`, body2.body, {
          httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
        })
      }
      // Swap rows: free the name, then insert the new-chain row.
      await env.DB.prepare('DELETE FROM pool_cards WHERE mint_id = ?').bind(id).run()
      await env.DB.prepare(
        'INSERT INTO pool_cards (mint_id, block_height, name, species, story, rarity, zone, '
          + 'art_sha256, holo_sha256, mask_sha256, star) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(newId, block.height, row.name, row.species.slice(0, 64), row.story.slice(0, 500),
        row.rarity, row.zone, row.art_sha256, row.holo_sha256, row.mask_sha256, starOf(row.name)).run()
      done.push(newId)
    }
    const left = (await env.DB.prepare(
      'SELECT COUNT(*) n FROM pool_cards WHERE status = ?')
      .bind('in_pool').first<{ n: number }>())?.n ?? 0
    return json({ ok: true, value: { done: done.length, minted: done, skipped, inPool: left } })
  }

  return json({ ok: false, error: 'unknown action' }, 400)
}
