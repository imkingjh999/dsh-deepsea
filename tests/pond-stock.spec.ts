// @vitest-environment node
/** Pond 1:1 mapping: each card deterministically becomes one creature,
 * kind driven by the card NAME so the pond animal reads as the card.
 * v42: the pond stocks the WHOLE wall (every seat card + unseated
 * overflow), not a 14-fish sample. pondStock / pondRosterOf /
 * pondWorldFor live here so the whole pool→creature chain stays
 * covered.
 *
 * v46: the v42 seat-folding helper `wallFishOf` is gone — the pond now
 * stocks EVERY owned card directly (duplicates included). The
 * "roster" tests below lock the new 1:1 contract. */
import { describe, expect, it } from 'vitest'
import { pondRosterOf, pondStock, pondWorldFor } from '../src/client/pond.tsx'
import type { CardRecord } from '../src/client/depth.ts'

const card = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  id: 'aaaa1111', name: '暮光小灯', species: '灯笼鱼', rarity: 'COMMON',
  story: '她点亮额顶小灯。', depth: 0.42, zone: 'twilight',
  createdAt: 1_786_991_217_191, model: 'MiniMax-M3',
  art: '', holo: '', mask: '',
  ...overrides,
})

describe('pondStock (card -> pond animal, 1:1)', () => {
  it('is deterministic per card name', () => {
    const cards = [card({ name: '星河蛟鲨', zone: 'twilight', rarity: 'EPIC' }),
      card({ name: '暮棘灵灯', zone: 'abyss', rarity: 'RARE' })]
    const a = pondStock(cards, 400, 400)
    const b = pondStock(cards, 400, 400)
    expect(a.map((c) => [c.kind, c.hue, c.size, c.x, c.y, c.vx]))
      .toEqual(b.map((c) => [c.kind, c.hue, c.size, c.x, c.y, c.vx]))
  })

  it('maps name keywords to matching creature kinds', () => {
    const [lamp] = pondStock([card({ name: '渊冕星烛神', zone: 'abyss', rarity: 'LEGENDARY' })], 400, 400)
    expect(lamp?.kind).toBe('angler')
    const [turtle] = pondStock([card({ name: '阳光小憨龟', zone: 'sunlit', rarity: 'COMMON' })], 400, 400)
    expect(turtle?.kind).toBe('turtle')
    const [viper] = pondStock([card({ name: '星渊蝰蛇', zone: 'midnight', rarity: 'RARE' })], 400, 400)
    expect(viper?.kind).toBe('viper')
  })

  it('enlarges and gilds legendary cards', () => {
    const common = pondStock([card({ name: '琉璃电纹鲶', zone: 'sunlit', rarity: 'COMMON' })], 400, 400)[0]
    const legend = pondStock([card({ name: '琉璃电纹鲶', zone: 'sunlit', rarity: 'LEGENDARY' })], 400, 400)[0]
    expect((legend?.size ?? 0) - (common?.size ?? 0)).toBeCloseTo(16, 6)
  })

  it('keeps creature order aligned with card order (index i = card i)', () => {
    const cards = [
      card({ name: '甲鱼一号', zone: 'sunlit', rarity: 'COMMON' }),
      card({ name: '乙鳗二号', zone: 'abyss', rarity: 'EPIC' }),
      card({ name: '丙鲨三号', zone: 'twilight', rarity: 'RARE' }),
    ]
    const creatures = pondStock(cards, 400, 400)
    expect(creatures.length).toBe(cards.length)
  })

  it('lays out every creature inside the world bounds (x in [0,w), y in [0.08h, 0.92h])', () => {
    const cards = Array.from({ length: 40 }, (_, i) => card({ name: '某鱼' + i, zone: 'sunlit', rarity: 'COMMON' }))
    const w = 1200; const h = 900
    const creatures = pondStock(cards, w, h)
    for (const c of creatures) {
      expect(c.x).toBeGreaterThanOrEqual(0)
      expect(c.x).toBeLessThan(w)
      expect(c.y).toBeGreaterThanOrEqual(h * 0.08)
      expect(c.y).toBeLessThanOrEqual(h * 0.92)
    }
  })
})

describe('pondRosterOf (v46 1:1 card → fish roster)', () => {
  it('returns one fish per owned card (duplicates count separately)', () => {
    const input = [
      card({ id: 'a1', name: '甲鱼', starRank: 1, createdAt: 300 }),
      card({ id: 'a2', name: '甲鱼', starRank: 1, createdAt: 200 }),
      card({ id: 'a3', name: '甲鱼', starRank: 1, createdAt: 100 }),
      card({ id: 'b1', name: '乙鳗', starRank: 5, createdAt: 50 }),
    ]
    const fish = pondRosterOf(input)
    // v46: 4 owned cards → 4 fish (duplicates surface as their own fish).
    expect(fish.length).toBe(4)
    const ids = fish.map((c) => c.id)
    expect(ids).toEqual(['a1', 'a2', 'a3', 'b1'])
  })

  it('preserves the source order (the React layer owns any reordering)', () => {
    const input = [
      card({ id: 'late', name: '鱼A', starRank: 108 }),
      card({ id: 'mid', name: '鱼B', starRank: 54 }),
      card({ id: 'top', name: '鱼C', starRank: 1 }),
      card({ id: 'extra', name: '鱼D' }),
    ]
    const fish = pondRosterOf(input)
    expect(fish.map((c) => c.id)).toEqual(['late', 'mid', 'top', 'extra'])
  })

  it('returns an empty list for an empty input', () => {
    expect(pondRosterOf([])).toEqual([])
  })
})

describe('pondWorldFor (multi-screen pond geometry)', () => {
  it('collapses to a single screen when the card count fits POND_PER_SCREEN', () => {
    const g = pondWorldFor(1, 400, 600)
    expect(g.cols).toBe(1)
    expect(g.rows).toBe(1)
    expect(g.worldW).toBe(400)
    expect(g.worldH).toBe(600)
  })

  it('grows the world in both axes for a 108-card wall (S=8 → 3×3)', () => {
    const g = pondWorldFor(108, 400, 600)
    expect(g.cols).toBe(3)
    expect(g.rows).toBe(3)
    expect(g.worldW).toBe(400 * 3)
    expect(g.worldH).toBe(600 * 3)
  })

  it('uses a single screen for exactly POND_PER_SCREEN cards (14)', () => {
    const g = pondWorldFor(14, 500, 400)
    expect(g.cols).toBe(1)
    expect(g.rows).toBe(1)
    expect(g.worldW).toBe(500)
    expect(g.worldH).toBe(400)
  })

  it('keeps the school at ~POND_PER_SCREEN per visible screen (15 → 2 screens)', () => {
    const g = pondWorldFor(15, 500, 400)
    expect(g.cols * g.rows).toBe(2)
    // 2 screens → 2×1 grid (cols=2, rows=1). Width grows, height
    // stays at one viewport tall.
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(1)
    expect(g.worldW).toBe(500 * 2)
    expect(g.worldH).toBe(400)
  })

  it('falls back to a 1×1 world for non-positive viewport dims', () => {
    // Non-positive viewport → each cell defaults to 1×1, so the world
    // stays at least 1×cols / 1×rows. count=40 → ceil(40/14)=3 screens
    // → 2×2 grid. The cells are 1×1 because both dims are non-positive.
    const g = pondWorldFor(40, 0, 0)
    expect(g.cols).toBe(2)
    expect(g.rows).toBe(2)
    expect(g.worldW).toBeGreaterThan(0)
    expect(g.worldH).toBeGreaterThan(0)
  })
})