/**
 * Pond stocking model — the pure, deterministic school/world math behind
 * the FishPond component, extracted from pond.tsx (v46 slim-down) with no
 * behavior change. pond.tsx re-exports every symbol below, so existing
 * './pond.tsx' importers (ocean.tsx + the pond spec files) keep resolving
 * unchanged.
 */
import type { Creature } from './engine.ts'
import { cardKindOf } from './fauna.ts'
import { ZONES, type CardRecord } from './depth.ts'

function fnv(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Target creatures per visible screen — the pond's school density. Matches
 * the v41 sample-cap of 14, so going from a 14-fish pond to a 108-card
 * wall-sized pond doesn't visually crush the same school into one screen. */
export const POND_PER_SCREEN = 14

/** One creature per card — deterministic per name, boosted by rarity.
 * Width/height are WORLD dimensions: the school spreads across the full
 * pond world (not just the viewport). */
export function pondStock(cards: ReadonlyArray<CardRecord>, w: number, h: number): Creature[] {
  const band = h > 0 ? h : 400
  const width = w > 0 ? w : 400
  return cards.map((card) => {
    const zone = Math.max(ZONES.findIndex((z) => z.id === card.zone), 0)
    const kind = cardKindOf(card.name, zone, card.species)
    const h1 = fnv(card.name)
    const h2 = fnv(card.name + '~size')
    const sizeBoost = card.rarity === 'LEGENDARY' ? 16 : card.rarity === 'EPIC' ? 9 : card.rarity === 'RARE' ? 4 : 0
    const hue = (zone === 0 ? 28 : zone === 1 ? 190 : zone === 2 ? 205 : 268)
      + (h1 % 40) - 20
      + (card.rarity === 'LEGENDARY' ? -18 : card.rarity === 'EPIC' ? -8 : 0)
    return {
      zone, kind,
      spriteKey: card.id,
      x: (h1 % 1000) / 1000 * width,
      y: band * (0.12 + ((h2 % 1000) / 1000) * 0.76),
      vx: (0.18 + ((h1 >> 8) % 100) / 100 * 0.4) * (h1 % 2 === 0 ? 1 : -1),
      size: (kind === 'turtle' ? 26 : 12 + ((h2 >> 4) % 100) / 100 * 10) + sizeBoost,
      hue,
      phase: (h1 >> 16) % 628 / 100,
    }
  })
}

/** Pick the multi-screen pond-world geometry for `count` fish given the
 * current viewport (w, h). The target is `POND_PER_SCREEN` fish per visible
 * screen, so the diver sees roughly the same density regardless of how
 * many cards they own. Returns a square-ish grid that grows the world in
 * both axes — panning in either direction reveals fresh ground. */
export function pondWorldFor(count: number, w: number, h: number):
  { worldW: number, worldH: number, cols: number, rows: number } {
  const cols0 = Math.max(1, Math.ceil(w > 0 ? w : 1))
  const rows0 = Math.max(1, Math.ceil(h > 0 ? h : 1))
  const screens = Math.max(1, Math.ceil(count / POND_PER_SCREEN))
  const cols = Math.max(1, Math.ceil(Math.sqrt(screens)))
  const rows = Math.max(1, Math.ceil(screens / cols))
  return {
    worldW: cols0 * cols,
    worldH: rows0 * rows,
    cols,
    rows,
  }
}

/** Resolve the pond roster for `cards` (1:1 — every card is a fish,
 * duplicates included). Exposed for the pond-world integration tests
 * (3 same-name copies + 2 distinct cards → 5 fish). A thin documented
 * seam rather than inlining `cards` so the 1:1 contract has one named
 * home. */
export function pondRosterOf(cards: ReadonlyArray<CardRecord>): CardRecord[] {
  return cards.slice()
}
