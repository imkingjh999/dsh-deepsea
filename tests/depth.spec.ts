import { describe, expect, it } from 'vitest'
import { occupancyOf, zoneIndexOf, zoneOf, ZONES, RARITIES, RARITY_META } from '../src/client/depth.ts'

describe('depth zones', () => {
  it('maps occupancy to the four zones with stable boundaries', () => {
    expect(zoneIndexOf(0)).toBe(0)
    expect(zoneIndexOf(0.34)).toBe(0)
    expect(zoneIndexOf(0.35)).toBe(1)
    expect(zoneIndexOf(0.599)).toBe(1)
    expect(zoneIndexOf(0.6)).toBe(2)
    expect(zoneIndexOf(0.849)).toBe(2)
    expect(zoneIndexOf(0.85)).toBe(3)
    expect(zoneIndexOf(1)).toBe(3)
  })

  it('clamps out-of-range occupancy instead of throwing', () => {
    expect(zoneIndexOf(-3)).toBe(0)
    expect(zoneIndexOf(42)).toBe(3)
    expect(zoneIndexOf(Number.NaN)).toBe(0)
  })

  it('zoneOf returns the zone object matching the index', () => {
    expect(zoneOf(0.9).id).toBe('abyss')
    expect(zoneOf(0.1).id).toBe('sunlit')
  })

  it('zones cover [0,1] without gaps', () => {
    for (let t = 0; t <= 1.0001; t += 0.001) {
      const idx = zoneIndexOf(t)
      const zone = ZONES[idx]
      expect(zone, `t=${t.toFixed(3)}`).toBeDefined()
      if (t <= 1) expect(t).toBeGreaterThanOrEqual(zone!.lo)
      expect(t).toBeGreaterThanOrEqual(zone!.lo)
    }
  })
})

describe('occupancyOf', () => {
  it('derives occupancy from the contextPressure snapshot', () => {
    expect(occupancyOf({ projectedTokens: 50_000, contextWindow: 100_000 })).toBe(0.5)
    expect(occupancyOf({ pressureTokens: 25_000, contextWindow: 100_000 })).toBe(0.25)
  })

  it('returns null when figures are missing or degenerate', () => {
    expect(occupancyOf(undefined)).toBeNull()
    expect(occupancyOf(null)).toBeNull()
    expect(occupancyOf({})).toBeNull()
    expect(occupancyOf({ projectedTokens: 10, contextWindow: 0 })).toBeNull()
  })

  it('clamps occupancy into [0,1]', () => {
    expect(occupancyOf({ projectedTokens: 300_000, contextWindow: 100_000 })).toBe(1)
  })
})

describe('rarity meta', () => {
  it('lists the four Hearthstone-style rarities with distinct colors', () => {
    expect(RARITIES).toEqual(['COMMON', 'RARE', 'EPIC', 'LEGENDARY'])
    const colors = new Set(RARITIES.map((r) => RARITY_META[r].color))
    expect(colors.size).toBe(4)
  })
})
