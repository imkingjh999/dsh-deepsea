/**
 * Pure depth-zone vocabulary shared by the ocean renderer, the HUD, and the
 * tests. No React, no DOM — importable anywhere.
 *
 * The ocean is a vertical column: the session's context occupancy (0..1,
 * from the `contextPressure` projection) maps linearly onto depth, and every
 * depth belongs to exactly one of four marine life zones. Deeper zones host
 * progressively stranger (deep-sea) fauna, which is the core metaphor: the
 * longer the conversation, the deeper the hook rides and the weirder the
 * catch.
 */

export interface Zone {
  /** Stable id used in card records and telemetry. */
  id: 'sunlit' | 'twilight' | 'midnight' | 'abyss'
  /** Chinese display name. */
  zh: string
  /** English display name. */
  en: string
  /** Occupancy range [lo, hi) — the last zone closes at 1. */
  lo: number
  hi: number
  /** Water color at the zone's top edge (CSS rgb triplet string). */
  waterTop: string
  /** Water color at the zone's bottom edge. */
  waterBottom: string
  /** Ambient light multiplier for creatures (1 = full sun). */
  light: number
}

export const ZONES: readonly Zone[] = [
  {
    id: 'sunlit', zh: '透光带', en: 'Sunlit', lo: 0, hi: 0.35,
    waterTop: 'rgb(64,181,212)', waterBottom: 'rgb(38,132,172)', light: 1,
  },
  {
    id: 'twilight', zh: '暮光带', en: 'Twilight', lo: 0.35, hi: 0.6,
    waterTop: 'rgb(34,110,152)', waterBottom: 'rgb(20,70,112)', light: 0.55,
  },
  {
    id: 'midnight', zh: '午夜带', en: 'Midnight', lo: 0.6, hi: 0.85,
    waterTop: 'rgb(14,46,84)', waterBottom: 'rgb(8,26,54)', light: 0.22,
  },
  {
    id: 'abyss', zh: '深渊带', en: 'Abyss', lo: 0.85, hi: 1,
    waterTop: 'rgb(6,14,34)', waterBottom: 'rgb(2,5,16)', light: 0.06,
  },
]

/** Zone index for an occupancy value (clamped). */
export function zoneIndexOf(occupancy: number): number {
  const t = Math.min(Math.max(Number.isFinite(occupancy) ? occupancy : 0, 0), 0.999_999)
  for (let i = ZONES.length - 1; i >= 0; i--) {
    if (t >= (ZONES[i] as Zone).lo) return i
  }
  return 0
}

export function zoneOf(occupancy: number): Zone {
  return ZONES[zoneIndexOf(occupancy)] as Zone
}

/**
 * Rarity ladder, Hearthstone-style four tiers. Weights live host-side; the
 * client only renders. Colors follow the classic gem palette: white / blue /
 * purple / orange.
 */
export type Rarity = 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'

export const RARITIES: readonly Rarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

export const RARITY_META: Record<Rarity, { zh: string; en: string; color: string; glow: string }> = {
  COMMON: { zh: '普通', en: 'Common', color: '#b6bfca', glow: 'rgba(182,191,202,.45)' },
  RARE: { zh: '稀有', en: 'Rare', color: '#3d9eff', glow: 'rgba(61,158,255,.55)' },
  EPIC: { zh: '史诗', en: 'Epic', color: '#a335ee', glow: 'rgba(163,53,238,.6)' },
  LEGENDARY: { zh: '传说', en: 'Legendary', color: '#ff8000', glow: 'rgba(255,128,0,.7)' },
}

/**
 * Crash-proof rarity lookup: never returns undefined. Any unrecognized
 * rarity (e.g. legacy five-tier data written by a pre-v4 host that has not
 * reloaded yet) falls back to the COMMON style instead of throwing inside
 * render and unmounting the whole shell.
 */
export function rarityMeta(rarity: string): { zh: string; en: string; color: string; glow: string } {
  return RARITY_META[rarity as Rarity] ?? RARITY_META.COMMON
}

/** Card record as produced by the host pipeline and served to the client. */
export interface CardRecord {
  id: string
  name: string
  species: string
  rarity: Rarity
  story: string
  /** Occupancy (0..1) at catch time. */
  depth: number
  zone: Zone['id']
  createdAt: number
  /** Model that authored the lore. */
  model: string
  /** Asset URLs (host-served, already prefixed). */
  art: string
  holo: string
  mask: string
  /** v2 pool cards: blockchain identity (mint block id like DS-0007-a3f9c2e1). */
  mintId?: string
  /** Ledger height of the mint block — the card's "block #". */
  blockHeight?: number
  /** 108-star name — assigned server-side (Worker/D1), the client has no table. */
  star?: string
  /** Star seat 1-108; 0/absent when unknown (offline on-demand cards). */
  starRank?: number
  /** Gold foil roll, decided server-side (Worker hash over the mint id). */
  gold?: boolean
}

/** Occupancy from the contextPressure projection snapshot (absent-safe). */
export function occupancyOf(pressure: { projectedTokens?: number, pressureTokens?: number, contextWindow?: number } |
   undefined | null): number | null {
  if (pressure == null) return null
  const used = pressure.projectedTokens ?? pressure.pressureTokens
  const win = pressure.contextWindow
  if (used == null || win == null || win <= 0) return null
  return Math.min(Math.max(used / win, 0), 1)
}
