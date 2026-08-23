/**
 * v2 card-pool handlers — mint, R2 asset serving and asset-integrity
 * verification for the hash-chain ledger, extracted from index.ts (v46
 * slim-down) with no behavior change. index.ts keeps the route table and
 * delegates /admin/mint, /assets/cards/* and /api/chain/verify-assets to
 * the handlers below. json/RARITY_ORDER/Env come from './index.ts' — the
 * same shared-module import pattern pow.ts already uses.
 */
import { starOf } from './stars.ts'
import { appendBlock, blockId, sha256Hex } from './chain.ts'
import { json, RARITY_ORDER, type Env } from './index.ts'

/* ------------------------------------------------------------------ *
 * v2: hash-chain ledger + pre-minted card pool
 * ------------------------------------------------------------------ */

const ZONES = ['sunlit', 'twilight', 'midnight', 'abyss'] as const
const LAYERS = ['art', 'holo', 'mask'] as const

interface MintCardBody {
  name: string
  species: string
  story: string
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
  zone: (typeof ZONES)[number]
  /** base64 PNG bytes for each layer. */
  artB64: string
  holoB64: string
  maskB64: string
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

export async function handleMint(req: Request, env: Env): Promise<Response> {
  if (env.ADMIN_TOKEN === undefined || env.ADMIN_TOKEN === '') {
    return json({ ok: false, error: 'mint disabled (no ADMIN_TOKEN)' }, 503)
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ ok: false, error: 'forbidden' }, 403)

  let card: MintCardBody
  try { card = (await req.json()) as MintCardBody } catch { return json({ ok: false, error: 'bad json' }, 400) }
  if (typeof card.name !== 'string' || card.name.length === 0 || card.name.length > 64) {
    return json({ ok: false, error: 'bad name' }, 400)
  }
  if (!(RARITY_ORDER as readonly string[]).includes(card.rarity)) return json({ ok: false, error: 'bad rarity' }, 400)
  if (!(ZONES as readonly string[]).includes(card.zone)) return json({ ok: false, error: 'bad zone' }, 400)
  for (const layer of LAYERS) {
    const b64 = card[`${layer}B64` as keyof MintCardBody]
    if (typeof b64 !== 'string' || b64.length < 100) return json({ ok: false, error: `bad ${layer} bytes` }, 400)
  }
  // Uniqueness gate: every card is one of a kind - reject a name that already
  // exists BEFORE touching the ledger or R2, so a retry never wastes a block.
  // The UNIQUE(name) index remains the hard backstop against races.
  const taken = await env.DB.prepare('SELECT 1 FROM pool_cards WHERE name = ?').bind(card.name).first()
  if (taken !== null) return json({ ok: false, error: 'duplicate-name', message: 'card names must be unique' }, 409)

  const [artHash, holoHash, maskHash] = await Promise.all([
    sha256Hex(card.artB64), sha256Hex(card.holoB64), sha256Hex(card.maskB64),
  ])
  const block = await appendBlock(env, 'mint', {
    name: card.name, species: card.species, rarity: card.rarity, zone: card.zone,
    artSha256: artHash, holoSha256: holoHash, maskSha256: maskHash,
  })
  const mintId = blockId(block.height, block.hash)
  await env.BUCKET.put(`cards/${mintId}/art.png`, b64ToBytes(card.artB64), {
    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  })
  await env.BUCKET.put(`cards/${mintId}/holo.png`, b64ToBytes(card.holoB64), {
    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  })
  await env.BUCKET.put(`cards/${mintId}/mask.png`, b64ToBytes(card.maskB64), {
    httpMetadata: { contentType: 'image/png', cacheControl: 'public, max-age=31536000, immutable' },
  })
  try {
    await env.DB.prepare(
      `INSERT INTO pool_cards (mint_id, block_height, name, species, story, rarity, zone, art_sha256,
         holo_sha256, mask_sha256, star) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(mintId, block.height, card.name, card.species.slice(0, 64), card.story.slice(0, 500),
      card.rarity, card.zone, artHash, holoHash, maskHash, starOf(card.name)).run()
  } catch (e) {
    // UNIQUE(name) index: this creature name already exists — every card must be
    // one of a kind. Signal the mint CLI so it regenerates a fresh creature.
    if (e instanceof Error && e.message.includes('UNIQUE')) {
      return json({ ok: false, error: 'duplicate-name', message: 'card names must be unique' }, 409)
    }
    throw e
  }
  return json({ ok: true, value: { mintId, height: block.height, hash: block.hash } })
}

export async function handleAsset(env: Env, mintId: string, layer: string): Promise<Response> {
  if (!(LAYERS as readonly string[]).includes(layer as (typeof LAYERS)[number])) {
    return json({ ok: false, error: 'bad layer' }, 400)
  }
  if (!/^DS-\d{4}-[0-9a-f]{8}$/.test(mintId)) return json({ ok: false, error: 'bad mint id' }, 400)
  const obj = await env.BUCKET.get(`cards/${mintId}/${layer}.png`)
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

/**
 * Asset integrity check: pick pool cards (random sample or one mint_id),
 * download each PNG layer from R2, recompute sha256(base64(bytes)) and
 * compare against the mint-time fingerprint stored in pool_cards. Catches
 * "swapped the image but left the ledger alone" tampering.
 *   GET /api/chain/verify-assets            -> sample up to 5 cards
 *   GET /api/chain/verify-assets?sample=10  -> sample up to 10 cards
 *   GET /api/chain/verify-assets?mint=DS-0002-fc067a1b -> one card
 */
export async function handleVerifyAssets(env: Env, url: URL): Promise<Response> {
  const mintParam = url.searchParams.get('mint')
  const sampleParam = Number.parseInt(url.searchParams.get('sample') ?? '5', 10)
  const sample = Number.isNaN(sampleParam) ? 5 : Math.min(Math.max(sampleParam, 1), 12)
  interface PoolRow { mint_id: string, name: string, art_sha256: string, holo_sha256: string,
    mask_sha256: string }
  const rows: PoolRow[] = mintParam !== null && mintParam !== ''
    ? (await env.DB.prepare(
        'SELECT mint_id, name, art_sha256, holo_sha256, mask_sha256 FROM pool_cards WHERE mint_id = ?',
      ).bind(mintParam).all<PoolRow>()).results
    : (await env.DB.prepare(
        'SELECT mint_id, name, art_sha256, holo_sha256, mask_sha256 FROM pool_cards ' +
          'ORDER BY RANDOM() LIMIT ' + String(sample),
      ).all<PoolRow>()).results
  const checked: Array<{ mintId: string, name: string, ok: boolean, layers: Record<string, boolean> }> = []
  for (const row of rows) {
    const layers: Record<string, boolean> = {}
    for (const layer of LAYERS) {
      const expect = row[(layer + '_sha256') as 'art_sha256' | 'holo_sha256' | 'mask_sha256']
      const obj = await env.BUCKET.get('cards/' + row.mint_id + '/' + layer + '.png')
      if (obj === null) { layers[layer] = false; continue }
      const bytes = new Uint8Array(await obj.arrayBuffer())
      const b64 = b64Encode(bytes)
      layers[layer] = await sha256Hex(b64) === expect
    }
    checked.push({ mintId: row.mint_id, name: row.name, ok: Object.values(layers).every(Boolean), layers })
  }
  return json({ ok: true, value: { checked: checked.length, allOk: checked.every((c) => c.ok), cards: checked } })
}

/** Standard base64 (the mint path stores sha256 of this encoding). */
function b64Encode(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i] ?? 0)
  return btoa(s)
}
