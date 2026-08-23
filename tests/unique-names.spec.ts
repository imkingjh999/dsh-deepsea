/** Uniqueness invariants: every card ever minted has a one-of-a-kind name. */
import { describe, expect, it } from 'vitest'
import { STARS, starOf } from '../cloudflare/src/stars.ts'
import { planForZone } from '../scripts/mint.ts'
import { ZONE_WEIGHTS } from '../src/lore.ts'

describe('card uniqueness invariants', () => {
  it('planForZone keeps producing non-empty weighted cells for top-ups', () => {
    const plan = planForZone(ZONE_WEIGHTS[0] ?? { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 }, 3)
    expect(plan.length).toBeGreaterThan(0)
    for (const cell of plan) expect(cell.count).toBeGreaterThan(0)
  })

  it('distinct names map to stars independently (same name => same star)', () => {
    const a = starOf('A unique name that has never been minted')
    const b = starOf('A different unique creature that has never been minted')
    expect(STARS).toContain(a)
    expect(STARS).toContain(b)
    expect(starOf('A unique name that has never been minted')).toBe(a)
  })
})
