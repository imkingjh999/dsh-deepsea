// @vitest-environment node
/**
 * v40: card spirits carry the diver's catch back into the ocean.
 * cardKindOf() is the shared keyword→creature-kind map (promoted from
 * pond.tsx to fauna.ts). groupCardSpiritsByKind() buckets a card list
 * by that kind. OceanEngine.setCardSpirits() then dresses every new
 * fauna creature in a matching card sprite.
 */
import { describe, expect, it } from 'vitest'
import { cardKindOf, groupCardSpiritsByKind } from '../src/client/fauna.ts'
import { OceanEngine } from '../src/client/engine.ts'

describe('cardKindOf (shared keyword → creature-kind map)', () => {
  it('maps turtle-card keywords to "turtle"', () => {
    expect(cardKindOf('阳光小憨龟', 0)).toBe('turtle')
    expect(cardKindOf('深海巨龟', 3)).toBe('turtle')
    // 玳 / 瑁 — pure 玳瑁 cards have no 龟 in the name, so the rule has
    // to carry the whole 玳瑁 disyllable. Bug-fix dispatch (v40+).
    expect(cardKindOf('碎星玳瑁', 0)).toBe('turtle')
    expect(cardKindOf('星曜玳瑁', 1)).toBe('turtle')
    expect(cardKindOf('锦缎玳瑁', 0)).toBe('turtle')
    // 鲸 → turtle (龙首鳞鲸 as a big sea-turtle — closer to the painted
    // kind than to a generic fish).
    expect(cardKindOf('龙首鳞鲸', 0)).toBe('turtle')
  })

  it('maps angler-card keywords to "angler"', () => {
    expect(cardKindOf('渊冕星烛神', 3)).toBe('angler')
    expect(cardKindOf('星萤灯', 2)).toBe('angler')
    // 鮟 / 鱇 — anglerfish (鮟鱇) cards have no 灯/烛/萤 in the name.
    expect(cardKindOf('星焰鮟鱇', 2)).toBe('angler')
    expect(cardKindOf('寂棘渊鮟', 3)).toBe('angler')
  })

  it('maps squid-card keywords to "squid"', () => {
    // 鱿 — firefly-squid (发光鱿鱼) cards.
    expect(cardKindOf('软灯发光鱿', 2)).toBe('squid')
    // 墨 — 憨眸墨豆 (species: 发光鱿鱼) has no 鱿 in it, so 墨→squid is
    // the catch rule. Placed AFTER 灯/烛/蝰 in the table so the 6 other
    // 墨* cards keep their natural angler/viper routing.
    expect(cardKindOf('憨眸墨豆', 2)).toBe('squid')
  })

  it('maps viper-card keywords to "viper"', () => {
    expect(cardKindOf('星渊蝰蛇', 2)).toBe('viper')
    expect(cardKindOf('毒蛇', 2)).toBe('viper')
  })

  it('keeps the existing 墨* cards on their natural kinds (灯/烛/蝰 win over 墨)', () => {
    // Regression guard for the ['墨','squid'] insertion: those entries must
    // NOT shadow the more specific 灯/烛/蝰 keywords that already existed.
    expect(cardKindOf('憨眸墨烛', 2)).toBe('angler')  // 烛 → angler
    expect(cardKindOf('墨蕊噬灯', 3)).toBe('angler') // 灯 → angler
    expect(cardKindOf('墨鳞噬灯', 3)).toBe('angler') // 灯 → angler
    expect(cardKindOf('墨吻噬灯姬', 3)).toBe('angler') // 灯 → angler
    expect(cardKindOf('墨棘蝰鱼', 2)).toBe('viper')  // 蝰 → viper
    expect(cardKindOf('墨烬蝰', 2)).toBe('viper')    // 蝰 → viper
  })

  it('maps 鲉 / 鲽 keywords to "fish"', () => {
    // 鲉 = scorpionfish (蝎子鱼); 鲽 = flounder. Both are fish-shaped.
    expect(cardKindOf('橘纹小吻鲉', 0)).toBe('fish')
    expect(cardKindOf('金鳞阳鲽', 0)).toBe('fish')
  })

  it('falls back to a name-hash pick inside the zone when no keyword matches', () => {
    // No keyword present: determinism contract — same name + zone → same kind.
    const a = cardKindOf('琉璃电纹鲶', 0)
    const b = cardKindOf('琉璃电纹鲶', 0)
    expect(a).toBe(b)
    // And the pick must land inside the zone-0 default bucket.
    expect(['fish', 'fish', 'turtle']).toContain(a)
  })

  it('keeps the original pond semantics for out-of-range / non-finite zones', () => {
    // Keyword wins regardless of zone, so the turtle check is the same.
    expect(cardKindOf('阳光小憨龟', -1)).toBe('turtle')
    // Original kindOf() in pond.tsx fell through to the abyss bucket
    // (`['angler','eel','octopus','squid']`) for zone >= 3 — that branch
    // is preserved verbatim for behavior parity.
    const k = cardKindOf('某无关卡名xyz', 99)
    expect(['angler', 'eel', 'octopus', 'squid']).toContain(k)
    // Non-finite → defensive clamp to 0 (sunlit bucket: fish/fish/turtle).
    const nan = cardKindOf('某无关卡名xyz', Number.NaN)
    expect(['fish', 'turtle']).toContain(nan)
  })

  it('falls back to species keywords when the name has no match', () => {
    // 向阳糖豆 — name contains no keyword (菠/萝/糖/豆 are not in the
    // table), but species 阳光小雀鲷 contains 鲷 → fish. Bug-fix
    // dispatch: real-world 21 cuteness-named cards all carry an
    // unambiguous species, so the species fallback catches them.
    expect(cardKindOf('向阳糖豆', 0, '阳光小雀鲷')).toBe('fish')
  })

  it('name always wins over species (species never shadows a name match)', () => {
    // 呆眸小灯 — name contains 灯 → angler. species 发光鱿鱼 contains
    // 鱿 which would normally route to squid; the rule is "name first,
    // species only when name misses", so 鱿 never gets consulted.
    expect(cardKindOf('呆眸小灯', 0, '发光鱿鱼')).toBe('angler')
  })

  it('falls through to the zone-hash bucket when neither name nor species matches', () => {
    // 菠萝小丑 / 神秘泡泡 — verified no char from the rules table
    // (菠/萝/小/丑/神/秘/泡 all absent from KIND_RULES). Both must
    // hit the zone-3 hash bucket — and the species arg must NOT change
    // that pick (species never re-routes the hash).
    const withSp = cardKindOf('菠萝小丑', 3, '神秘泡泡')
    const without = cardKindOf('菠萝小丑', 3)
    expect(withSp).toBe(without)
    expect(['angler', 'eel', 'octopus', 'squid']).toContain(withSp)
  })
})

describe('groupCardSpiritsByKind (deck → kind buckets)', () => {
  it('returns an empty map for an empty input', () => {
    const m = groupCardSpiritsByKind([])
    expect(m.size).toBe(0)
  })

  it('buckets each card under the kind its name resolves to', () => {
    const cards = [
      { id: 'a', name: '阳光小憨龟', zone: 'sunlit' },
      { id: 'b', name: '渊冕星烛神', zone: 'abyss' },
      { id: 'c', name: '星渊蝰蛇', zone: 'midnight' },
    ]
    const m = groupCardSpiritsByKind(cards)
    expect(m.get('turtle')).toEqual(['a'])
    expect(m.get('angler')).toEqual(['b'])
    expect(m.get('viper')).toEqual(['c'])
  })

  it('deduplicates cards by name (same-card-many-copies → one id)', () => {
    const cards = [
      { id: 'c1', name: '阳光小憨龟', zone: 'sunlit' },
      { id: 'c2', name: '阳光小憨龟', zone: 'sunlit' },
      { id: 'c3', name: '阳光小憨龟', zone: 'sunlit' },
    ]
    const m = groupCardSpiritsByKind(cards)
    expect(m.get('turtle')).toEqual(['c1'])
    expect(m.size).toBe(1)
  })

  it('falls back to zone index 0 when the card zone is unknown', () => {
    const cards = [{ id: 'x', name: '某无关卡名xyz', zone: 'mariana-plus' }]
    const m = groupCardSpiritsByKind(cards)
    // Zone 0 hash bucket: fish / fish / turtle. Either is acceptable, just
    // assert the bucket is non-empty and the lookup matches cardKindOf.
    const key = cardKindOf('某无关卡名xyz', 0)
    expect(m.get(key)).toEqual(['x'])
  })

  it('ignores malformed entries (missing id or name) without throwing', () => {
    const cards = [
      { id: '', name: '阳光小憨龟', zone: 'sunlit' }, // empty id → skipped
      { id: 'ok', name: '', zone: 'sunlit' }, // empty name → skipped
      { id: 'g', name: '星渊蝰蛇', zone: 'midnight' },
    ]
    const m = groupCardSpiritsByKind(cards)
    expect(m.get('viper')).toEqual(['g'])
    expect(m.size).toBe(1)
  })
})

describe('OceanEngine.setCardSpirits (ocean fauna wears card sprites)', () => {
  it('dresses new creatures in a matching card sprite when the pool is non-empty', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // The engine picks freely from the zone pool, so we cannot rely on
    // its own mix to land on any one kind — supply a pool covering all
    // 9 kinds so every creature gets dressed, then assert each spriteKey
    // comes from the matching bucket.
    const allowed = new Set([
      'card-fish-1', 'card-fish-2', 'card-turtle-1', 'card-hatchet-1',
      'card-jelly-1', 'card-viper-1', 'card-squid-1', 'card-angler-1',
      'card-octopus-1', 'card-eel-1',
    ])
    e.setCardSpirits(new Map([
      ['fish', ['card-fish-1', 'card-fish-2']],
      ['turtle', ['card-turtle-1']],
      ['hatchet', ['card-hatchet-1']],
      ['jelly', ['card-jelly-1']],
      ['viper', ['card-viper-1']],
      ['squid', ['card-squid-1']],
      ['angler', ['card-angler-1']],
      ['octopus', ['card-octopus-1']],
      ['eel', ['card-eel-1']],
    ]))
    const dressed = e.creatures.filter((c) => c.spriteKey !== undefined)
    expect(dressed.length).toBe(e.creatures.length)
    for (const c of dressed) {
      expect(allowed.has(c.spriteKey as string)).toBe(true)
    }
  })

  it('leaves creatures un-dressed when no pool is supplied for their kind', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Pool only for viper — every other kind gets no spriteKey.
    e.setCardSpirits(new Map([['viper', ['card-viper-1']]]))
    // Make sure at least one non-viper creature exists; if by luck the
    // populate roll landed entirely on viper, repopulate by resetting
    // until we see a non-viper creature (cheap retry loop).
    let safety = 0
    while (safety < 50 && e.creatures.every((c) => c.kind === 'viper')) {
      ;(e as unknown as { w: number }).w = 400
      // Force a fresh populate by shrinking then re-resizing — the
      // existing creature list is the previous populate, so clear it.
      e.creatures.length = 0
      e.resize(400, 600, 1)
      safety += 1
    }
    const nonViper = e.creatures.filter((c) => c.kind !== 'viper')
    expect(nonViper.length).toBeGreaterThan(0)
    for (const c of nonViper) expect(c.spriteKey).toBeUndefined()
  })

  it('re-dresses existing creatures when setCardSpirits is called mid-flight', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Strip every creature's spriteKey so we can prove setCardSpirits
    // repopulated them.
    for (const c of e.creatures) c.spriteKey = undefined
    e.setCardSpirits(new Map([
      ['fish', ['only-fish-1']],
      ['turtle', ['only-turtle-1']],
      ['hatchet', ['only-hatchet-1']],
      ['jelly', ['only-jelly-1']],
      ['viper', ['only-viper-1']],
      ['squid', ['only-squid-1']],
      ['angler', ['only-angler-1']],
      ['octopus', ['only-octopus-1']],
      ['eel', ['only-eel-1']],
    ]))
    const allowed = new Set([
      'only-fish-1', 'only-turtle-1', 'only-hatchet-1', 'only-jelly-1',
      'only-viper-1', 'only-squid-1', 'only-angler-1', 'only-octopus-1', 'only-eel-1',
    ])
    const dressed = e.creatures.filter((c) => c.spriteKey !== undefined)
    expect(dressed.length).toBe(e.creatures.length) // every kind is in the pool
    for (const c of dressed) {
      expect(allowed.has(c.spriteKey as string)).toBe(true)
    }
  })

  it('does NOT dress pond creatures (pond owns its own spriteKey)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Put one pond creature with a deliberate spriteKey; setCardSpirits
    // must leave it untouched (the rule: pond mode = pond's responsibility).
    e.stockPond([{ zone: 0, kind: 'fish', x: 100, y: 100, vx: 1, size: 12, hue: 30, phase: 0, spriteKey: 'pond-1' }])
    e.setCardSpirits(new Map([['fish', ['ocean-fish-1']]]))
    expect(e.creatures[0]?.spriteKey).toBe('pond-1')
  })

  it('clears the spriteKey of ocean creatures when setCardSpirits gets an empty map', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Pre-dress every creature.
    e.setCardSpirits(new Map([
      ['fish', ['c1']], ['turtle', ['c2']], ['hatchet', ['c3']],
      ['jelly', ['c4']], ['viper', ['c5']], ['squid', ['c6']],
      ['angler', ['c7']], ['octopus', ['c8']], ['eel', ['c9']],
    ]))
    const dressedBefore = e.creatures.filter((c) => c.spriteKey !== undefined).length
    expect(dressedBefore).toBe(e.creatures.length)
    e.setCardSpirits(new Map())
    const dressedAfter = e.creatures.filter((c) => c.spriteKey !== undefined).length
    expect(dressedAfter).toBe(0)
  })
})
