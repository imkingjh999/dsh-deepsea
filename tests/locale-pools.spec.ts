/**
 * Lock the flavor-pool contract behind the roll-theater banner upgrade:
 *
 *   - zh + en both carry hud.rollpool (≥ 5 pipe-separated lines),
 *     hud.wrigpool (≥ 3 lines), and the hud.rollmine / hud.rolltarget
 *     labels for the sub-row;
 *   - the legacy hud.roll / hud.wriggled fallback keys still exist so a
 *     stale render path or a translation drop never produces a blank
 *     banner;
 *   - the module-level `pickFlavor` helper picks one entry per call,
 *     never returns the pool separator, and degrades safely on empty
 *     / single-entry input.
 *
 * The dicts are exported from src/client/locale.ts specifically for this
 * kind of direct inspection (tr() alone can't tell you how many lines are
 * in a pool).
 */
import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locale.ts'
import { pickFlavor } from '../src/client/ocean.tsx'

describe('roll-theater flavor pools (zh + en)', () => {
  const POOLS = [
    { key: 'hud.rollpool', minParts: 5 },
    { key: 'hud.wrigpool', minParts: 3 },
  ] as const

  for (const { key, minParts } of POOLS) {
    for (const [lang, dict] of [['zh', zh], ['en', en]] as const) {
      it(`${lang}.${key} is non-empty and has ≥ ${minParts} pipe-separated parts`, () => {
        const raw = dict[key]
        expect(raw).toBeTypeOf('string')
        expect(raw).not.toBe('')
        const parts = (raw as string).split('|').map((s) => s.trim()).filter((s) => s !== '')
        expect(parts.length).toBeGreaterThanOrEqual(minParts)
        for (const p of parts) expect(p).not.toBe('')
      })
    }
  }
})

describe('roll-theater sub-row labels (zh + en)', () => {
  it('zh has hud.rollmine and hud.rolltarget', () => {
    expect(zh['hud.rollmine']).toBeTypeOf('string')
    expect(zh['hud.rollmine']).not.toBe('')
    expect(zh['hud.rolltarget']).toBeTypeOf('string')
    expect(zh['hud.rolltarget']).not.toBe('')
  })
  it('en has hud.rollmine and hud.rolltarget', () => {
    expect(en['hud.rollmine']).toBeTypeOf('string')
    expect(en['hud.rollmine']).not.toBe('')
    expect(en['hud.rolltarget']).toBeTypeOf('string')
    expect(en['hud.rolltarget']).not.toBe('')
  })
})

describe('legacy hud.roll / hud.wriggled fallback preservation', () => {
  it('zh keeps hud.roll + hud.wriggled as non-empty strings', () => {
    expect(zh['hud.roll']).toBeTypeOf('string')
    expect(zh['hud.roll']).not.toBe('')
    expect(zh['hud.wriggled']).toBeTypeOf('string')
    expect(zh['hud.wriggled']).not.toBe('')
  })
  it('en keeps hud.roll + hud.wriggled as non-empty strings', () => {
    expect(en['hud.roll']).toBeTypeOf('string')
    expect(en['hud.roll']).not.toBe('')
    expect(en['hud.wriggled']).toBeTypeOf('string')
    expect(en['hud.wriggled']).not.toBe('')
  })
})

describe('pickFlavor helper', () => {
  it('returns one of the pool entries verbatim (no separator leakage)', () => {
    const pool = 'alpha|beta|gamma'
    const parts = new Set(pool.split('|'))
    for (let i = 0; i < 60; i++) {
      const picked = pickFlavor(pool)
      expect(parts.has(picked)).toBe(true)
      expect(picked.includes('|')).toBe(false)
    }
  })

  it('skips blank segments when the pool has stray `|`', () => {
    const pool = 'one||three'
    const picked = pickFlavor(pool)
    expect(['one', 'three']).toContain(picked)
  })

  it('returns the original string on empty / non-pool input', () => {
    expect(pickFlavor('')).toBe('')
    expect(pickFlavor('solo')).toBe('solo')
  })
})
