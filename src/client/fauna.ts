/**
 * fauna.ts — MiniMax-painted sprite layer for the ocean engine (both the
 * main ocean and the pond draw through it). Sprites are minted by
 * scripts/gen-fauna.ts and served by the Worker from R2; any kind
 * without a loaded sprite falls back to the engine's procedural drawing,
 * so this is strictly additive and offline-safe.
 */


import type { Creature } from './engine.ts'
import { ZONES } from './depth.ts'

/** Zone-native species dominate each band; ~1 in 5 is a visitor from a
 * neighbouring depth so every screen shows a rotating mix (feedback: at
 * any one depth it was always the same few kinds).
 */
const ZONE_KINDS: ReadonlyArray<readonly Creature['kind'][]> = [
  ['fish', 'fish', 'fish', 'turtle', 'hatchet', 'jelly'],
  ['hatchet', 'hatchet', 'jelly', 'fish', 'turtle', 'viper'],
  ['viper', 'squid', 'squid', 'jelly', 'hatchet', 'angler', 'eel'],
  ['angler', 'eel', 'octopus', 'angler', 'squid', 'viper'],
]

/** Build one roaming ocean creature for a depth band; yFrac pins the
 * spawn depth inside the band (stratified lanes — fish never swim up/down).
 * `kinds` is the ocean profile's pool for this zone (falls back to the
 * historical zone mix when omitted). */
export function makeOceanCreature(zone: number, w: number, ylo: number, yhi: number, baseHue: number,
  yFrac?: number, kinds?: readonly Creature['kind'][]): Creature {
  const pool = kinds !== undefined && kinds.length > 0 ? kinds : ZONE_KINDS[zone] ?? ['fish']
  const kind = pool[Math.floor(Math.random() * pool.length)] ?? 'fish'
  return {
    zone, kind,
    x: Math.random() * w,
    y: ylo + (yFrac ?? Math.random()) * Math.max(yhi - ylo, 10),
    vx: (Math.random() * 0.4 + 0.18) * (Math.random() < 0.5 ? -1 : 1),
    size: kind === 'turtle' ? 26 : kind === 'angler' ? 22 + Math.random() * 10 : 12 + Math.random() * 10,
    hue: baseHue + (Math.random() * 68 - 34),
    phase: Math.random() * Math.PI * 2,
  }
}

export type FaunaSprites = ReadonlyMap<string, HTMLImageElement>

export const FAUNA_KINDS: readonly string[] = [
  'fish', 'turtle', 'hatchet', 'jelly', 'viper', 'squid', 'angler', 'octopus', 'eel',
  // v45 ambient fauna (user: 无名小鱼 + 虾蟹鳝鱼). These are sprite
  // keys for the pond's background population — the engine sets
  // spriteKey 'minnow' / 'swamp_eel' on the fish / eel ambient slots
  // (drawFaunaSprite falls back to the kind sprite if the painted
  // one is missing), and shrimp / crab's kind IS the sprite key.
  // They never appear in the OCEAN's ZONE_KINDS / cardKindOf pools
  // (those still use the original 9 kind sprites), so this list
  // expansion is purely additive — v=4 cache buster stays the same
  // because the worker serves immutable, and the new files just
  // happen to load alongside the old ones.
  'minnow', 'shrimp', 'crab', 'swamp_eel',
]

const FAUNA_BASE = 'https://deepsea.openclawd.qzz.io/assets/fauna/'

/** Load every sprite; failures resolve individually (map just omits them). */
export async function loadFaunaSprites(): Promise<FaunaSprites> {
  const settled = await Promise.allSettled(FAUNA_KINDS.map((kind) =>
    new Promise<[string, HTMLImageElement]>((resolve, reject) => {
    const img = new Image()
    img.onload = () => { resolve([kind, img]) }
    img.onerror = () => { reject(new Error('fauna sprite failed: ' + kind)) }
    // v=4 busts the immutable worker cache after the v39 heading audit:
    // angler/octopus/eel shipped head-LEFT (the v=3 normalization missed
    // them) — all three mirrored + re-uploaded after a personal eye/box
    // audit of all 9 kind sprites.
    img.src = FAUNA_BASE + kind + '.png?v=4'
  })))
  const sprites = new Map<string, HTMLImageElement>()
  for (const entry of settled) {
    if (entry.status === 'fulfilled') sprites.set(entry.value[0], entry.value[1])
  }
  return sprites
}

/** Cache-buster for card sprites: bumped whenever sprites are fixed in
 * place (mirrored / regenerated) so every client refetches — mirrors the
 * fauna ?v=4 convention. v3: 2026-08-24 heading fixes (v46/v48 rounds). */
const CARD_SPRITE_V = 3

/** Load per-card pond sprites (generated from each card's own art by
 * scripts/gen-card-sprites.ts, served by the host as sprite.png). Missing
 * ones simply stay absent — the kind sprite takes over. */
export async function loadCardSprites(cardIds: ReadonlyArray<string>): Promise<FaunaSprites> {
  const settled = await Promise.allSettled(cardIds.map((id) =>
    new Promise<[string, HTMLImageElement]>((resolve, reject) => {
    const img = new Image()
    img.onload = () => { resolve([id, img]) }
    img.onerror = () => { reject(new Error('card sprite failed: ' + id)) }
    img.src = '/deepsea/assets/' + id + '/sprite.png?v=' + CARD_SPRITE_V
  })))
  const sprites = new Map<string, HTMLImageElement>()
  for (const entry of settled) {
    if (entry.status === 'fulfilled') sprites.set(entry.value[0], entry.value[1])
  }
  return sprites
}

/** Draw one creature with its painted sprite, tinted toward the
 * creature's hue and flipped to its swim direction. Returns false when
 * the kind has no sprite loaded — the caller then draws procedurally. */
export function drawFaunaSprite(
  ctx: CanvasRenderingContext2D,
  c: { kind: string, x: number, y: number, vx: number, size: number, phase: number, hue: number, spriteKey?: string },
  sprites: FaunaSprites,
  baseHue: number,
): boolean {
  // Per-card sprite (pond) wins; fall back to the kind sprite, then to the
  // engine's procedural drawing when neither is available.
  const img = sprites.get(c.spriteKey ?? c.kind) ?? (c.spriteKey !== undefined ? sprites.get(c.kind) : undefined)
  if (img === undefined || !img.complete || img.naturalWidth === 0) return false
  // Fit the sprite inside a size*3.2 box on its LONGER side — MiniMax
  // sometimes paints tall/diagonal subjects, and width-driven scaling made
  // those enormous enough to bury the pond.
  const box = c.size * 3.2
  const ar = img.naturalWidth / img.naturalHeight
  const w = ar >= 1 ? box : box * ar
  const h = ar >= 1 ? box / ar : box
  ctx.save()
  ctx.translate(c.x, c.y)
  if (c.vx < 0) ctx.scale(-1, 1)
  ctx.rotate(Math.sin(c.phase) * 0.09)
  ctx.filter = 'hue-rotate(' + Math.round((c.hue - baseHue) * 1.5) + 'deg)'
  ctx.drawImage(img, -w / 2, -h / 2, w, h)
  ctx.filter = 'none'
  ctx.restore()
  return true
}

/** Name keywords → creature shape, so the pond/ocean animal READS as the
 * card. Originally lived in pond.tsx; promoted to fauna.ts in v40 so the
 * ocean's card-spirit outfit can use the same mapping. */
const CARD_KIND_RULES: ReadonlyArray<readonly [string, Creature['kind']]> = [
  ['玳', 'turtle'], ['瑁', 'turtle'],
  ['鮟', 'angler'], ['鱇', 'angler'],
  ['鱿', 'squid'],
  ['鲸', 'turtle'],
  ['鲉', 'fish'], ['鲽', 'fish'],
  ['龟', 'turtle'],
  ['鳗', 'eel'],
  ['蛇', 'viper'], ['蝰', 'viper'],
  ['章', 'octopus'], ['蛸', 'octopus'],
  ['母', 'jelly'],
  ['斧', 'hatchet'],
  ['灯', 'angler'], ['烛', 'angler'], ['萤', 'angler'], ['苂', 'angler'],
  ['鲨', 'fish'], ['鲛', 'fish'], ['鲷', 'fish'], ['鲶', 'fish'], ['鱼', 'fish'],
  // 憨眸墨豆 — 发光鱿鱼 (species: firefly squid). MUST come AFTER 灯/烛/蝰
  // so the 6 other 墨* angler/viper cards (墨蕊噬灯, 墨棘蝰鱼, 墨烬蝰,
  // 墨鳞噬灯, 墨吻噬灯姬, 憨眸墨烛) keep their natural routing — only
  // 憨眸墨豆 falls through to here. Off-list addition per the bug-fix
  // dispatch; verified against 219 actual card dirs + 108 heroes.
  ['墨', 'squid'],
]

/** Stable string hash (FNV-1a 32-bit, unsigned). Same shape as the
 * pond's private helper — duplicated here so fauna.ts stays a leaf with
 * zero deps beyond engine/depth (no imports back into pond.tsx). */
function fnv1a(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic kind for a card: name keywords first, then species
 * keywords, then a name-hash pick inside its zone's fauna — same card,
 * same animal, forever. Name wins over species (species never shadows
 * a name match). `zone` is a numeric depth index (0..3); non-finite
 * values fall back to 0. `species` is the card's authored species
 * string (CardRecord.species); undefined / empty short-circuits to the
 * original 2-arg behaviour (name rules → zone hash fallback, nothing
 * else). */
export function cardKindOf(name: string, zone: number, species?: string): Creature['kind'] {
  const z = Number.isFinite(zone) ? Math.max(0, Math.min(zone | 0, ZONES.length - 1)) : 0
  for (const [kw, kind] of CARD_KIND_RULES) {
    if (name.includes(kw)) return kind
  }
  if (typeof species === 'string' && species !== '') {
    for (const [kw, kind] of CARD_KIND_RULES) {
      if (species.includes(kw)) return kind
    }
  }
  const kinds: Creature['kind'][] = z === 0
    ? ['fish', 'fish', 'turtle'] : z === 1
      ? ['hatchet', 'jelly', 'fish'] : z === 2
        ? ['viper', 'squid', 'jelly', 'fish'] : ['angler', 'eel', 'octopus', 'squid']
  const h = fnv1a(name)
  return kinds[h % kinds.length] ?? 'fish'
}

/** Group the diver's card collection by creature kind so the ocean engine
 * can dress every fauna slot in a matching card spirit. Output keys are
 * the creature `kind` strings; each value is the deduped list of card ids
 * whose name (and species, when supplied) resolves to that kind under
 * `cardKindOf`. Duplicate names (same card pulled twice from the deck)
 * collapse to one id — the spirit pool stays bounded even if a collector
 * owns thirty of the same turtle. An empty input yields an empty map
 * (no thrown errors). */
export function groupCardSpiritsByKind(
  cards: ReadonlyArray<{ id: string, name: string, zone: string, species?: string }>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const seenByName = new Set<string>()
  for (const card of cards) {
    if (card === null || card === undefined) continue
    if (typeof card.id !== 'string' || card.id === '') continue
    if (typeof card.name !== 'string' || card.name === '') continue
    if (seenByName.has(card.name)) continue
    seenByName.add(card.name)
    const zi = ZONES.findIndex((z) => z.id === card.zone)
    const zone = zi >= 0 ? zi : 0
    const kind = cardKindOf(card.name, zone, card.species)
    const bucket = out.get(kind)
    if (bucket === undefined) out.set(kind, [card.id])
    else bucket.push(card.id)
  }
  return out
}
