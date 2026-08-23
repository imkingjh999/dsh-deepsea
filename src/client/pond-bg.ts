/**
 * pond-bg.ts — ambient backdrop for the fish pond. Purely decorative,
 * drawn before the creatures: light rays from the surface, a sandy
 * floor with the SESSION OCEAN's decor census (kelp, rock, ice …),
 * and drifting motes. Everything is derived from the passed time and
 * the deterministic decor layout (no per-frame randomness), so the
 * scene is stable across frames and cheap to draw.
 *
 * v44 pond floor + abundance retune (user: 土壤图层改在海草的图层下面吧,
 * 现在才三棵, 要多10倍吧, 另外要加点珊瑚海星, 一些无名的小鱼):
 *   - The drawing order is now beams → soil band → pebbles → decor items
 *     → motes. The soil sits BEHIND the plants, so the buried plant root
 *     (still 3–5px under the dune surface, see pondPlantRootY) is now
 *     visible *through* the soil gap — the green stem visibly enters the
 *     ground. v43 had the floor painted over the buried base.
 *   - The pond decor census is BUILT (pondDecorCensus) rather than
 *     filtered: plants × 10 (seaweed/kelp ≈ 30 per screen, capped at
 *     240), coral reintroduced as a real reef ornament (capped at 36),
 *     starfish added as a new ground critter (capped at 24), anemone
 *     stays banned (the pink/red tentacles the user deleted in v43),
 *     and the OCEAN's rock/ice/tubeWorm counts pass through unchanged.
 *   - Anchoring splits by posture: vertical plants (seaweed/kelp/coral)
 *     use pondPlantRootY so the base lands inside the soil band; flat
 *     ground items (starfish/rock/ice/tubeWorm) use duneSurfaceY so
 *     they sit on top of the dune curve, not buried.
 *   - Plant scale stays per-SCREEN height (screenH param, v43 fix), so
 *     a multi-screen pond keeps the per-screen plant sizing instead of
 *     tripling per the v42 regression.
 *
 * v45 pond decor retune (user: 珊瑚 + 海星 无名小鱼 + 虾蟹鳝鱼, 还有土壤,
 * 都比较粗糙, 让minimax重新生成, 红色黄色水草又出现了, 海底还有一些白色
 * 三角形是啥? 删掉):
 *   - soil is now a tiled sprite (MiniMax-painted horizontal sand strip,
 *     loaded by loadDecorSprites). When the sprite is in cache the
 *     band is painted inside the same dune clip the v44 gradient used,
 *     with alternating tiles mirrored to hide the seam. No sprite →
 *     fall back to drawFloorBand's gradient (offline-safe).
 *   - coral and starfish in the pond census are SKIPPED unless their
 *     sprite is in cache — so the v44 procedural coral (the warm-orange
 *     4-arm line the user called 红黄水草) and the flat 5-point starfish
 *     never reach the pond. The OCEAN keeps using procedural coral
 *     because it has no painted sprite today (future v46 if requested).
 *   - ice was removed from the OCEAN's neutral-kinds pass-through list:
 *     the user deleted the white triangles in v45. rock + tubeWorm
 *     still pass through.
 *   - The pond draws the soil layer FIRST (over the v44 dune gradient
 *     tail), then pebbles, then decor items, then motes — the v44
 *     layer order is preserved. The v45 sprite band replaces the
 *     gradient only; the dune clip path itself is unchanged.
 */
import type { DecorKind, OceanProfile } from './oceans.ts'
import { drawDecorItem, drawFloorBand, duneSurfaceY, getSoilSprite, hasDecorSprite, seededDecor } from './decor.ts'

/** Soil-top fraction of the (world) height — 1 − 0.014: the v43 seam is
 * 1.4% of the height, i.e. 10% of the old 0.14h band (90% thinner). */
export const POND_FLOOR_FRAC = 0.986

/** Soil-top y for a pond world of height h (0 for degenerate h). */
export function pondFloorY(h: number): number {
  return h > 0 ? h * POND_FLOOR_FRAC : 0
}

/** Root y for a plant at world x: a few px UNDER the local dune surface
 * (3–5px, scaling with the seam thickness) so green seaweed/kelp/coral
 * read as planted INTO the soil rather than resting on it. v44 still
 * uses this even though the soil band is now drawn behind the plants —
 * the visible stem emerges from inside the soil gap. */
export function pondPlantRootY(x: number, floorY: number, soilH: number): number {
  const bury = Math.min(5, Math.max(3, soilH * 0.35))
  return duneSurfaceY(x, floorY) + bury
}

/** The pond's WATER SURFACE height at world x (v48, user: 顶端加个有
 * 波浪的水面，光线从水面投射下去). Two superposed sines drifting at
 * different speeds — a calm open-water chop, not a cartoon sawtooth.
 * Pure + deterministic in t: the crest oscillates around `amp` (≈0.8%
 * of the world height, min 3px) within [−0.15·amp, 2.15·amp] of the
 * world top; the beams' top edges and the surface strokes both sample
 * THIS function so the rays read as projecting from the waves. */
export function pondSurfaceY(x: number, t: number, w: number, h: number): number {
  const amp = Math.max(3, h * 0.008)
  const k = (Math.PI * 2) / Math.max(w / 5, 120)
  // Second harmonic at exactly 2× the wavelength so x and x+w sample the
  // same phase — the surface line joins seamlessly at the world edges
  // (a non-integer harmonic would jump half a wave at x=w).
  return amp
    + Math.sin(k * x + t * 0.9) * amp * 0.8
    + Math.sin(k * x * 2 - t * 0.6) * amp * 0.35
}

/** Per-screen, capped pond decor census (v44 abundance boost + coral/starfish
 * reintroduction). Counts are derived from `screens` so a 3×3 world gets
 * the same density per screen, not the same flat count. Pure — input is
 * never mutated; the function returns a fresh Partial record. The five
 * invariants below are what callers rely on:
 *   - anemone is ALWAYS absent (v43: pink/red tentacles the user deleted)
 *   - seaweed/kelp split 70/30 of `plants`, plants ∈ [min(30·s,240)]
 *   - coral capped at min(4·s,36); starfish capped at min(3·s,24)
 *   - rock/tubeWorm carry through the ocean profile verbatim
 *   - screens defaults to 1 (matches the legacy viewport-only world)
 *
 * v45: ice was dropped from the neutral-kinds list (user: 海底还有一些
 * 白色三角形是啥? 删掉). The ocean census can still contain ice — we
 * just don't carry it into the pond. Same shape as the anemone ban.
 */
export function pondDecorCensus(ocean: OceanProfile, screens = 1): Partial<Record<DecorKind, number>> {
  const s = Math.max(1, screens | 0)
  const plants = Math.min(30 * s, 240)
  const seaweed = Math.round(plants * 0.7)
  const kelp = plants - seaweed
  const coral = Math.min(4 * s, 36)
  const starfish = Math.min(3 * s, 24)
  const src = ocean.decor
  const out: Partial<Record<DecorKind, number>> = {
    seaweed,
    kelp,
    coral,
    starfish,
  }
  // Carry through the neutral kinds (rock/tubeWorm) verbatim. anemone is
  // intentionally never copied — the v43 ban is enforced by absence. ice
  // was dropped in v45 (white triangles deleted) — its ocean count, if
  // any, is no longer passed through.
  for (const k of ['rock', 'tubeWorm'] as const) {
    const n = src[k]
    if (typeof n === 'number') out[k] = n
  }
  return out
}

/** Kinds rooted INTO the soil band (vertical growth — stem extends up
 * from a buried base). Used by drawPondBackdrop to pick between
 * pondPlantRootY and duneSurfaceY per item. */
const PLANT_KINDS: ReadonlySet<DecorKind> = new Set(['seaweed', 'kelp', 'coral'])

/** v49 surface sprites (user: 让minimax生成岛屿和船只，丰富水面) —
 * MiniMax-painted silhouettes that bob ON the water line. Module cache
 * filled by loadSurfaceSprites (same pattern as decor.ts); missing
 * sprites simply don't draw (offline-safe). */
export type SurfaceSpriteKind = 'island' | 'boat'

const SURFACE_BASE = 'https://deepsea.openclawd.qzz.io/assets/surface/'
const surfaceSpriteCache = new Map<SurfaceSpriteKind, HTMLImageElement>()
const surfaceAttempted = new Set<SurfaceSpriteKind>()

export async function loadSurfaceSprites(): Promise<void> {
  const kinds: SurfaceSpriteKind[] = ['island', 'boat']
  await Promise.allSettled(kinds.map((kind) => new Promise<void>((resolve) => {
    if (surfaceAttempted.has(kind)) { resolve(); return }
    surfaceAttempted.add(kind)
    const img = new Image()
    img.onload = () => { surfaceSpriteCache.set(kind, img); resolve() }
    img.onerror = () => { resolve() }
    // v=1 — bump on surface asset changes (worker serves immutable).
    img.src = SURFACE_BASE + kind + '.png?v=2'
  })))
}

function getSurfaceSprite(kind: SurfaceSpriteKind): HTMLImageElement | null {
  const img = surfaceSpriteCache.get(kind)
  if (img === undefined || !img.complete || img.naturalWidth === 0) return null
  return img
}

/** Draw the pond backdrop. `span` (v49) widens the surface/floor draw
 * range beyond the world edges to the VISIBLE span — zoomed-out views
 * (and the no-world single screen) then see waves and soil continue to
 * the screen edges instead of bare void margins. Defaults to the world
 * width. Beams/waves are periodic in w, so extending is seamless. */
export function drawPondBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, t: number,
  ocean?: OceanProfile | null, screens = 1, screenH = h,
  span?: { x0: number, x1: number }): void {
  const sx0 = span !== undefined ? Math.min(span.x0, 0) : 0
  const sx1 = span !== undefined ? Math.max(span.x1, w) : w
  // -- god rays: slanted beams whose alpha breathes slowly --
  // Light shafts stay anchored to the WORLD TOP (y=0) so the diver can
  // see them only while the camera is parked near the top of the world;
  // panning down rows leaves them in the off-screen rows above. Count
  // scales with sqrt(screens) — wider worlds spread the beams wider so
  // the top of the whole pond reads as the same lit surface.
  // v48: each beam's TOP EDGE follows the water surface (pondSurfaceY)
  // instead of the flat world top, so the rays visibly PROJECT from
  // the wavy surface rather than from an invisible line.
  const surf = (x: number): number => pondSurfaceY(x, t, w, h)
  const beamCount = Math.min(Math.max(4, Math.round(4 * Math.sqrt(Math.max(screens, 1)))), 12)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  // v49: beams repeat per WORLD PERIOD across the span — the ray grid is
  // periodic in w (like the surface), so beyond-world margins (zoom-out)
  // get their own rays instead of darkness.
  for (let p = Math.floor(sx0 / w); p <= Math.ceil(sx1 / w) - 1; p += 1) {
    const base = p * w
    for (let i = 0; i < beamCount; i++) {
      const bx = base + w * (0.16 + (i / beamCount) * 0.68) + Math.sin(t * 0.22 + i * 1.9) * 18
      if (bx + 58 < sx0 || bx - 10 > sx1) continue
      const a = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(t * 0.45 + i * 2.4))
      const rg = ctx.createLinearGradient(0, 0, 0, h * 0.72)
      rg.addColorStop(0, 'rgba(150,225,255,' + a.toFixed(3) + ')')
      rg.addColorStop(1, 'rgba(150,225,255,0)')
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.moveTo(bx - 10, surf(bx - 10)); ctx.lineTo(bx + 16, surf(bx + 16))
      ctx.lineTo(bx + 58, h * 0.72); ctx.lineTo(bx + 8, h * 0.72)
      ctx.closePath(); ctx.fill()
    }
  }

  // -- v48 water surface: the world's top edge becomes a LIVING water
  // line (user: 光线顶端和屏幕顶端之间有空隙，应该加个水面，有波浪的).
  // A soft under-crest glow band plus two phase-shifted wave strokes,
  // all in WORLD coordinates so the surface scrolls and zooms (v47) with
  // the pond — a zoomed-out or panned-down camera sees the water begin
  // exactly where the rays begin, never a bare ray-top gap. Drawn AFTER
  // the beams so the ray tops tuck under the crest line.
  const amp = Math.max(3, h * 0.008)
  const surfPath = (phase: number, ampMul: number): void => {
    ctx.beginPath()
    let first = true
    for (let x = sx0; x <= sx1; x += 16) {
      const y = pondSurfaceY(x, t + phase, w, h) * ampMul
      if (first) { ctx.moveTo(x, y); first = false }
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  // v49: the under-crest glow fills BELOW the wave crest only (band from
  // the crest down amp*7, fading out). v48 filled from the flat world top
  // y=0 down to the crest — a hard horizontal edge at y=0 read as TWO
  // sky colors above the waves (user: 天空有两个颜色). Below-crest-only
  // leaves exactly one color above the surface line.
  const sg = ctx.createLinearGradient(0, amp, 0, amp * 8)
  sg.addColorStop(0, 'rgba(190,235,255,0.18)')
  sg.addColorStop(1, 'rgba(190,235,255,0)')
  ctx.fillStyle = sg
  ctx.beginPath()
  ctx.moveTo(sx0, surf(sx0))
  for (let x = sx0; x <= sx1; x += 16) ctx.lineTo(x, surf(x))
  for (let x = sx1; x >= sx0; x -= 16) ctx.lineTo(x, surf(x) + amp * 7)
  ctx.closePath(); ctx.fill()
  // Primary crest line + a fainter, phase-shifted trailing wave.
  ctx.strokeStyle = 'rgba(215,240,255,0.6)'
  ctx.lineWidth = 1.5
  surfPath(0, 1)
  ctx.strokeStyle = 'rgba(160,205,240,0.32)'
  ctx.lineWidth = 1
  surfPath(0.7, 1.35)
  // v49 islands & boats: rim-lit silhouettes bobbing ON the crest line,
  // deterministic positions hashed from the index (stable across frames).
  // One island + one boat per ~1.6 world periods across the span.
  // Baseline fraction per asset: where the painted horizontal base sits
  // inside the image. The v2 assets are alpha-cropped to their content
  // bbox, so the base is at the very bottom of each image (~0.97/0.99 —
  // measured, not assumed, the faint rim rows above the true base keep
  // it a hair under 1.0).
  const BASELINE: Record<SurfaceSpriteKind, number> = { island: 0.97, boat: 0.99 }
  const props: Array<{ kind: SurfaceSpriteKind, x: number, scale: number, bob: number }> = []
  for (let p = Math.floor(sx0 / w); p <= Math.ceil(sx1 / w); p += 1) {
    const base = p * w
    props.push({ kind: 'island', x: base + w * 0.30, scale: 0.9 + ((p & 3) % 3) * 0.15,
      bob: Math.sin(t * 0.5 + p * 2.1) * 1.2 })
    props.push({ kind: 'boat', x: base + w * 0.68, scale: 0.8 + ((p & 1) * 0.2),
      bob: Math.sin(t * 0.9 + p * 3.7) * 2.2 })
  }
  ctx.restore()

  // v49.1: the props draw in a SEPARATE source-over pass — the assets are
  // now alpha-unmultiplied (transparent) PNGs, so the dark silhouettes
  // actually show against the bright surface water. Inside the 'lighter'
  // block above they were invisible: a black hull adds nothing and the
  // cyan rim washed out on the light surface gradient.
  for (const prop of props) {
    const img = getSurfaceSprite(prop.kind)
    if (img === null) continue
    const ph = h * 0.16 * prop.scale
    const pw = ph * (img.naturalWidth / img.naturalHeight)
    if (prop.x + pw / 2 < sx0 || prop.x - pw / 2 > sx1) continue
    // The painted baseline (BASELINE·ph from the image top) rides the
    // wave crest at the prop's x; the art's lower margin sinks beneath
    // the surface where it belongs.
    const y = surf(prop.x) - BASELINE[prop.kind] * ph + prop.bob
    ctx.save()
    ctx.globalAlpha = 0.92
    ctx.drawImage(img, prop.x - pw / 2, y, pw, ph)
    ctx.restore()
  }

  const floorY = pondFloorY(h)
  const soilH = Math.max(1, h - floorY)

  // -- sandy floor: the v43 thin seam along the world bottom. Drawn
  // BEFORE the decor items (v44: 土壤图层改在海草的图层下面吧) so the
  // green plants layer on top of the soil and the buried plant base is
  // visible through the dune gap. v43 had the opposite order.
  //
  // v45 first paints a tiled soil sprite (MiniMax-painted horizontal
  // sand strip) clipped to the SAME dune curve drawFloorBand uses
  // (duneSurfaceY), then lays drawFloorBand's gradient ON TOP — so the
  // gradient still tints the band's top edge and the sprite shows
  // through as the texture. Without a sprite (offline / pre-load /
  // load failure) the gradient paints alone; same look as v44. --
  const soil = getSoilSprite()
  if (soil !== null) {
    ctx.save()
    // Same dune clip path as drawFloorBand: the seam is the area below
    // the duneSurfaceY(x, floorY) curve, between the curve and the
    // world bottom. We rebuild the path here because drawFloorBand
    // only Fills the gradient, it doesn't expose the path.
    ctx.beginPath()
    ctx.moveTo(sx0, h)
    for (let x = sx0; x <= sx1; x += 24) ctx.lineTo(x, duneSurfaceY(x, floorY))
    ctx.lineTo(sx1, h)
    ctx.closePath()
    ctx.clip()
    // Tile the soil sprite across the band. Each tile is soilH+8 tall
    // (a little taller than the band so we never see a dark gap at the
    // very bottom) and the source's natural width. Odd-indexed tiles
    // are mirrored to hide the seam; even tiles use the original so
    // the texture doesn't all face the same way. The starting X
    // offsets by one full tile so the first visible tile is already
    // the mirrored variant — keeps the visible left edge from being a
    // straight seam line.
    const tileW = soil.w
    const tileH = soilH + 8
    // v49: tiles run across the span so zoomed-out corners keep soil.
    const startX = sx0 - (((Math.floor((0 - sx0) / tileW) % 2) + 2) % 2) * tileW
    for (let x = startX, i = 0; x < sx1 + tileW; x += tileW, i += 1) {
      ctx.save()
      ctx.translate(x + tileW / 2, h - tileH / 2)
      if (i % 2 === 1) ctx.scale(-1, 1)
      ctx.drawImage(soil.img, -tileW / 2, -tileH / 2, tileW, tileH)
      ctx.restore()
    }
    ctx.restore()
  }
  // The v44 dune gradient always paints on top of the sprite — gives
  // the band a soft top fade and an ocean-tint nudge. The sprite is the
  // texture; the gradient is the lighting.
  drawFloorBand(ctx, sx1, floorY, h, ocean?.tint ?? { r: 0, g: 0, b: 0 }, sx0)

  // pebbles inside the seam — fixed positions derived from index hashes,
  // y kept within the thin band (the old floorY+8..h-4 spread would push
  // pebbles above the seam now that it is 90% thinner), radius capped by
  // the seam thickness so grains sit in the sand instead of towering.
  const pebbleCount = Math.min(Math.max(9, Math.ceil(9 * Math.sqrt(Math.max(screens, 1)))), 36)
  const prCap = Math.max(1, Math.round(soilH / 3))
  for (let i = 0; i < pebbleCount; i++) {
    const hx = ((i * 2654435761) >>> 0) % 1000 / 1000
    const hy = ((i * 40503) >>> 0) % 100 / 100
    const px = hx * w
    const py = Math.min(floorY + 1 + hy * Math.max(soilH - 3, 1), h - 2)
    const pr = Math.min(2 + ((i * 7) % 3), prCap)
    ctx.fillStyle = i % 3 === 0 ? 'rgba(210,190,160,0.35)' : 'rgba(170,150,120,0.30)'
    ctx.beginPath(); ctx.ellipse(px, py, pr * 1.6, pr, 0, 0, Math.PI * 2); ctx.fill()
  }

  // -- decor items (plants + ground critters), layered OVER the soil.
  // Anchoring is posture-specific: vertical plants (seaweed/kelp/coral)
  // root INTO the soil band via pondPlantRootY, so the visible stem
  // emerges from inside the dune gap; flat items (starfish/rock/ice/
  // tubeWorm) sit ON the dune surface via duneSurfaceY, never buried.
  // The census itself comes from pondDecorCensus, which already caps
  // counts per screen — no separate `cap` is needed. --
  if (ocean != null) {
    const items = seededDecor({ ...ocean, decor: pondDecorCensus(ocean, screens) })
    // Per-SCREEN scale: the v42 world-aware call used to pass the WORLD
    // height here, tripling plant size in a 3×3 pond (against the v39
    // "海草太长太多" shrink). screenH restores the per-screen sizing.
    const scale = Math.max(screenH * 0.11, 30)
    for (const item of items) {
      // v45 pond guard: skip coral / starfish unless their painted
      // sprite is in the cache. The v44 procedural coral was a
      // 4-arm line in hsl(18–43) — the "红黄水草" the user wanted
      // gone — and the v44 starfish was a flat 5-point fill. With
      // this guard the pond shows nothing for those kinds until the
      // MiniMax sprite loads, then swaps in the real shape. The
      // OCEAN renderer goes through drawDecorItem's own sprite
      // short-circuit so its procedural coral still works (today
      // the ocean census doesn't include starfish either way).
      if ((item.kind === 'coral' || item.kind === 'starfish') && !hasDecorSprite(item.kind)) continue
      const px = item.xFrac * w
      const yRoot = PLANT_KINDS.has(item.kind)
        ? pondPlantRootY(px, floorY, soilH)
        : duneSurfaceY(px, floorY)
      drawDecorItem(ctx, item, px, yRoot, t, scale)
    }
  }

  // -- drifting motes: tiny specks hanging in the water column --
  const moteCount = Math.min(Math.max(14, 14 * Math.max(screens, 1)), 80)
  ctx.fillStyle = 'rgba(200,230,255,0.18)'
  for (let i = 0; i < moteCount; i++) {
    const mx = (((i * 48271) >>> 0) % 1000 / 1000) * w
    const my = (((i * 1103515245) >>> 0) % 1000 / 1000) * h * 0.8
    const drift = Math.sin(t * 0.35 + i * 2.1) * 7
    ctx.beginPath(); ctx.arc(mx + drift, my, 1, 0, Math.PI * 2); ctx.fill()
  }
}
