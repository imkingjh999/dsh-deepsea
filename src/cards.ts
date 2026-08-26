/**
 * Card store: one directory per card under the data root
 * (`~/.dsh/deepsea/cards/<id>/` holding card.json + art.png + holo.png +
 * mask.png) plus an index.json for cheap listing. The host half owns all
 * writes; the client only reads through /deepsea/api and /deepsea/assets.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Rarity } from './client/depth.ts'

export interface StoredCard {
  id: string
  name: string
  species: string
  rarity: Rarity
  story: string
  depth: number
  zone: string
  createdAt: number
  model: string
  art: string
  holo: string
  mask: string
  /** v2 pool cards: cloud pool identity (card id like DS-0007-a3f9c2e1). */
  mintId?: string
  /** Pool sequence number of this card. */
  blockHeight?: number
  /** 108-star assignment; decided server-side (Worker), never in the client. */
  star?: string
  /** Star seat 1-108; 0 when unknown. */
  starRank?: number
  /** Gold foil roll from the Worker draw (hash over the mint id). */
  gold?: boolean
}

export class CardStore {
  private readonly root: string

  constructor(dataDir?: string) {
    this.root = join(dataDir && dataDir !== '' ? dataDir : join(homedir(), '.dsh', 'deepsea'))
    this.cardsRoot = join(this.root, 'cards')
  }

  private readonly cardsRoot: string

  async ensure(): Promise<void> {
    await mkdir(this.cardsRoot, { recursive: true })
  }

  cardDir(id: string): string { return join(this.cardsRoot, id) }

  /** Mint a new card directory; returns the writer for the four files. */
  async newCard(): Promise<{ id: string, dir: string }> {
    await this.ensure()
    const id = randomUUID().slice(0, 8)
    const dir = this.cardDir(id)
    await mkdir(dir, { recursive: true })
    return { id, dir }
  }

  async write(card: StoredCard): Promise<void> {
    const dir = this.cardDir(card.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'card.json'), JSON.stringify(card, null, 2), 'utf8')
  }

  /** All cards, newest first; skips directories without a complete card.json. */
  async list(): Promise<StoredCard[]> {
    if (!existsSync(this.cardsRoot)) return []
    const out: StoredCard[] = []
    for (const entry of await readdir(this.cardsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await readFile(join(this.cardsRoot, entry.name, 'card.json'), 'utf8')
        const card = JSON.parse(raw) as StoredCard
        if (card.id === entry.name && card.art !== undefined) out.push(card)
      } catch { /* incomplete card — skip */ }
    }
    out.sort((a, b) => b.createdAt - a.createdAt)
    return out
  }
}

/** Map a stored card to the wire shape (asset paths → host URLs). */
/**
 * Client-facing card: absolute http(s) asset URLs (pool cards mirrored with
 * the Worker origin) pass through untouched; empty fields get the local
 * asset route. Generated-on-demand cards keep local paths either way.
 */
export function toWire(card: StoredCard): StoredCard {
  const local = (layer: 'art' | 'holo' | 'mask'): string => {
    const v = card[layer]
    if (v !== undefined && v !== '' && v.startsWith('http')) return v
    return `/deepsea/assets/${card.id}/${layer}.png`
  }
  return { ...card, art: local('art'), holo: local('holo'), mask: local('mask') }
}
