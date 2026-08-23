/**
 * The five great oceans: profile validity (every zone pool references a
 * real creature kind, hues and tints are sane, every ocean decorates its
 * seabed), the memoized session roll, and the deterministic seabed decor
 * layout that keeps window resizes proportional (fractions, not pixels).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_HUES, kindsOf, hueOf, OCEANS, oceanById,
  rollSessionOcean, setSessionOcean } from '../src/client/oceans.ts'
import { seededDecor } from '../src/client/decor.ts'

const VALID_KINDS = new Set(['fish', 'turtle', 'hatchet', 'jelly', 'viper', 'squid', 'angler', 'octopus', 'eel'])
const VALID_DECOR = new Set(['seaweed', 'kelp', 'coral', 'rock', 'anemone', 'ice', 'tubeWorm'])

describe('five oceans', () => {
  it('has exactly the five great oceans with unique ids', () => {
    expect(OCEANS.length).toBe(5)
    expect(new Set(OCEANS.map((o) => o.id)).size).toBe(5)
    expect(OCEANS.map((o) => o.id)).toEqual(['pacific', 'atlantic', 'indian', 'arctic', 'southern'])
  })

  it('every zone pool is non-empty and only references real creature kinds', () => {
    for (const ocean of OCEANS) {
      expect(ocean.kinds.length).toBe(4)
      for (const pool of ocean.kinds) {
        expect(pool.length).toBeGreaterThan(0)
        for (const kind of pool) expect(VALID_KINDS.has(kind)).toBe(true)
      }
    }
  })

  it('each ocean fauna differs — characteristic creatures per ocean', () => {
    const signatures = new Set(
      OCEANS.map((o) => o.kinds.map((pool) => [...pool].sort().join(',')).join('|')),
    )
    expect(signatures.size).toBe(OCEANS.length)
  })

  it('hues and tints are sane; decor uses valid kinds and every ocean decorates', () => {
    for (const ocean of OCEANS) {
      expect(ocean.hues.length).toBe(4)
      for (const hue of ocean.hues) {
        expect(Number.isFinite(hue)).toBe(true)
        expect(hue).toBeGreaterThanOrEqual(0)
        expect(hue).toBeLessThan(360)
      }
      for (const v of [ocean.tint.r, ocean.tint.g, ocean.tint.b]) {
        expect(Math.abs(v)).toBeLessThanOrEqual(20)
      }
      const kinds = Object.keys(ocean.decor)
      expect(kinds.length).toBeGreaterThan(0)
      let total = 0
      for (const kind of kinds) {
        expect(VALID_DECOR.has(kind)).toBe(true)
        const n = ocean.decor[kind as keyof typeof ocean.decor] ?? 0
        expect(n).toBeGreaterThan(0)
        total += n
      }
      expect(total).toBeGreaterThanOrEqual(8)
      expect(total).toBeLessThanOrEqual(25)
    }
  })

  it('kindsOf/hueOf never crash and fall back safely', () => {
    const pacific = oceanById('pacific')
    expect(kindsOf(pacific, 0).length).toBeGreaterThan(0)
    expect(kindsOf(pacific, 99).length).toBeGreaterThan(0)
    expect(hueOf(null, 0)).toBe(DEFAULT_HUES[0])
    expect(hueOf(pacific, 99)).toBe(DEFAULT_HUES[0])
    expect(oceanById('nope').id).toBe('pacific')
  })

  it('session roll picks one of the five and stays memoized', () => {
    setSessionOcean(null)
    const a = rollSessionOcean()
    expect(OCEANS.includes(a)).toBe(true)
    for (let i = 0; i < 5; i += 1) expect(rollSessionOcean()).toBe(a)
    setSessionOcean(null)
  })

  // v46: the picker lets the diver pin / change the session ocean from
  // any view. setSessionOcean must override the memoized roll AND
  // setting it back to null must hand control back to the random roll
  // (a fresh seed on every "null" transition).
  it('v46 setSessionOcean(pacific) makes every subsequent roll return pacific', () => {
    setSessionOcean(null)
    const before = rollSessionOcean()
    void before // baseline sanity: a real ocean
    setSessionOcean(oceanById('pacific'))
    for (let i = 0; i < 5; i += 1) {
      expect(rollSessionOcean().id).toBe('pacific')
    }
    setSessionOcean(null)
  })

  it('v46 setSessionOcean(atlantic) wins over the memo until cleared', () => {
    setSessionOcean(null)
    setSessionOcean(oceanById('atlantic'))
    expect(rollSessionOcean().id).toBe('atlantic')
    // Clear: next roll re-rolls to one of the five — must NOT keep
    // returning atlantic forever.
    setSessionOcean(null)
    const after = rollSessionOcean()
    expect(OCEANS.map((o) => o.id)).toContain(after.id)
    setSessionOcean(null)
  })

  it('v46 setSessionOcean(null) hands the session back to a fresh random roll', () => {
    setSessionOcean(oceanById('indian'))
    expect(rollSessionOcean().id).toBe('indian')
    setSessionOcean(null)
    // The very next roll may land anywhere (including indian), but it
    // must be one of the five oceans — not undefined.
    expect(OCEANS.map((o) => o.id)).toContain(rollSessionOcean().id)
    setSessionOcean(null)
  })
})

describe('seabed decor layout', () => {
  it('is deterministic: same ocean → same layout, forever', () => {
    const pacific = oceanById('pacific')
    const a = seededDecor(pacific)
    const b = seededDecor(pacific)
    expect(a).toEqual(b)
  })

  it('different oceans lay out differently', () => {
    const a = seededDecor(oceanById('pacific'))
    const b = seededDecor(oceanById('arctic'))
    expect(a).not.toEqual(b)
  })

  it('items live inside the width fraction range and honor the cap', () => {
    for (const ocean of OCEANS) {
      const items = seededDecor(ocean)
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.xFrac).toBeGreaterThanOrEqual(0)
        expect(item.xFrac).toBeLessThanOrEqual(1)
        expect(VALID_DECOR.has(item.kind)).toBe(true)
        expect(item.s).toBeGreaterThanOrEqual(0.7)
        expect(item.s).toBeLessThanOrEqual(1.36)
      }
      const capped = seededDecor(ocean, 4)
      expect(capped.length).toBe(4)
    }
  })

  it('census expansion matches the profile counts', () => {
    const southern = oceanById('southern')
    const items = seededDecor(southern)
    const count = (kind: string): number => items.filter((i) => i.kind === kind).length
    expect(count('rock')).toBe(southern.decor.rock ?? 0)
    expect(count('tubeWorm')).toBe(southern.decor.tubeWorm ?? 0)
    expect(count('kelp')).toBe(southern.decor.kelp ?? 0)
    expect(count('coral')).toBe(0) // southern has no coral
  })
})
