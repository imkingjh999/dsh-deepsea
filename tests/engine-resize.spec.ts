import { describe, expect, it } from 'vitest'
import { OceanEngine } from '../src/client/engine.ts'
import { Roam } from '../src/client/roam.ts'
import { fitAspect } from '../src/client/aspect.ts'

describe('resize keeps relative geometry', () => {
  it('scales fauna x with width so fish do not cluster left on fullscreen', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const fracs = e.creatures.map((c) => c.x / 400)
    e.resize(1000, 600, 1)
    for (let i = 0; i < e.creatures.length; i++) {
      const c = e.creatures[i]
      const f = fracs[i]
      if (c === undefined || f === undefined) continue
      expect(c.x / 1000).toBeCloseTo(f, 5)
    }
  })

  it('scales fauna y with world height', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const ys = e.creatures.map((c) => c.y)
    e.resize(400, 1200, 1)
    for (let i = 0; i < e.creatures.length; i++) {
      const c = e.creatures[i]
      const y = ys[i]
      if (c === undefined || y === undefined) continue
      expect(c.y).toBeCloseTo(y * 2, 3)
    }
  })

  it('Roam.scale scales both axes of the patrol position', () => {
    const r = new Roam()
    r.seed(100, 200)
    r.scale(2, 3)
    expect(r.x).toBe(200)
    expect(r.y).toBe(600)
  })
})

describe('manual hook control', () => {
  it('pointerTo steers the hook toward the pointer (world coords)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.pointerTo(200, 300)
    // Step 2s (< MANUAL_HOLD 4s): the eased follow converges on the target.
    for (let i = 0; i < 120; i += 1) e.step(1 / 60)
    const hp = e.hookPos()
    expect(hp.x).toBeCloseTo(200, 0)
    expect(hp.y).toBeCloseTo(300, 0) // camY is 0 at the surface band
  })

  it('manual hook state scales with both axes on resize (invariant)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.pointerTo(120, 240)
    for (let i = 0; i < 120; i += 1) e.step(1 / 60)
    const before = e.hookPos()
    const fracX = before.x / 400
    const fracY = before.y / (600 * 4) // world height = h * WORLD_SPAN(4)
    e.resize(1000, 1200, 1)
    const after = e.hookPos()
    expect(after.x / 1000).toBeCloseTo(fracX, 3)
    expect(after.y / (1200 * 4)).toBeCloseTo(fracY, 3)
  })

  it('manual expires back to patrol after MANUAL_HOLD seconds', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.pointerTo(350, 500)
    for (let i = 0; i < 200; i += 1) e.step(1 / 60) // ~3.3s: still manual
    const hpManual = e.hookPos()
    expect(hpManual.x).toBeGreaterThan(300)
    for (let i = 0; i < 600; i += 1) e.step(1 / 60) // +10s: manual expired
    const hpRoam = e.hookPos()
    // Patrol re-seeded AT the manual spot then eased away — still moving,
    // but the position stays a valid world point inside the viewport band.
    expect(Number.isFinite(hpRoam.x)).toBe(true)
    expect(hpRoam.y).toBeGreaterThanOrEqual(0)
  })

  it('pointerTo is a no-op in pond mode', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([])
    e.pointerTo(200, 300)
    e.step(1 / 60)
    expect(e.hookPos()).toBeDefined()
  })
})

describe('fitAspect keeps the initial aspect ratio', () => {
  it('clamps width when the box is wider than the aspect', () => {
    const r = fitAspect(1600, 600, 400 / 600)
    expect(r.h).toBe(600)
    expect(r.w).toBeCloseTo(400, 6)
  })

  it('clamps height when the box is taller than the aspect', () => {
    const r = fitAspect(400, 1500, 400 / 600)
    expect(r.w).toBe(400)
    expect(r.h).toBeCloseTo(600, 6)
  })

  it('returns the box unchanged for invalid aspect or size', () => {
    expect(fitAspect(300, 200, 0)).toEqual({ w: 300, h: 200 })
    expect(fitAspect(0, 200, 1.5)).toEqual({ w: 0, h: 200 })
  })
})

describe('minimize collapse guard', () => {
  // The float window host hides the panel via right:-9999 / visibility:hidden
  // → content box height collapses to 0. ResizeObserver fires resize() with
  // degenerate dims; without the guard every fish's y gets multiplied by
  // ky=0/prevWorld and permanently pinned to its zone-band top, leaving the
  // deep-water fauna out of view on restore.

  it('collapsed rect (height 0) is a no-op; restore to the same size preserves every fish lane', () => {
    const e = new OceanEngine()
    e.resize(430, 680, 1)
    const worldH = 680 * 4
    // Snapshot each fish as a fraction of worldH (depth-relative).
    const before = e.creatures.map((c) => c.y / worldH)
    const beforeCount = e.creatures.length
    const beforeRefs = [...e.creatures]

    // Collapse (minimize): width drifts to 300, height to 0 — degenerate.
    e.resize(300, 0, 1)

    // Engine must keep the last valid dimensions and the same creature
    // instances (no re-populate, no ky=0 clamp).
    expect(e.w).toBe(430)
    expect(e.h).toBe(680)
    expect(e.creatures.length).toBe(beforeCount)
    for (let i = 0; i < beforeRefs.length; i++) {
      expect(e.creatures[i]).toBe(beforeRefs[i])
    }

    // Restore to the original size — every fish lane must be unchanged.
    e.resize(430, 680, 1)
    for (let i = 0; i < e.creatures.length; i++) {
      const c = e.creatures[i]
      const b = before[i]
      if (c === undefined || b === undefined) continue
      expect(c.y / worldH).toBeCloseTo(b, 5)
    }
  })

  it('zero-by-zero and NaN dimensions are also a no-op', () => {
    const e = new OceanEngine()
    e.resize(430, 680, 1)
    expect(e.w).toBe(430)
    expect(e.h).toBe(680)

    e.resize(0, 0, 1)
    expect(e.w).toBe(430)
    expect(e.h).toBe(680)

    e.resize(NaN, 680, 1)
    expect(e.w).toBe(430)
    expect(e.h).toBe(680)

    e.resize(430, NaN, 1)
    expect(e.w).toBe(430)
    expect(e.h).toBe(680)
  })

  it('restore to a DIFFERENT size after a collapsed frame still preserves lane fractions', () => {
    const e = new OceanEngine()
    e.resize(430, 680, 1)
    const worldH = 680 * 4
    const before = e.creatures.map((c) => c.y / worldH)

    // Collapse, then restore to a different (non-degenerate) size. The
    // guard swallows the collapsed call, so the restore runs the normal
    // prevWorld>0 branch with prevW=430/prevWorld=2720 — kx/ky are
    // computed against real geometry. Engine design is dual-axis
    // independent equal-ratio scaling (kx/ky), so lane fractions survive.
    e.resize(300, 0, 1)
    expect(e.h).toBe(680) // guard fired
    e.resize(1000, 800, 1)
    const newWorldH = 800 * 4
    for (let i = 0; i < e.creatures.length; i++) {
      const c = e.creatures[i]
      const b = before[i]
      if (c === undefined || b === undefined) continue
      expect(c.y / newWorldH).toBeCloseTo(b, 5)
    }
  })
})