/** Worker-side star assignment: deterministic, 108 unique, pure hash. */
import { describe, expect, it } from 'vitest'
import { STARS, starOf, starRankOf, starRankOfStar } from '../cloudflare/src/stars.ts'

describe('worker starOf', () => {
  it('hashes ANY name to a star — no roster coupling', () => {
    // Hero-style names no longer get roster stars; they hash like everything else.
    expect(starOf('呼保义·宋江')).toBe(starOf('呼保义·宋江'))
    expect(STARS).toContain(starOf('豹子头·林冲'))
  })

  it('assigns a star to every creature name deterministically', () => {
    const a = starOf('阳光小憨龟')
    expect(STARS).toContain(a)
    expect(starOf('阳光小憨龟')).toBe(a)
    expect(starOf('星屑蝰蛇')).toBe(starOf('星屑蝰蛇'))
  })

  it('holds 108 unique stars with consistent ranks', () => {
    expect(new Set(STARS).size).toBe(108)
    const rank = starRankOf('阳光小憨龟')
    expect(rank).toBeGreaterThanOrEqual(1)
    expect(rank).toBeLessThanOrEqual(108)
    expect(starRankOfStar(STARS[rank - 1] ?? '')).toBe(rank)
  })
})
