/**
 * Pond ambient world (split from engine.ts): the deterministic ambient
 * fauna generator (hash-seeded, no Math.random), the shared pond
 * per-tick integrator, and the stockPond state loader. Pure functions
 * except stockPondInto, which writes the engine's public pond fields.
 */
import { pondFloorY } from './pond-bg.ts'
import type { Creature } from './engine.ts'
import type { OceanEngine } from './engine.ts'

/** Tiny deterministic FNV-1a-ish hash for one (i, salt) pair. Used
 * by buildAmbient to seed every property of every ambient creature
 * from its index — no Math.random, no stored state, fully reproducible.
 * Returns an unsigned 32-bit integer. */
export function ambientHash(i: number, salt: number): number {
  let h = 0x811c9dc5 >>> 0
  h = Math.imul(h ^ (i & 0xff), 0x01000193) >>> 0
  h = Math.imul(h ^ ((i >>> 8) & 0xff), 0x01000193) >>> 0
  h = Math.imul(h ^ ((i >>> 16) & 0xff), 0x01000193) >>> 0
  h = Math.imul(h ^ ((i >>> 24) & 0xff), 0x01000193) >>> 0
  h = Math.imul(h ^ (salt & 0xff), 0x01000193) >>> 0
  h = Math.imul(h ^ ((salt >>> 8) & 0xff), 0x01000193) >>> 0
  return h >>> 0
}

/** Extract a fractional [0,1) value at a different bit offset of the
 * hash, so each ambient property gets an independent dimension. Uses
 * 10-bit windows (1024 buckets) which is plenty for sizing/hue/vx. */
export function ambientFrac(i: number, salt: number, shift: number): number {
  // GLM-review v44 fix: parens around the mask. Without them `/` binds
  // tighter than `&` and the expression collapses to `(hash >>> shift)
  // & 1`, returning integer 0/1 only — every ambient creature then
  // collapses to x=0, size=min, hue/vx/phase=min, all stacked on the
  // left edge. The existing tests only count / clamp / wrap, so the
  // regression went unnoticed until the distribution assertion (item
  // #3 in the GLM review) was added.
  return ((ambientHash(i, salt) >>> shift) & 0x3ff) / 0x3ff
}

/** Build the ambient population for the current pond world. Per-cycle
 * recipe [fish×4, shrimp×2, crab×1, eel×1] — total count = min(8×s, 80).
 * Lane posture is kind-specific:
 *   - fish: full band (no lane fields → default 0.08–0.92 of wh)
 *   - shrimp: hovers just above the floor (not on the soil)
 *   - crab: nailed to the thin soil seam (lane [floorTop−5, floorTop+1])
 *   - eel: skims the floor a bit higher than the shrimp
 * Sizes/hues/vx match the v44 user spec. floorTop = pondFloorY(wh).
 *
 * v45 sprite wiring: fish and eel want a painted sprite (minnow /
 * swamp_eel) that's NOT the same as the kind sprite. We set
 * spriteKey so drawFaunaSprite tries the per-kind painted sprite
 * first, then falls back to the kind sprite (the existing v40
 * chain). shrimp and crab's kind IS the painted-sprite key, so
 * they get the same behavior without an explicit spriteKey. The
 * missing-sprite fallback chain (sprite → kind → procedural) is
 * unchanged from v40; a key without a sprite just means the
 * creature draws procedurally, which is the v44 status quo.
 *
 * `vw` / `vh` are the VIEWPORT size (the engine's w/h) — the ambient
 * count scales with how many screens the world covers. */
export function buildAmbient(ww: number, wh: number, vw: number, vh: number): Creature[] {
  const screens = Math.max(1, Math.ceil((ww * wh) / Math.max(1, vw * vh)))
  const total = Math.min(8 * screens, 80)
  const floorTop = pondFloorY(wh)
  const out: Creature[] = []
  for (let i = 0; i < total; i += 1) {
    const recipe = i % 8
    let kind: Creature['kind']
    let spriteKey: string | undefined
    let sizeMin = 0; let sizeMax = 0
    let hueCenter = 0; let hueWidth = 0
    let vxMin = 0; let vxMax = 0
    let laneLo: number | undefined
    let laneHi: number | undefined
    if (recipe <= 3) {
      // fish ×4 per cycle: silver-blue background school, full band.
      // spriteKey 'minnow' → painted minnow sprite, falls back to the
      // v40 'fish' sprite, falls back to procedural.
      kind = 'fish'
      spriteKey = 'minnow'
      sizeMin = 6; sizeMax = 11
      hueCenter = 185; hueWidth = 40   // hue 185..225
      vxMin = 0.2; vxMax = 0.7
    } else if (recipe <= 5) {
      // shrimp ×2 per cycle: hover just above the floor. Hue starts at
      // 345 so the (hueCenter + fh*25) % 360 range is 345..360 ∪ 0..10
      // — the pink/coral shrimp palette the user asked for. v44 review
      // caught that hueCenter=0 collapsed the recipe to plain orange.
      // The kind IS the sprite key; no explicit spriteKey needed.
      kind = 'shrimp'
      sizeMin = 5; sizeMax = 8
      hueCenter = 345; hueWidth = 25   // (345 + fh*25) % 360 → 345..370 wrap → pink shrimp
      vxMin = 0.15; vxMax = 0.5
      laneLo = floorTop - 0.06 * wh
      laneHi = floorTop - 0.015 * wh
    } else if (recipe === 6) {
      // crab ×1 per cycle: nailed to the soil seam (floorTop ± a few px).
      // The kind IS the sprite key.
      kind = 'crab'
      sizeMin = 9; sizeMax = 13
      hueCenter = 10; hueWidth = 10    // orange-red, hue 10..20
      vxMin = 0.04; vxMax = 0.12       // slow sideways shuffle
      laneLo = floorTop - 5
      laneHi = floorTop + 1
    } else {
      // eel ×1 per cycle: the v44 'eel' kind was a deep-sea eel with
      // blue glow. v45 swaps to a yellow-green swamp eel (the user's
      // 鳝鱼) via spriteKey 'swamp_eel'. drawFaunaSprite tries the
      // painted swamp_eel sprite first, then the existing 'eel'
      // sprite, then the procedural silhouette.
      kind = 'eel'
      spriteKey = 'swamp_eel'
      sizeMin = 10; sizeMax = 15
      hueCenter = 75; hueWidth = 30    // yellow-green-brown eel hues
      vxMin = 0.1; vxMax = 0.3
      laneLo = floorTop - 0.10 * wh
      laneHi = floorTop - 0.03 * wh
    }
    const fx = ambientFrac(i, 0xa1, 0)
    const fy = ambientFrac(i, 0xa2, 10)
    const fs = ambientFrac(i, 0xa3, 4)
    const fh = ambientFrac(i, 0xa4, 14)
    const fv = ambientFrac(i, 0xa5, 6)
    const fp = ambientFrac(i, 0xa6, 18)
    const x = fx * ww
    // Initial y is sampled inside the lane band when defined, otherwise
    // the default band — stepPondCreature then clamps it on every tick.
    const y = laneLo !== undefined && laneHi !== undefined
      ? laneLo + fy * Math.max(laneHi - laneLo, 1)
      : wh * (0.08 + fy * 0.84)
    const size = sizeMin + fs * (sizeMax - sizeMin)
    // Shrimp hues wrap the warm-red range (345..370 → mod 360).
    const hueBase = (hueCenter + fh * hueWidth) % 360
    const vx = (vxMin + fv * (vxMax - vxMin)) * (fx < 0.5 ? -1 : 1)
    const phase = fp * Math.PI * 2
    out.push({ zone: 0, kind, x, y, vx, size, hue: hueBase, phase,
      ...(spriteKey !== undefined ? { spriteKey } : {}),
      ...(laneLo !== undefined ? { laneLo } : {}),
      ...(laneHi !== undefined ? { laneHi } : {}) })
  }
  return out
}

/** Shared per-tick physics for one pond creature (the diver's catch) or
 * one ambient creature (the v44 background fauna). Both lists use the
 * SAME integrator so a re-stock that mixes them into the same visible
 * band behaves identically. The y-clamp reads c.laneLo / c.laneHi when
 * defined, otherwise the caller's default full-band clamp — so shrimp
 * stay close to the floor, crabs nail the soil seam, and fish wander
 * the whole pond. x wraps on the world (multi-screen ponds) or the
 * viewport (legacy 14-fish pond). */
export function stepPondCreature(c: Creature, dt: number, worldW: number, yLo: number, yHi: number): void {
  c.phase += dt * (1 + Math.abs(c.vx) * 2)
  if (Math.random() < 0.004) c.vx = (Math.random() * 0.4 + 0.18) * (Math.random() < 0.5 ? -1 : 1)
  c.x += c.vx * dt * 46
  const lo = c.laneLo !== undefined ? c.laneLo : yLo
  const hi = c.laneHi !== undefined ? c.laneHi : yHi
  const ny = c.y + Math.sin(c.phase) * dt * 9
  c.y = Math.min(Math.max(ny, lo), hi)
  if (c.x < -50) c.x = worldW + 40
  if (c.x > worldW + 50) c.x = -40
}

/** Pond zoom range (v47): 0.5× … 2.5× — the diver can lean into the
 * school to inspect one fish or pull back to see the whole world. */
export const POND_ZOOM_MIN = 0.5
export const POND_ZOOM_MAX = 2.5

/** The camera-space pan range that keeps the VISIBLE world span inside
 * the pond world under the v47 center-anchored zoom. The draw transform
 * maps world→screen as (world − cam − c)·z + c, so the visible span is
 * [cam + c(1−1/z), cam + c(1+1/z)] — NOT [cam, cam + w/z] as v47 first
 * assumed. Consequences this encodes:
 *   - zoomed IN (z>1) the camera may go NEGATIVE so the world's top-left
 *     stays reachable (v49 fix: 放大后不能移到最顶部 — the old
 *     [0, ww − w/z] clamp made cam=0 still show a void margin);
 *   - zoomed OUT (z<1) the camera is pushed inward so no void shows at
 *     the world's far edge (bottom-right corner included);
 *   - a world narrower than the visible span (heavy zoom-out) has no
 *     valid range — min>max — and the caller centers the camera instead.
 * A no-world pond (pondWW=0) pans within the viewport-sized world, so
 * even single-screen ponds can drag the surface into view when zoomed.
 * Exported for pond.tsx's resize-preserving restock. */
export function pondCamBounds(eng: OceanEngine): {
  minX: number, maxX: number, minY: number, maxY: number,
} {
  const ww = eng.pondWW > 0 ? eng.pondWW : eng.w
  const wh = eng.pondWH > 0 ? eng.pondWH : eng.h
  const cx = eng.w / 2
  const cy = eng.h / 2
  const z = eng.pondZoom
  return {
    minX: cx * (1 / z - 1),
    maxX: ww - cx * (1 + 1 / z),
    minY: cy * (1 / z - 1),
    maxY: wh - cy * (1 + 1 / z),
  }
}

const clamp1 = (v: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi)

/** Clamp the pond camera so the VISIBLE span stays inside the pond
 * world (see pondCamBounds for the zoom-aware math). Ocean mode never
 * calls this. */
export function clampPondCamera(eng: OceanEngine): void {
  if (!eng.pondMode) return
  const { minX, maxX, minY, maxY } = pondCamBounds(eng)
  eng.camX = clamp1(eng.camX, minX, maxX)
  eng.camY = clamp1(eng.camY, minY, maxY)
}

/** Absolute zoom setter (clamped); re-clamps the camera so the visible
 * window never leaves the world. Body of engine.setPondZoom. */
export function setPondZoomInto(eng: OceanEngine, z: number): void {
  eng.pondZoom = Math.min(Math.max(z, POND_ZOOM_MIN), POND_ZOOM_MAX)
  clampPondCamera(eng)
}

/** Pointer-anchored zoom (wheel/buttons): scale by `factor` while keeping
 * the world point currently under viewport coords (vx, vy) under that
 * same anchor. The anchor math mirrors the draw transform in
 * engine-draw.ts: screen = (world − cam − center)·z + center, inverted
 * to world = cam + center + (screen − center)/z. Body of
 * engine.zoomPond. */
export function zoomPondInto(eng: OceanEngine, vx: number, vy: number, factor: number): void {
  const prev = eng.pondZoom
  const next = Math.min(Math.max(prev * factor, POND_ZOOM_MIN), POND_ZOOM_MAX)
  if (next === prev) return
  const wx = eng.camX + eng.w / 2 + (vx - eng.w / 2) / prev
  const wy = eng.camY + eng.h / 2 + (vy - eng.h / 2) / prev
  eng.pondZoom = next
  eng.camX = wx - eng.w / 2 - (vx - eng.w / 2) / next
  eng.camY = wy - eng.h / 2 - (vy - eng.h / 2) / next
  clampPondCamera(eng)
}

/** stockPond state loader: flips the engine into pond mode, adopts the
 * prebuilt creatures, sizes the (optional) multi-screen world, resets
 * both cameras, seeds viewport-scaled bubbles, and builds the ambient
 * population. Mirrors the stockPond() body verbatim. */
export function stockPondInto(
  eng: OceanEngine,
  creatures: ReadonlyArray<Creature>,
  worldW?: number,
  worldH?: number,
): void {
  eng.pondMode = true
  eng.creatures = [...creatures]
  // 0 sentinel = "no pond world, fall back to the viewport". Storing 0
  // keeps the legacy invariant (panPond is a no-op, no-world stockPond
  // does not change wrap bounds) AND lets the React layer ask "did the
  // diver opt into a world?" via a simple pondWW > 0 check.
  eng.pondWW = (worldW !== undefined && worldW > 0) ? worldW : 0
  eng.pondWH = (worldH !== undefined && worldH > 0) ? worldH : 0
  // Reset both cameras; the React layer pans after mounting.
  eng.camX = 0
  eng.camY = 0
  // Bubble count scales with the pond area so a 3×3 world feels alive
  // instead of looking bare next to the bigger school. Cap keeps big
  // walls from going bubble-spam. When no world is set the area is the
  // viewport, matching the legacy 10-bubble count.
  const ww = eng.pondWW > 0 ? eng.pondWW : eng.w
  const wh = eng.pondWH > 0 ? eng.pondWH : eng.h
  const area = Math.max(1, ww * wh)
  const baseArea = Math.max(1, eng.w * eng.h)
  const ratio = Math.max(1, Math.ceil(area / baseArea))
  const bubbleCount = Math.min(10 * ratio, 40)
  eng.bubbles = Array.from({ length: bubbleCount }, () => ({
    x: Math.random() * ww, y: Math.random() * wh,
    r: 1 + Math.random() * 2, w: Math.random() * 6, s: 0.5 + Math.random(),
  }))
  // v44 ambient fauna: tiny unnamed fish / shrimp / crab / eel that
  // populate the world beyond the diver's own catch. Count scales with
  // `screens = ceil(area / viewportArea)` so a 3×3 world feels three
  // times livelier, capped at 80 so huge walls never drown the school
  // (the diver's catch stays the foreground). Every property (x, size,
  // hue, vx, phase, laneFrac) is hashed from the index — no Math.random
  // — so the ambient layout is reproducible across re-stocks. The
  // per-cycle kind recipe [fish×4, shrimp×2, crab×1, eel×1] repeats so
  // every cycle of 8 has the same density, regardless of the total.
  eng.ambient = buildAmbient(ww, wh, eng.w, eng.h)
}
