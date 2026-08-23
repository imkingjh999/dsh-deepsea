// @vitest-environment node
/**
 * v44 pond-floor retune (user: 土壤图层改在海草的图层下面吧, 现在才三棵,
 * 要多10倍吧, 另外要加点珊瑚海星, 一些无名的小鱼):
 * the three pure helpers behind the pond floor — the thin soil seam,
 * the buried plant root, and the per-screen decor CENSUS (replaces v43's
 * warm-decor filter; the abundance boost + coral/starfish reintroduction
 * come from this function rather than ad-hoc subtraction). The shared
 * dune curve they root against is also covered here.
 */
import { describe, expect, it } from 'vitest'
import { duneSurfaceY } from '../src/client/decor.ts'
import {
  POND_FLOOR_FRAC, pondDecorCensus, pondFloorY, pondPlantRootY, pondSurfaceY,
} from '../src/client/pond-bg.ts'
import type { OceanProfile } from '../src/client/oceans.ts'

const profile = (decor: OceanProfile['decor']): OceanProfile => ({
  id: 'pacific',
  kinds: [['fish'], ['jelly'], ['squid'], ['angler']],
  hues: [30, 190, 205, 268],
  tint: { r: 4, g: 10, b: 16 },
  decor,
})

describe('pondFloorY (soil 90% thinner)', () => {
  it('puts the soil top at 98.6% of the world height', () => {
    expect(POND_FLOOR_FRAC).toBe(0.986)
    expect(pondFloorY(1000)).toBeCloseTo(986, 6)
  })

  it('keeps exactly 10% of the old 0.14h band thickness (90% thinner)', () => {
    const h = 600
    const oldBand = h - h * 0.86 // pre-v43 pond floor band
    const newBand = h - pondFloorY(h)
    expect(newBand / oldBand).toBeCloseTo(0.1, 5)
  })

  it('returns 0 for degenerate heights instead of NaN', () => {
    expect(pondFloorY(0)).toBe(0)
    expect(pondFloorY(-5)).toBe(0)
  })
})

describe('duneSurfaceY (shared floor wiggle)', () => {
  it('oscillates within ±6px around the floor line', () => {
    for (let x = 0; x <= 2000; x += 13) {
      const y = duneSurfaceY(x, 500)
      expect(y).toBeGreaterThanOrEqual(494)
      expect(y).toBeLessThanOrEqual(506)
    }
  })

  it('matches the historic drawFloorBand formula exactly', () => {
    // The pre-v43 inline expression — the extraction must be a pure
    // refactor, not a re-tune.
    expect(duneSurfaceY(137, 400)).toBe(400 + Math.sin(137 * 0.02 + 1.3) * 6)
  })
})

describe('pondPlantRootY (green seaweed planted INTO the soil)', () => {
  const h = 600
  const floorY = pondFloorY(h)
  const soilH = h - floorY // ≈ 8.4px

  it('buries the base at least 3px under the LOCAL dune surface', () => {
    for (let x = 0; x <= 2000; x += 29) {
      expect(pondPlantRootY(x, floorY, soilH)).toBeGreaterThanOrEqual(duneSurfaceY(x, floorY) + 3)
    }
  })

  it('caps the bury depth at 5px (thick seams do not swallow plants)', () => {
    const thick = pondPlantRootY(100, 500, 40)
    expect(thick).toBeCloseTo(duneSurfaceY(100, 500) + 5, 6)
  })

  it('is deterministic per x', () => {
    expect(pondPlantRootY(321, floorY, soilH)).toBe(pondPlantRootY(321, floorY, soilH))
  })
})

describe('pondDecorCensus (per-screen, abundance ×10 + coral/starfish reintro)', () => {
  const src = profile({ coral: 8, anemone: 5, seaweed: 3, rock: 2, kelp: 1, ice: 4, tubeWorm: 2 })

  it('1 screen: plants×30 (seaweed 21 / kelp 9) + coral 4 + starfish 3', () => {
    const out = pondDecorCensus(src, 1)
    expect(out.seaweed).toBe(21)    // round(30 * 0.7)
    expect(out.kelp).toBe(9)        // 30 − 21
    expect(out.coral).toBe(4)       // min(4×1, 36)
    expect(out.starfish).toBe(3)    // min(3×1, 24)
  })

  it('1 screen: neutral kinds pass through (rock 2 / tubeWorm 2 — v45 dropped ice)', () => {
    const out = pondDecorCensus(src, 1)
    expect(out.rock).toBe(2)
    expect(out.tubeWorm).toBe(2)
  })

  it('1 screen: ice is NEVER included (v45 user delete: 海底还有一些白色三角形是啥? 删掉)', () => {
    const out = pondDecorCensus(src, 1)
    expect(out.ice).toBeUndefined()
  })

  it('1 screen: anemone is NEVER included (v43 ban is enforced by absence)', () => {
    const out = pondDecorCensus(src, 1)
    expect(out.anemone).toBeUndefined()
  })

  it('9 screens: plants cap at 240, coral cap at 36, starfish cap at 24', () => {
    const out = pondDecorCensus(src, 9)
    expect((out.seaweed ?? 0) + (out.kelp ?? 0)).toBe(240) // min(30×9, 240)
    expect(out.coral).toBe(36)     // min(4×9, 36)
    expect(out.starfish).toBe(24)  // min(3×9, 24)
  })

  it('higher screens never exceed the cap (50 screens still 240/36/24)', () => {
    const out = pondDecorCensus(src, 50)
    expect((out.seaweed ?? 0) + (out.kelp ?? 0)).toBe(240)
    expect(out.coral).toBe(36)
    expect(out.starfish).toBe(24)
  })

  it('defaults screens to 1 when omitted (matches the legacy viewport-only world)', () => {
    expect(pondDecorCensus(src)).toEqual(pondDecorCensus(src, 1))
  })

  it('clamps degenerate / non-finite screens up to 1', () => {
    expect(pondDecorCensus(src, 0)).toEqual(pondDecorCensus(src, 1))
    expect(pondDecorCensus(src, -5)).toEqual(pondDecorCensus(src, 1))
    expect(pondDecorCensus(src, Number.NaN)).toEqual(pondDecorCensus(src, 1))
  })

  it('never mutates the input profile (the ocean keeps its census)', () => {
    const frozen = profile({ coral: 7, seaweed: 5, anemone: 4, rock: 3 })
    void pondDecorCensus(frozen, 4)
    expect(frozen.decor.coral).toBe(7)
    expect(frozen.decor.seaweed).toBe(5)
    expect(frozen.decor.anemone).toBe(4)
    expect(frozen.decor.rock).toBe(3)
  })

  it('ignores an anemone-only ocean (no neutral fallback grows from a missing kind)', () => {
    const anemoneOnly = profile({ anemone: 12 })
    const out = pondDecorCensus(anemoneOnly, 1)
    expect(out.anemone).toBeUndefined()
    expect(out.rock).toBeUndefined()
    expect(out.ice).toBeUndefined()
    expect(out.tubeWorm).toBeUndefined()
  })
})
describe('pondSurfaceY (v48 wavy water surface at the world top)', () => {
  const W = 1200
  const H = 900
  const amp = Math.max(3, H * 0.008)

  it('stays within a shallow band hugging the world top', () => {
    // crest oscillates around amp; extremes stay within [-0.2·amp, 2.2·amp]
    for (let i = 0; i < 4000; i++) {
      const x = (i * 13.7) % W
      const t = (i * 0.11) % 60
      const y = pondSurfaceY(x, t, W, H)
      expect(y).toBeGreaterThan(-0.2 * amp)
      expect(y).toBeLessThan(2.2 * amp)
    }
  })

  it('drifts over time at the same spot (a living wave, not a frozen line)', () => {
    const a = pondSurfaceY(300, 0, W, H)
    let moved = false
    for (let t = 0.25; t <= 8; t += 0.25) {
      if (Math.abs(pondSurfaceY(300, t, W, H) - a) > 0.5) { moved = true; break }
    }
    expect(moved).toBe(true)
  })

  it('is periodic across the world width (a continuous surface line)', () => {
    // ~5 wavelengths across W: sampling x and x+W must agree to sub-px.
    for (const t of [0, 1.7, 4.2]) {
      for (const x of [10, 260, 730]) {
        expect(Math.abs(pondSurfaceY(x + W, t, W, H) - pondSurfaceY(x, t, W, H)))
          .toBeLessThan(1e-6)
      }
    }
  })

  it('scales amplitude with world height but never below 3px (small ponds)', () => {
    expect(Math.abs(pondSurfaceY(0, 0, W, 200) - Math.max(3, 200 * 0.008)))
      .toBeLessThan(Math.max(3, 200 * 0.008) * 1.2)
    const tiny = pondSurfaceY(0, 0, W, 50)
    expect(tiny).toBeGreaterThan(-1)
    expect(tiny).toBeLessThan(Math.max(3, 50 * 0.008) * 2.2)
  })
})
