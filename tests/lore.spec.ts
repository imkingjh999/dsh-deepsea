import { describe, expect, it } from 'vitest'
import { lorePrompts, parseLore, rollRarity, ZONE_WEIGHTS } from '../src/lore.ts'

describe('rollRarity (depth-weighted)', () => {
  const seedRandom = (seed: number): (() => number) => {
    let s = seed
    return () => {
      s = (s * 9301 + 49_297) % 233_280
      return s / 233_280
    }
  }

  it('sunlit never rolls EPIC-heavy tiers often but stays in the ladder', () => {
    for (let i = 0; i < 500; i++) {
      const r = rollRarity(0)
      expect(['COMMON', 'RARE', 'EPIC', 'LEGENDARY']).toContain(r)
    }
  })

  it('the abyss can mint every rarity including LEGENDARY', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000 && seen.size < 4; i++) seen.add(rollRarity(3))
    expect([...seen].sort()).toEqual(['COMMON', 'EPIC', 'LEGENDARY', 'RARE'])
  })

  it('distribution roughly follows the weight table (seeded)', () => {
    const counts = { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 } as Record<string, number>
    const n = 4000
    for (let i = 0; i < n; i++) counts[rollRarity(3, seedRandom(i + 1))]! += 1
    // abyss: COMMON 10 / RARE 30 / EPIC 38 / LEGENDARY 22 → generous tolerance
    expect(counts.COMMON! / n).toBeLessThan(0.18)
    expect(counts.RARE! / n).toBeGreaterThan(0.22)
    expect(counts.LEGENDARY! / n).toBeGreaterThan(0.14)
  })

  it('clamps invalid zone indexes', () => {
    expect(rollRarity(99)).toBeDefined()
    expect(rollRarity(-1)).toBeDefined()
  })

  it('each zone weight table sums to 100', () => {
    for (const w of ZONE_WEIGHTS) {
      expect(Object.values(w).reduce((a, b) => a + b, 0)).toBe(100)
    }
  })
})

describe('lorePrompts / parseLore', () => {
  it('prompts mention the zone flavor and rarity', () => {
    const [system, user] = lorePrompts(3, 'LEGENDARY')
    expect(system).toContain('JSON')
    expect(user).toContain('深渊')
    expect(user).toContain('LEGENDARY')
  })

  it('parses a plain JSON reply', () => {
    const lore = parseLore(
      '{"name":"渊灯","species":"灯笼鱼","story":"它发光。","imagePrompt":"a glowing fish"}')
    expect(lore.name).toBe('渊灯')
    expect(lore.species).toBe('灯笼鱼')
  })

  it('tolerates markdown fences and trailing chatter', () => {
    const raw = '好的！\n```json\n{"name":"星鳞","species":"飞鱼",'
      + '"story":"s","imagePrompt":"p"}\n```\n希望你喜欢'
    expect(parseLore(raw).name).toBe('星鳞')
  })

  it('rejects payloads with missing fields', () => {
    expect(() => parseLore('{"name":"x"}')).toThrow()
    expect(() => parseLore('not json at all')).toThrow()
  })
})
