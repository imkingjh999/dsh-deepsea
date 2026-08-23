import { afterAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CardStore, toWire, type StoredCard } from '../src/cards.ts'

const root = await mkdtemp(join(tmpdir(), 'deepsea-cards-'))
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

function sample(overrides: Partial<StoredCard> = {}): StoredCard {
  return {
    id: 'aaaa1111', name: '暮光小灯', species: '灯笼鱼', rarity: 'COMMON',
    story: '她点亮额顶小灯。', depth: 0.42, zone: 'twilight',
    createdAt: 1_786_991_217_191, model: 'MiniMax-M3',
    art: '', holo: '', mask: '',
    ...overrides,
  }
}

describe('CardStore', () => {
  it('newCard creates an on-disk directory with a short id', async () => {
    const store = new CardStore(root)
    const { id, dir } = await store.newCard()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
    expect(dir.startsWith(root)).toBe(true)
  })

  it('write + list round-trips newest-first and skips foreign dirs', async () => {
    const store = new CardStore(root)
    const older = sample({ id: 'old00001', createdAt: 100 })
    const newer = sample({ id: 'new00002', createdAt: 200, name: '星鳞' })
    await store.write(older)
    await store.write(newer)
    // foreign directory without card.json → skipped
    await store.newCard()
    const all = await store.list()
    expect(all.length).toBe(2)
    expect(all[0]!.id).toBe('new00002')
    expect(all[1]!.id).toBe('old00001')
  })

  it('list on a missing root returns an empty array', async () => {
    const store = new CardStore(join(root, 'does-not-exist'))
    expect(await store.list()).toEqual([])
  })
})

describe('toWire', () => {
  it('maps storage-empty asset fields to host asset URLs', () => {
    const wire = toWire(sample())
    expect(wire.art).toBe('/deepsea/assets/aaaa1111/art.png')
    expect(wire.holo).toBe('/deepsea/assets/aaaa1111/holo.png')
    expect(wire.mask).toBe('/deepsea/assets/aaaa1111/mask.png')
  })
})
