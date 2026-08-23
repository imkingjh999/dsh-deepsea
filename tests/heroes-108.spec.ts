/**
 * The Water Margin 108-hero set: canonical count, unique identities,
 * Hearthstone tier split by seat rank, and full zone×rarity coverage of
 * every cell the weight table can roll.
 */
import { describe, expect, it } from 'vitest'
import { HEROES, heroPlanGaps } from '../src/heroes-108.ts'
import { ZONE_WEIGHTS } from '../src/lore.ts'

describe('heroes-108', () => {
  it('holds exactly the 108 Stars of Destiny with unique names', () => {
    expect(HEROES.length).toBe(108)
    expect(new Set(HEROES.map((h) => h.name)).size).toBe(108)
    expect(HEROES.some((h) => h.name === '宋江')).toBe(true)
    expect(HEROES.some((h) => h.name === '时迁')).toBe(true)
    expect(HEROES.some((h) => h.name === '段景住')).toBe(true)
  })

  it('splits tiers by seat rank (36 天罡 / 72 地煞)', () => {
    const count = (r: string) => HEROES.filter((h) => h.rarity === r).length
    expect(count('LEGENDARY')).toBe(10)
    expect(count('EPIC')).toBe(26)
    expect(count('RARE')).toBe(36)
    expect(count('COMMON')).toBe(36)
    const songjiang = HEROES.find((h) => h.name === '宋江')
    expect(songjiang?.rank).toBe(1)
    expect(songjiang?.rarity).toBe('LEGENDARY')
    const duanjingzhu = HEROES.find((h) => h.name === '段景住')
    expect(duanjingzhu?.rank).toBe(108)
    expect(duanjingzhu?.rarity).toBe('COMMON')
  })

  it('stocks every zone×rarity cell the weight table can roll', () => {
    expect(heroPlanGaps(ZONE_WEIGHTS as unknown as Array<Record<string, number>>)).toEqual([])
  })

  it('assigns only valid zones', () => {
    const valid = new Set(['sunlit', 'twilight', 'midnight', 'abyss'])
    for (const h of HEROES) expect(valid.has(h.zone)).toBe(true)
  })
})
