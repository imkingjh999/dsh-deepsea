/**
 * toWire must pass absolute (pool/Worker) asset URLs through untouched —
 * rewriting them to /deepsea/assets/<local-id>/ rendered pool cards as
 * black rectangles (no local files behind those paths).
 */
import { describe, expect, it } from 'vitest'
import { toWire, type StoredCard } from '../src/cards.ts'
import type { Rarity } from '../src/client/depth.ts'

const base: StoredCard = {
  id: 'ab12cd34', name: 'n', species: 's', rarity: 'COMMON' as Rarity, story: 't',
  depth: 0.1, zone: 'sunlit', createdAt: 1, model: 'm',
  art: '', holo: '', mask: '',
}

describe('toWire asset URLs', () => {
  it('fills local asset routes for locally generated cards', () => {
    const w = toWire(base)
    expect(w.art).toBe('/deepsea/assets/ab12cd34/art.png')
    expect(w.holo).toBe('/deepsea/assets/ab12cd34/holo.png')
    expect(w.mask).toBe('/deepsea/assets/ab12cd34/mask.png')
  })

  it('passes absolute Worker URLs through untouched', () => {
    const w = toWire({ ...base,
      art: 'https://deepsea.openclawd.qzz.io/assets/cards/DS-0002-fc067a1b/art.png',
      holo: 'https://deepsea.openclawd.qzz.io/assets/cards/DS-0002-fc067a1b/holo.png',
      mask: 'https://deepsea.openclawd.qzz.io/assets/cards/DS-0002-fc067a1b/mask.png' })
    expect(w.art).toBe('https://deepsea.openclawd.qzz.io/assets/cards/DS-0002-fc067a1b/art.png')
    expect(w.holo).toContain('DS-0002-fc067a1b/holo.png')
    expect(w.mask).toContain('DS-0002-fc067a1b/mask.png')
  })
})
