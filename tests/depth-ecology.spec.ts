/** Depth-ecology gradients (feedback: deeper = fewer fish, longer catch
 * guarantee, higher rarity). Locks the shape of the curve. */
import { describe, expect, it } from 'vitest'
import { ZONE_WEIGHTS, rollRarity } from '../src/lore.ts'

function seeded(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

describe('depth ecology gradients', () => {
  it('rarity steepens with depth: sunlit is COMMON-heavy, abyss LEGENDARY-heavy', () => {
    expect(ZONE_WEIGHTS[0]!.COMMON).toBeGreaterThan(ZONE_WEIGHTS[3]!.COMMON)
    expect(ZONE_WEIGHTS[3]!.LEGENDARY).toBeGreaterThan(ZONE_WEIGHTS[0]!.LEGENDARY * 5)
    // every zone can still roll every rarity
    for (const z of [0, 1, 2, 3] as const) {
      const seen = new Set<string>()
      for (let i = 0; i < 3000 && seen.size < 4; i++) seen.add(rollRarity(z, () => seeded(i + z * 97)))
      expect(seen.size).toBe(4)
    }
  })

  it('abyss draws are LEGENDARY more often than sunlit draws', () => {
    let deep = 0; let shallow = 0
    for (let i = 0; i < 4000; i++) {
      if (rollRarity(3, () => seeded(i + 1)) === 'LEGENDARY') deep += 1
      if (rollRarity(0, () => seeded(i + 1)) === 'LEGENDARY') shallow += 1
    }
    expect(deep).toBeGreaterThan(shallow * 5)
  })
})
