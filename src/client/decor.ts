/**
 * decor.ts — seabed decorations: seaweed, kelp, coral, rocks, anemones,
 * ice spires, tube worms, starfish.
 *
 * Everything is STATELESS per frame: item positions are deterministic
 * fractions of the canvas WIDTH (seeded by the ocean id + index), the
 * floor is anchored wherever the caller roots it, sway is a horizontal
 * sin(t) bend, and sizes derive from the passed scale. No stored pixel
 * state → window resizes stay exactly proportional with zero bookkeeping
 * (the engine's resize path is never touched), and nothing here swims
 * vertically — plants bend, they never travel.
 *
 * seaweed / kelp / coral / starfish are SPRITE-ONLY: a MiniMax-painted
 * sprite (served by the Worker at GET /assets/decor/<kind>.png, uploaded
 * by scripts/gen-decor.ts + scripts/gen-decor-v45.ts) is loaded once into
 * a module-scoped cache and drawn rooted at (x, floorY) with a gentle
 * sin() sway. When the cache is empty (offline / load failure / pre-load)
 * the renderer draws NOTHING — the floor stays bare rather than rendering
 * mismatched silhouettes. On load we crop the source rectangle to the last
 * row of dense pixels so the sprite's real plant base lands flush on the
 * floor and any loose debris below the plant is discarded.
 *
 * soil is NOT a decor item — it's a tiled floor band consumed by
 * pond-bg.ts. See loadSoilSprite there.
 */
import type { DecorKind, OceanProfile } from './oceans.ts'

export interface DecorItem {
  kind: DecorKind
  /** Root x as a fraction of canvas width (0..1). */
  xFrac: number
  /** Size multiplier (0.7…1.35). */
  s: number
  /** Per-item phase seed for sway. */
  seed: number
}

/** Which decor kinds can use a MiniMax-painted sprite today. v45 adds
 * coral + starfish; the v44 hand-coded coral (warm-orange 4-arm line,
 * the "红黄水草" the user complained about) and the procedural starfish
 * are no longer reachable from the pond — see pond-bg.ts sprite guard.
 *
 * soil is a SEPARATE sprite namespace (not a DecorSpriteKind) because
 * it isn't a decor item (no xFrac, no sway) — the loader fetches it
 * alongside the others but pond-bg.ts reads it through a dedicated
 * getSoilSprite() helper, never through drawDecorItem. */
export type DecorSpriteKind = 'seaweed' | 'kelp' | 'coral' | 'starfish'

/** Per-kind target sprite height (same units as `scale` passed to the
 * drawer) — v39 shrank both (user: 海草太长太多) so the pond floor keeps
 * breathing room: seaweed reads as tufts, kelp as a modest frond instead
 * of a pillar. v45 added coral (compact fan) and starfish (low to the
 * ground). The renderer is sprite-only; a missing sprite means no
 * plant is painted for that kind. */
export const DECOR_SPRITE_HEIGHT: Record<DecorSpriteKind, number> = {
  seaweed: 1.1,
  kelp: 1.9,
  coral: 1.0,
  starfish: 0.5,
}

/** Cached sprite + its source-cropped height (the last row that holds a
 * real plant base; debris below is discarded at draw time). */
interface DecorSpriteEntry {
  img: HTMLImageElement
  /** cropH in source pixels: the bottom-most row whose opaque-pixel ratio
   * crosses the threshold. The sprite is drawn only inside [0, cropH). */
  cropH: number
}

/** Module-scoped sprite cache (filled by loadDecorSprites). soil lives
 * here too but is read through getSoilSprite() (pond-bg.ts), not via
 * drawDecorItem. */
const decorSpriteCache: Map<string, DecorSpriteEntry> = new Map()

/** True when the cache already holds (or definitively failed) a kind. */
const decorSpriteAttempted: Set<string> = new Set()

const DECOR_BASE = 'https://deepsea.openclawd.qzz.io/assets/decor/'

/** Alpha threshold (0–255) and per-row coverage ratio used by scanBaseRow.
 * A row counts as "plant base" when its opaque-pixel share meets or
 * exceeds `BASE_ROW_RATIO`. Picked so a fully-painted kelp stem and the
 * thick tuft at the base of a seaweed sprite both qualify, while sparse
 * water-bubble noise alone does not. */
const BASE_ROW_ALPHA = 40
const BASE_ROW_RATIO = 0.12

/** Find the lowest source row that still belongs to the plant. Sprites
 * generated for vertical plants often trail off into loose debris (water
 * droplets, faint glow) below the actual rooted base; drawing those
 * pixels keeps the plant floating above the floor. Walk upward from the
 * very last row and return the first row whose share of pixels with
 * alpha > BASE_ROW_ALPHA is at least BASE_ROW_RATIO of the row width —
 * the row right above is the last paint row we want to keep.
 *
 * Returns `naturalHeight` when no row qualifies (e.g. a clean silhouette
 * that fades smoothly into transparency, or a fully-opaque image). Any
 * throw from `getImageData` (tainted canvas, off-DOM, jsdom) falls back to
 * `naturalHeight` so callers always get a usable crop. */
function scanBaseRow(img: HTMLImageElement): number {
  const nh = img.naturalHeight
  const nw = img.naturalWidth
  if (nh <= 0 || nw <= 0) return nh
  let canvas: HTMLCanvasElement | null = null
  let ctx: CanvasRenderingContext2D | null = null
  try {
    canvas = document.createElement('canvas')
    canvas.width = nw
    canvas.height = nh
    ctx = canvas.getContext('2d')
    if (ctx === null) return nh
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, nw, nh).data
    const stride = nw * 4
    const needed = Math.max(1, Math.floor(nw * BASE_ROW_RATIO))
    // Walk bottom → top. We want the LAST (lowest) qualifying row so the
    // plant base stays glued to floorY.
    for (let y = nh - 1; y >= 0; y -= 1) {
      let opaque = 0
      const rowStart = y * stride
      for (let x = 0; x < nw; x += 1) {
        if ((data[rowStart + x * 4 + 3] ?? 0) > BASE_ROW_ALPHA) opaque += 1
        if (opaque >= needed) break
      }
      if (opaque >= needed) return y + 1
    }
    return nh
  } catch {
    return nh
  } finally {
    // Drop the scratch canvas eagerly so the GC can reclaim the buffer.
    if (canvas !== null) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}

/** Load the seaweed + kelp + coral + starfish + soil sprites (see
 * scripts/gen-decor.ts + scripts/gen-decor-v45.ts). Each kind is
 * requested independently; failures resolve to "no sprite" and the
 * renderer draws nothing for that kind (soil fails closed: pond-bg
 * falls back to drawFloorBand's gradient). Idempotent — re-calling
 * is a no-op once the cache settles. v45 widened the kind list; we
 * keep ?v=1 (worker serves immutable) — the v45 kinds (coral,
 * starfish, soil) had no old cached entry to bust, and seaweed/kelp
 * assets did not change in v45. */
export async function loadDecorSprites(): Promise<void> {
  const kinds: string[] = ['seaweed', 'kelp', 'coral', 'starfish', 'soil']
  await Promise.allSettled(kinds.map((kind) => new Promise<void>((resolve) => {
    if (decorSpriteAttempted.has(kind)) { resolve(); return }
    decorSpriteAttempted.add(kind)
    const img = new Image()
    img.onload = () => {
      // Crop the source rectangle to the plant's true base so debris
      // below the root doesn't pull the silhouette off the floor.
      let cropH = scanBaseRow(img)
      if (cropH <= 0 || cropH > img.naturalHeight) cropH = img.naturalHeight
      decorSpriteCache.set(kind, { img, cropH })
      resolve()
    }
    img.onerror = () => { resolve() }
    // v=1 — bump on decor asset changes (worker serves immutable).
    img.src = DECOR_BASE + kind + '.png?v=1'
  })))
}

/** True iff the cache holds a usable image for this kind. */
export function hasDecorSprite(kind: DecorSpriteKind): boolean {
  const entry = decorSpriteCache.get(kind)
  return entry !== undefined && entry.img.complete && entry.img.naturalWidth > 0
}

/** Read-only access to the soil sprite entry (used by pond-bg.ts to tile
 * the seabed band). Returns null when the sprite hasn't loaded yet
 * (offline / pre-load / load failure) so the pond can fall back to
 * drawFloorBand's gradient. */
export function getSoilSprite(): { img: HTMLImageElement, w: number, h: number } | null {
  const entry = decorSpriteCache.get('soil')
  if (entry === undefined) return null
  if (!entry.img.complete || entry.img.naturalWidth === 0) return null
  return { img: entry.img, w: entry.img.naturalWidth, h: entry.img.naturalHeight }
}

/** Small string hash → uint32 (FNV-1a, same flavor as pond.tsx). */
function fnv(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const VALID_KINDS: readonly DecorKind[] = ['seaweed', 'kelp', 'coral', 'rock', 'anemone', 'ice', 'tubeWorm', 'starfish']

/**
 * Deterministic decor layout for one ocean profile: expand the profile's
 * decor census into positioned items. Same profile + count → same layout
 * forever (stable across frames); pass fewer items for a smaller floor
 * (the pond draws a subset).
 */
export function seededDecor(profile: OceanProfile, maxItems = Infinity): readonly DecorItem[] {
  const items: DecorItem[] = []
  for (const kind of VALID_KINDS) {
    const n = profile.decor[kind] ?? 0
    for (let i = 0; i < n && items.length < maxItems; i += 1) {
      const h = fnv(profile.id + ':' + kind + ':' + i)
      items.push({
        kind,
        xFrac: 0.03 + ((h >>> 8) % 1000) / 1000 * 0.94,
        s: 0.7 + ((h >>> 4) % 100) / 100 * 0.65,
        seed: (h % 628) / 100,
      })
    }
  }
  // Spread left→right so neighbors never stack after census expansion.
  items.sort((a, b) => a.xFrac - b.xFrac)
  return items
}

/**
 * Draw one decor item rooted at (x, floorY). `scale` ties the size to the
 * scene (e.g. canvas height × factor) so resize keeps proportions.
 * Vertical position is fixed to the floor; only horizontal sway moves.
 *
 * For seaweed + kelp + coral + starfish a MiniMax sprite (when loaded)
 * is the ONLY render path — sprite-only. With no sprite cached we draw
 * nothing so the silhouette never mismatches (offline / pre-load / load
 * failure). The source rectangle is cropped to the cached `cropH` so the
 * plant's true base lands flush on floorY and any debris below is
 * discarded. v45 added coral and starfish — the v44 hand-coded coral
 * (the warm-orange 4-arm line the user called 红黄水草) and procedural
 * starfish are no longer reachable from the OCEAN (where the census
 * doesn't include starfish anyway); the POND skips them via the
 * sprite-required guard in pond-bg.ts.
 */
export function drawDecorItem(ctx: CanvasRenderingContext2D, item: DecorItem, x: number, floorY: number, t: number,
  scale: number): void {
  const sway = Math.sin(t * 0.6 + item.seed)
  const s = item.s * scale
  // Sprite short-circuit for the four plant kinds we ship painted for.
  // With the sprite in the cache we paint it; without the sprite we
  // fall through to the procedural switch below — so the OCEAN keeps
  // the v44 procedural coral / starfish as an offline fallback (the
  // POND, via pond-bg.ts's hasDecorSprite guard, never reaches this
  // function for those two kinds, so the procedural code is unreachable
  // there in practice but still kept for the ocean + offline story).
  // soil is not a decor item so it never lands here.
  if (item.kind === 'seaweed' || item.kind === 'kelp' || item.kind === 'coral' || item.kind === 'starfish') {
    const kind = item.kind
    const entry = decorSpriteCache.get(kind)
    if (entry !== undefined && entry.img.complete && entry.img.naturalWidth > 0) {
      const { img, cropH } = entry
      const tall = s * DECOR_SPRITE_HEIGHT[kind]
      const safeCropH = cropH > 0 && cropH <= img.naturalHeight ? cropH : img.naturalHeight
      const ar = img.naturalWidth / safeCropH
      const h = tall
      const w = tall * ar
      const rot = Math.sin(t * 0.6 + item.seed) * 0.06
      ctx.save()
      ctx.translate(x, floorY)
      ctx.rotate(rot)
      // 9-arg drawImage clips the source rect to [0, 0, naturalWidth, cropH]
      // so the cached "last dense row + 1" defines the visible base.
      ctx.drawImage(img, 0, 0, img.naturalWidth, safeCropH, -w / 2, -h, w, h)
      ctx.restore()
      return
    }
    // No sprite → fall through to the procedural switch below.
  }
  switch (item.kind) {
    case 'coral': {
      // Branching coral: a warm-toned fan, gently wiggling tips.
      const hgt = s * 0.9
      ctx.strokeStyle = `hsl(${(18 + item.seed * 4) % 360} 62% 58%)`
      ctx.lineWidth = Math.max(2, s * 0.07)
      for (let b = 0; b < 4; b += 1) {
        const ang = -Math.PI / 2 + (b - 1.5) * 0.38 + sway * 0.05
        ctx.beginPath()
        ctx.moveTo(x, floorY)
        ctx.lineTo(x + Math.cos(ang) * hgt * 0.7, floorY + Math.sin(ang) * hgt)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x + Math.cos(ang) * hgt * 0.4, floorY + Math.sin(ang) * hgt * 0.6)
        ctx.lineTo(x + Math.cos(ang) * hgt * 0.4 + Math.cos(ang + 0.45) * hgt * 0.35,
          floorY + Math.sin(ang) * hgt * 0.6 + Math.sin(ang + 0.45) * hgt * 0.35)
        ctx.stroke()
      }
      break
    }
    case 'rock': {
      // Rounded boulder cluster — static mass, no sway.
      ctx.fillStyle = 'rgba(70,84,102,0.55)'
      ctx.beginPath()
      ctx.ellipse(x, floorY, s * 0.34, s * 0.22, 0, Math.PI, 0)
      ctx.fill()
      ctx.fillStyle = 'rgba(88,102,120,0.45)'
      ctx.beginPath()
      ctx.ellipse(x + s * 0.3, floorY, s * 0.18, s * 0.13, 0, Math.PI, 0)
      ctx.fill()
      break
    }
    case 'anemone': {
      // Sea anemone: tentacle crown waving horizontally.
      const hgt = s * 0.5
      ctx.strokeStyle = `hsl(${(320 + item.seed * 6) % 360} 55% 62%)`
      ctx.lineWidth = Math.max(1.5, s * 0.045)
      for (let b = 0; b < 7; b += 1) {
        const ang = -Math.PI / 2 + (b - 3) * 0.22 + sway * 0.12
        ctx.beginPath()
        ctx.moveTo(x, floorY)
        ctx.quadraticCurveTo(
          x + Math.cos(ang) * hgt * 0.5, floorY + Math.sin(ang) * hgt * 0.6,
          x + Math.cos(ang) * hgt + sway * s * 0.06, floorY + Math.sin(ang) * hgt)
        ctx.stroke()
      }
      break
    }
    case 'ice': {
      // Ice spire: pale translucent tooth leaning with the current.
      const hgt = s * 1.3
      const lean = sway * s * 0.08
      ctx.fillStyle = 'rgba(200,230,250,0.35)'
      ctx.beginPath()
      ctx.moveTo(x - s * 0.16, floorY)
      ctx.lineTo(x + lean, floorY - hgt)
      ctx.lineTo(x + s * 0.18, floorY)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = 'rgba(160,205,235,0.25)'
      ctx.beginPath()
      ctx.moveTo(x + s * 0.05, floorY)
      ctx.lineTo(x + s * 0.2 + lean * 0.6, floorY - hgt * 0.6)
      ctx.lineTo(x + s * 0.3, floorY)
      ctx.closePath()
      ctx.fill()
      break
    }
    case 'tubeWorm': {
      // Chitinous tube with a waving plume tip.
      const hgt = s * 0.7
      ctx.fillStyle = 'rgba(226,220,214,0.5)'
      ctx.fillRect(x - s * 0.05, floorY - hgt, s * 0.1, hgt)
      ctx.strokeStyle = `hsl(${(186 + item.seed * 5) % 360} 60% 60%)`
      ctx.lineWidth = Math.max(1.5, s * 0.05)
      ctx.beginPath()
      ctx.moveTo(x, floorY - hgt)
      ctx.quadraticCurveTo(x + sway * s * 0.14, floorY - hgt * 1.25, x + sway * s * 0.24, floorY - hgt * 1.5)
      ctx.stroke()
      break
    }
    case 'starfish': {
      // Five-armed star pressed onto the sand (the v44 pond decor). Outer
      // radius r, inner radius 0.45r, arms squashed 0.55 vertically so it
      // reads as a flat sea-star, not a spiked disc. Center sits a hair
      // above floorY so the lower half stays on the dune curve instead of
      // being clipped by the sand. A gentle `sway*0.03` tilt makes the
      // critter feel alive without flipping over; arm-tip stipples add
      // the matte texture of real echinoderm skin.
      const r = s * 0.2
      const ir = r * 0.45
      const tipY = floorY - r * 0.3
      const tilt = sway * 0.03
      ctx.save()
      ctx.translate(x, tipY)
      ctx.rotate(tilt)
      ctx.fillStyle = `hsl(${(10 + item.seed * 12) % 360} 68% 56%)`
      ctx.beginPath()
      for (let arm = 0; arm < 5; arm += 1) {
        const ang = -Math.PI / 2 + arm * (Math.PI * 2 / 5)
        const tipX = Math.cos(ang) * r
        const tipYY = Math.sin(ang) * r * 0.55
        const nextAng = -Math.PI / 2 + (arm + 0.5) * (Math.PI * 2 / 5)
        const notchX = Math.cos(nextAng) * ir
        const notchY = Math.sin(nextAng) * ir * 0.55
        if (arm === 0) ctx.moveTo(tipX, tipYY)
        else ctx.lineTo(tipX, tipYY)
        ctx.lineTo(notchX, notchY)
      }
      ctx.closePath()
      ctx.fill()
      // Tip stipples: 2–3 dark dots near each arm tip so the surface
      // reads as textured skin, not flat color. Drawn after the fill so
      // they sit on top of the warm body color.
      ctx.fillStyle = 'rgba(60,30,20,0.55)'
      for (let arm = 0; arm < 5; arm += 1) {
        const ang = -Math.PI / 2 + arm * (Math.PI * 2 / 5)
        const baseX = Math.cos(ang) * r * 0.78
        const baseY = Math.sin(ang) * r * 0.78 * 0.55
        for (let d = 0; d < 3; d += 1) {
          const dotAng = ang + (d - 1) * 0.18
          const dx = baseX + Math.cos(dotAng) * r * 0.1
          const dy = baseY + Math.sin(dotAng) * r * 0.1 * 0.55
          ctx.beginPath()
          ctx.arc(dx, dy, Math.max(0.6, r * 0.07), 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
      break
    }
  }
}

/** Dune surface y at world x for a floor rooted at floorY — the exact
 * curve drawFloorBand paints. Exported so the pond can root plants INTO
 * the soil at the same local depth (v43: 绿色海草插到土壤里). */
export function duneSurfaceY(x: number, floorY: number): number {
  return floorY + Math.sin(x * 0.02 + 1.3) * 6
}

/** Draw a soft sediment dune band along a floor line (shared ground for
 * both the ocean seabed and the pond floor). */
export function drawFloorBand(ctx: CanvasRenderingContext2D, w: number, floorY: number, bottomY: number,
  tint: { r: number, g: number, b: number }, x0 = 0): void {
  const cl = (v: number): number => Math.round(Math.min(Math.max(v, 0), 255))
  const top = `rgba(${cl(198 + tint.r)},${cl(178 + tint.g)},${cl(140 + tint.b)},0.12)`
  const bot = `rgba(${cl(172 + tint.r)},${cl(150 + tint.g)},${cl(116 + tint.b)},0.34)`
  const dune = ctx.createLinearGradient(0, floorY - 16, 0, bottomY)
  dune.addColorStop(0, top)
  dune.addColorStop(1, bot)
  ctx.fillStyle = dune
  ctx.beginPath()
  ctx.moveTo(x0, bottomY)
  for (let x = x0; x <= w; x += 24) ctx.lineTo(x, duneSurfaceY(x, floorY))
  ctx.lineTo(w, bottomY)
  ctx.closePath()
  ctx.fill()
}
