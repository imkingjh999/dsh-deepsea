/**
 * Mint plan math: the pre-minted pool mirrors ZONE_WEIGHTS so every cell
 * rollRarity can draw is stocked, and zero-weight cells stay empty.
 */
import { describe, expect, it } from 'vitest'
import { planForZone } from '../scripts/mint.ts'
import { ZONE_WEIGHTS } from '../src/lore.ts'
import type { Rarity } from '../src/client/depth.ts'
import type { RarityWeights } from '../src/lore.ts'

const RARITIES: readonly Rarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']
const w = (i: number): RarityWeights => ZONE_WEIGHTS[i] ?? { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 }

describe('mint planForZone', () => {
  it('stocks every drawable cell of a zone', () => {
    for (let z = 0; z < ZONE_WEIGHTS.length; z += 1) {
      const plan = planForZone(w(z), 2)
      const stocked = new Set(plan.map((c) => c.rarity))
      for (const rarity of RARITIES) {
        if (w(z)[rarity] > 0) {
          expect(stocked.has(rarity), 'zone ' + z + ' needs ' + rarity).toBe(true)
        }
      }
    }
  })

  it('scales counts monotonically with nPerCell', () => {
    const small = planForZone(w(3), 1)
    const big = planForZone(w(3), 4)
    const totalS = small.reduce((s, c) => s + c.count, 0)
    const totalB = big.reduce((s, c) => s + c.count, 0)
    expect(totalB).toBeGreaterThan(totalS)
  })

  it('abyss plan includes LEGENDARY (weight 22 > 0)', () => {
    const abyss = planForZone(w(3), 2)
    expect(abyss.find((c) => c.rarity === 'LEGENDARY')?.count).toBeGreaterThan(0)
  })
})
