/**
 * The 108-seat collection album partition behind the card wall: seats are
 * claimed by starRank (newest-first input → first catch wins), duplicate
 * copies and rank-less / out-of-range cards fall into the defensive
 * overflow row, and the seat count is derived from the roster — the single
 * source of truth — so no owned card ever disappears and X/108 counts
 * distinct seats.
 */
import { describe, expect, it } from 'vitest'
import { HEROES } from '../src/heroes-108.ts'
import {
  buildWallAlbum, isSeatedRank, RARITY_WEIGHT, SEAT_COUNT, SEAT_DISPLAY_ORDER, wallGrid,
} from '../src/client/wall.ts'
import type { CardRecord } from '../src/client/depth.ts'

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: 'aaaa1111', name: '暮光小灯', species: '灯笼鱼', rarity: 'COMMON',
    story: '她点亮额顶小灯。', depth: 0.42, zone: 'twilight',
    createdAt: 1_786_991_217_191, model: 'MiniMax-M3',
    art: '', holo: '', mask: '',
    ...overrides,
  }
}

describe('wall album', () => {
  it('sizes the wall from the roster (single source of truth)', () => {
    expect(HEROES.length).toBe(108)
    expect(SEAT_COUNT).toBe(HEROES.length)
  })

  it('an empty album is 108 locked seats, 0 obtained, no overflow', () => {
    const album = buildWallAlbum([])
    expect(album.seats.length).toBe(108)
    expect(album.seats.every((s) => s === undefined)).toBe(true)
    expect(album.obtained).toBe(0)
    expect(album.unseated).toEqual([])
  })

  it('claims seats by starRank and counts distinct seats (the X in X/108)', () => {
    const album = buildWallAlbum([
      card({ id: 'last', starRank: 108, star: '地狗星' }),
      card({ id: 'first', starRank: 1, star: '天魁星' }),
      card({ id: 'mid', starRank: 54 }),
    ])
    expect(album.seats[0]?.card.id).toBe('first')
    expect(album.seats[53]?.card.id).toBe('mid')
    expect(album.seats[107]?.card.id).toBe('last')
    expect(album.obtained).toBe(3)
    expect(album.unseated).toEqual([])
    expect(album.copies).toBe(3)
  })

  it('duplicate copies FOLD INTO their seat as a count — wall stays ≤108 cards', () => {
    const album = buildWallAlbum([
      card({ id: 'newest', starRank: 7, createdAt: 300 }),
      card({ id: 'middle', starRank: 7, createdAt: 200 }),
      card({ id: 'oldest', starRank: 7, createdAt: 100 }),
      card({ id: 'solo', starRank: 8, createdAt: 50 }),
    ])
    // First seen (newest, host order) represents the seat; copies counted.
    expect(album.seats[6]?.card.id).toBe('newest')
    expect(album.seats[6]?.count).toBe(3)
    expect(album.seats[7]?.card.id).toBe('solo')
    expect(album.seats[7]?.count).toBe(1)
    expect(album.obtained).toBe(2)
    expect(album.copies).toBe(4)
    expect(album.unseated).toEqual([]) // duplicates never overflow now
  })

  it('copies conservation: sum(counts) + unseated === input length', () => {
    const input = [
      card({ id: 'a', starRank: 1 }),
      card({ id: 'b', starRank: 1 }),
      card({ id: 'c', starRank: 1 }),
      card({ id: 'd', starRank: 55 }),
      card({ id: 'e', starRank: 55 }),
      card({ id: 'x' }), // no rank → unseated
      card({ id: 'y', starRank: 0 }), // invalid → unseated
    ]
    const album = buildWallAlbum(input)
    const seated = album.seats.reduce((sum, s) => sum + (s?.count ?? 0), 0)
    expect(seated + album.unseated.length).toBe(input.length)
    expect(album.obtained).toBe(2)
    expect(album.copies).toBe(5)
  })

  it('keeps rank-less / out-of-range cards visible in the overflow row', () => {
    const album = buildWallAlbum([
      card({ id: 'absent' }),
      card({ id: 'zero', starRank: 0 }),
      card({ id: 'over', starRank: 109 }),
      card({ id: 'negative', starRank: -3 }),
      card({ id: 'fraction', starRank: 1.5 }),
    ])
    expect(album.obtained).toBe(0)
    expect(album.unseated.map((c) => c.id)).toEqual(['absent', 'zero', 'over', 'negative', 'fraction'])
  })

  it('isSeatedRank accepts only integers within 1..SEAT_COUNT', () => {
    for (const ok of [1, 54, 108]) expect(isSeatedRank(ok)).toBe(true)
    for (const bad of [undefined, 0, -1, 109, 1.5, Number.NaN]) expect(isSeatedRank(bad)).toBe(false)
  })

  it('display order sorts by rarity ascending — rarest seats at the bottom', () => {
    // Every seat appears exactly once.
    expect(SEAT_DISPLAY_ORDER.length).toBe(108)
    expect(new Set(SEAT_DISPLAY_ORDER).size).toBe(108)
    // Rarity weight is non-decreasing down the wall (COMMON top → LEGENDARY bottom).
    const weights = SEAT_DISPLAY_ORDER.map((rank) => RARITY_WEIGHT[HEROES[rank - 1]!.rarity])
    for (let i = 1; i < weights.length; i++) {
      expect(weights[i]!).toBeGreaterThanOrEqual(weights[i - 1]!)
    }
    // First displayed seat is a COMMON hero, last is a LEGENDARY hero.
    expect(HEROES[SEAT_DISPLAY_ORDER[0]! - 1]!.rarity).toBe('COMMON')
    expect(HEROES[SEAT_DISPLAY_ORDER[107]! - 1]!.rarity).toBe('LEGENDARY')
  })

  it('display order keeps rank ascending within a rarity tier', () => {
    const byTier = new Map<string, number[]>()
    for (const rank of SEAT_DISPLAY_ORDER) {
      const rarity = HEROES[rank - 1]!.rarity
      const tier = byTier.get(rarity) ?? []
      tier.push(rank)
      byTier.set(rarity, tier)
    }
    for (const tier of byTier.values()) {
      expect(tier).toEqual([...tier].sort((a, b) => a - b))
    }
  })

  it('unseated overflow renders rarity-sorted (COMMON first, LEGENDARY last)', () => {
    // The overflow row sorts by RARITY_WEIGHT ascending then newest first —
    // same least-rare-on-top convention as the seat grid above it.
    const overflow = [
      card({ id: 'b', rarity: 'LEGENDARY', createdAt: 200 }),
      card({ id: 'c', rarity: 'COMMON', createdAt: 100 }),
      card({ id: 'a', rarity: 'EPIC', createdAt: 300 }),
    ]
    const sorted = [...overflow].sort((x, y) =>
      RARITY_WEIGHT[x.rarity] - RARITY_WEIGHT[y.rarity] || y.createdAt - x.createdAt)
    expect(sorted.map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })
})

/** Adaptive wallGrid sizing: a wide panel fans out into 6-8 columns of
 * wider cards, a narrow one collapses to the 2-column floor, and the
 * card width clamps to its readable range regardless of the raw math. */
describe('wallGrid (adaptive column layout)', () => {
  it('wide desktop layout: many columns + cards near the cap', () => {
    // 1600px container with the (130 + 10) budget → many columns, card
    // width saturates at the 170px ceiling.
    const g = wallGrid(1600)
    expect(g.cols).toBeGreaterThanOrEqual(6)
    expect(g.cols).toBeLessThanOrEqual(8)
    expect(g.cardW).toBeLessThanOrEqual(170)
  })

  it('narrow window: collapses to the 2-column floor', () => {
    // 280px container → fewer than 2 columns would be unreadable; the
    // floor caps it at 2.
    const g = wallGrid(280)
    expect(g.cols).toBe(2)
  })

  it('cardW respects the 170px ceiling even when the math says bigger', () => {
    // Far wider than 170×8+gap: card width must NOT exceed the readable max.
    const g = wallGrid(4000)
    expect(g.cardW).toBeLessThanOrEqual(170)
  })

  it('containerW <= 0 returns a safe default (mount race / hidden host)', () => {
    expect(wallGrid(0)).toEqual({ cols: 4, cardW: 118 })
    expect(wallGrid(-10)).toEqual({ cols: 4, cardW: 118 })
  })

  it('typical 480px container: 3 columns, ~150px cards', () => {
    const g = wallGrid(480)
    expect(g.cols).toBeGreaterThanOrEqual(3)
    expect(g.cols).toBeLessThanOrEqual(4)
    expect(g.cardW).toBeGreaterThanOrEqual(96)
    expect(g.cardW).toBeLessThanOrEqual(170)
  })
})
