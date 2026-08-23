// @vitest-environment node
/**
 * v47 pond zoom: the visible span shrinks as pondZoom grows, so every
 * camera-sensitive surface (pan clamp, wander bounds, screen↔world
 * conversion, resize clamp, pointer-anchored zoom) must divide by the
 * zoom. This suite locks those invariants; rendering is covered by the
 * draw-smoke in pond-world.spec (zoom only changes the transform).
 */
import { describe, expect, it } from 'vitest'
import { OceanEngine, type Creature } from '../src/client/engine.ts'
import { POND_ZOOM_MIN, POND_ZOOM_MAX } from '../src/client/engine-ambient.ts'

const fish = (x: number, y: number): Creature =>
  ({ zone: 0, kind: 'fish', x, y, vx: 1, size: 20, hue: 28, phase: 0 })

const pond = (w = 400, h = 300, ww = 1600, wh = 1200): OceanEngine => {
  const e = new OceanEngine()
  e.resize(w, h, 1)
  e.stockPond([fish(100, 100)], ww, wh)
  return e
}

describe('OceanEngine pond zoom (v47)', () => {
  it('defaults to 1× and clamps into [0.5, 2.5]', () => {
    const e = pond()
    expect(e.pondZoom).toBe(1)
    e.setPondZoom(9)
    expect(e.pondZoom).toBe(POND_ZOOM_MAX)
    expect(POND_ZOOM_MAX).toBe(2.5)
    e.setPondZoom(0.01)
    expect(e.pondZoom).toBe(POND_ZOOM_MIN)
    expect(POND_ZOOM_MIN).toBe(0.5)
    e.setPondZoom(1.6)
    expect(e.pondZoom).toBe(1.6)
  })

  it('pan clamp follows the center-anchored visible bounds (v49 fix)', () => {
    const e = pond(400, 300, 1600, 1200)
    // At 1×: bounds [0, 1600−400] = [0, 1200].
    e.panPond(99999, 0)
    expect(e.camX).toBe(1200)
    // Zoom 2×: visible left = cam+200(1−0.5), right = cam+200·1.5 →
    // cam ∈ [−100, 1300].
    e.setPondZoom(1)
    e.camX = 0
    e.setPondZoom(2)
    e.panPond(99999, 0)
    expect(e.camX).toBe(1300)
    // Zoomed IN the camera goes NEGATIVE to keep the world's left edge
    // at the screen's left edge (the v47 [0,…] clamp couldn't — that
    // was the 放大后不能移到最顶部 bug).
    e.panPond(-99999, 0)
    expect(e.camX).toBe(-100)
    // Zoom 0.5×: cam ≥ 200·(2−1) = 200 so no void shows past world-left.
    e.setPondZoom(0.5)
    expect(e.camX).toBeGreaterThanOrEqual(200 - 1e-9)
  })

  it('v49 regression: at max zoom the world TOP-LEFT is reachable (放大后能移到最顶部)', () => {
    const e = pond(400, 300, 1600, 1200)
    e.setPondZoom(2.5)
    e.panPond(-99999, -99999)
    // Screen (0,0) must map to exactly the world origin — no void band.
    expect(e.screenToWorld(0, 0).x).toBeCloseTo(0, 6)
    expect(e.screenToWorld(0, 0).y).toBeCloseTo(0, 6)
  })

  it('pan deltas are screen px: divided by zoom so content tracks the pointer 1:1', () => {
    const e = pond()
    e.setPondZoom(2)
    e.panPond(100, 0)
    expect(e.camX).toBe(50)
    // Zoom out (park mid-range first — the z<1 clamp pushes cam ≥ 200
    // so the world's left edge stays covered) and pan the same 100px.
    e.setPondZoom(0.5)
    e.panPond(99999, 0) // far right first…
    e.panPond(-1400, 0) // …then back to the middle (clamp-safe spot)
    const mid = e.camX
    e.panPond(100, 0)
    expect(e.camX).toBe(mid + 100 / 0.5)
  })

  it('screenToWorld inverts the center-anchored transform at any zoom', () => {
    const e = pond(400, 300, 1600, 1200)
    e.setPondZoom(2)
    // world = cam + center + (screen − center)/z; center = (200, 150).
    const w0 = e.screenToWorld(0, 0)
    expect(w0.x).toBeCloseTo(0 + 200 + (0 - 200) / 2, 5)
    expect(w0.y).toBeCloseTo(0 + 150 + (0 - 150) / 2, 5)
    const wc = e.screenToWorld(200, 150)
    expect(wc.x).toBe(200)
    expect(wc.y).toBe(150)
    // Round-trip vs the draw transform: with cam=0, z=2, center=(200,150),
    // screen = (world − cam − center)·z + center, so world (400, 275) is
    // on screen at (600, 400) — screenToWorld must invert exactly that.
    const rt = e.screenToWorld(600, 400)
    expect(rt.x).toBeCloseTo(400, 5)
    expect(rt.y).toBeCloseTo(275, 5)
  })

  it('screenToWorld at 1× keeps the legacy cam+screen identity (zoom off = old behavior)', () => {
    const e = pond()
    e.panPond(100, 50)
    expect(e.screenToWorld(0, 0)).toEqual({ x: 100, y: 50 })
    expect(e.screenToWorld(200, 300)).toEqual({ x: 300, y: 350 })
  })

  it('pointer-anchored zoom keeps the world point under the anchor (clamp-safe anchor)', () => {
    const e = pond(400, 300, 1600, 1200)
    // Zoom 2× anchored at the viewport center: the world point under the
    // center stays put, so the camera must not move.
    const before = e.screenToWorld(200, 150)
    e.zoomPond(200, 150, 2)
    expect(e.pondZoom).toBe(2)
    const after = e.screenToWorld(200, 150)
    expect(after.x).toBeCloseTo(before.x, 5)
    expect(after.y).toBeCloseTo(before.y, 5)
    // Same invariant at a NON-center, clamp-safe anchor: park the camera
    // mid-world first (cam=0 would over-pan on any left/top anchor), then
    // the world point under (100, 80) stays under (100, 80) after 1.25×.
    e.panPond(600, 400)
    const anchorBefore = e.screenToWorld(100, 80)
    e.zoomPond(100, 80, 1.25)
    const anchorAfter = e.screenToWorld(100, 80)
    expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 5)
    expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 5)
    // A corner anchor at 0,0 wants the camera to go NEGATIVE (showing
    // void left of the world); the clamp pins it at 0 instead — the
    // anchor breaks by design, the world edge never does.
    e.camX = 0; e.camY = 0
    e.zoomPond(0, 0, 1.25)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  it('anchor zoom clamps the camera to the zoom-aware world bounds', () => {
    const e = pond(400, 300, 1600, 1200)
    // Anchor at the BOTTOM-RIGHT corner and zoom hard: the anchor math
    // pushes cam up-right; the clamp keeps the visible span inside the
    // world: cam ≤ ww − c(1+1/z) and cam ≥ c(1/z−1).
    e.zoomPond(400, 300, 2.5)
    e.zoomPond(400, 300, 2.5)
    e.zoomPond(400, 300, 2.5)
    expect(e.pondZoom).toBe(POND_ZOOM_MAX)
    expect(e.camX).toBeLessThanOrEqual(1600 - 200 * (1 + 1 / e.pondZoom) + 1e-9)
    expect(e.camY).toBeLessThanOrEqual(1200 - 150 * (1 + 1 / e.pondZoom) + 1e-9)
    expect(e.camX).toBeGreaterThanOrEqual(200 * (1 / e.pondZoom - 1) - 1e-9)
    expect(e.camY).toBeGreaterThanOrEqual(150 * (1 / e.pondZoom - 1) - 1e-9)
  })

  it('wander waypoints stay inside the zoom-aware bounds', () => {
    const e = pond(400, 300, 800, 600)
    e.setPondZoom(2)
    e.setPondWander(true)
    // At 2×: cam ∈ [−100, 500] × [−75, 375]. Drive many waypoint picks;
    // every camera position must stay inside bounds.
    for (let i = 0; i < 600; i++) e.step(1 / 60)
    expect(e.camX).toBeLessThanOrEqual(800 - 200 * (1 + 1 / e.pondZoom) + 1e-9)
    expect(e.camY).toBeLessThanOrEqual(600 - 150 * (1 + 1 / e.pondZoom) + 1e-9)
    expect(e.camX).toBeGreaterThanOrEqual(200 * (1 / e.pondZoom - 1) - 1e-9)
    expect(e.camY).toBeGreaterThanOrEqual(150 * (1 / e.pondZoom - 1) - 1e-9)
  })

  it('resize re-clamps with the zoom-aware span', () => {
    const e = pond(400, 300, 1600, 1200)
    e.setPondZoom(2)
    e.panPond(99999, 99999)
    // Grow the viewport: c=(400,300), so cam ≤ 1600−400·1.5 = 1000.
    e.resize(800, 600, 1)
    expect(e.camX).toBeLessThanOrEqual(1600 - 400 * (1 + 1 / e.pondZoom) + 1e-9)
    expect(e.camY).toBeLessThanOrEqual(1200 - 300 * (1 + 1 / e.pondZoom) + 1e-9)
  })

  it('single-screen pond (no world) pans within its viewport-sized world (v49)', () => {
    const e = new OceanEngine()
    e.resize(400, 300, 1)
    e.stockPond([fish(200, 150)])
    expect(e.pondWW).toBe(0)
    e.setPondZoom(2)
    // Zoomed in, the camera may go negative so the world's top-left —
    // the water surface included — stays reachable on a 1×1 pond too.
    e.panPond(-99999, -99999)
    expect(e.screenToWorld(0, 0).x).toBeCloseTo(0, 6)
    expect(e.screenToWorld(0, 0).y).toBeCloseTo(0, 6)
    e.zoomPond(390, 10, 1.2)
    expect(e.pondZoom).toBe(2.4)
  })
})
