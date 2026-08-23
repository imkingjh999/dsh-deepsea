/**
 * oceans.ts — the five great oceans the session can wash into.
 *
 * Each session rolls ONE ocean (memoized module state) shared by the main
 * ocean scene and the fish pond, so the world stays coherent. Every ocean
 * brings its own flavor on top of the shared depth-zone system:
 *   - kinds: characteristic fauna pool per depth zone (reuse the 9 minted
 *     sprite kinds — no new assets, just per-ocean mixes);
 *   - hues: base hue per zone (tints creatures and sprites);
 *   - tint: additive RGB shift on the water gradient (palette.ts);
 *   - decor: seabed decoration census (seaweed/coral/...) rendered on the
 *     ocean world floor and the pond floor (decor.ts).
 *
 * Pure data + one tiny memo — no React, no DOM, no canvas.
 */
import type { Creature } from './engine.ts'

export type OceanId = 'pacific' | 'atlantic' | 'indian' | 'arctic' | 'southern'

/** Seabed decoration vocabulary (drawn by decor.ts). v44 adds 'starfish' —
 * a five-armed procedural critter the POND decor census borrows so the
 * fish-school world gets a few warm-colored ground critters on the sand.
 * No ocean profile's decor census includes starfish (the OCEANS array
 * is untouched), so the seabed look is preserved across every ocean. */
export type DecorKind = 'seaweed' | 'kelp' | 'coral' | 'rock' | 'anemone' | 'ice' | 'tubeWorm' | 'starfish'

export interface OceanProfile {
  id: OceanId
  /** Fauna kind pool per depth zone (0 sunlit … 3 abyss), non-empty. */
  kinds: ReadonlyArray<readonly Creature['kind'][]>
  /** Base creature hue per zone (drives procedural + sprite tint). */
  hues: readonly number[]
  /** Additive water tint (RGB, small values, clamped when applied). */
  tint: { r: number, g: number, b: number }
  /** Seabed decor census — how many of each kind root on the floor. */
  decor: Readonly<Partial<Record<DecorKind, number>>>
}

/** Default kind pools (the pre-ocean era tables) — also the fallback. */
const DEFAULT_KINDS: ReadonlyArray<readonly Creature['kind'][]> = [
  ['fish', 'fish', 'fish', 'turtle', 'hatchet', 'jelly'],
  ['hatchet', 'hatchet', 'jelly', 'fish', 'turtle', 'viper'],
  ['viper', 'squid', 'squid', 'jelly', 'hatchet', 'angler', 'eel'],
  ['angler', 'eel', 'octopus', 'angler', 'squid', 'viper'],
]

/** Default per-zone hues (mirrors the historical ZONE_HUE). */
export const DEFAULT_HUES: readonly number[] = [28, 190, 205, 268]

export const OCEANS: readonly OceanProfile[] = [
  {
    // 太平洋 — the richest reef water: turtles, tuna schools, jellies.
    id: 'pacific',
    kinds: [
      ['fish', 'fish', 'turtle', 'turtle', 'jelly', 'hatchet'],
      ['fish', 'jelly', 'turtle', 'hatchet', 'squid'],
      ['squid', 'jelly', 'hatchet', 'eel', 'fish'],
      ['octopus', 'squid', 'angler', 'eel'],
    ],
    hues: [24, 168, 195, 262],
    tint: { r: 2, g: 10, b: 6 },
    decor: { coral: 7, seaweed: 5, anemone: 4, rock: 3 },
  },
  {
    // 大西洋 — cold currents and herring/cod schools, kelp forests.
    id: 'atlantic',
    kinds: [
      ['fish', 'fish', 'fish', 'hatchet', 'turtle', 'jelly'],
      ['hatchet', 'fish', 'jelly', 'viper', 'eel'],
      ['viper', 'squid', 'eel', 'hatchet', 'jelly'],
      ['angler', 'eel', 'squid', 'octopus'],
    ],
    hues: [200, 210, 215, 262],
    tint: { r: -6, g: 2, b: 10 },
    decor: { kelp: 7, rock: 4, seaweed: 3 },
  },
  {
    // 印度洋 — warm, vividly colored reefs: turtles, chromis, anemonefish.
    id: 'indian',
    kinds: [
      ['fish', 'fish', 'turtle', 'jelly', 'hatchet', 'fish'],
      ['fish', 'turtle', 'jelly', 'hatchet'],
      ['squid', 'jelly', 'fish', 'angler'],
      ['angler', 'octopus', 'squid'],
    ],
    hues: [16, 150, 190, 258],
    tint: { r: 10, g: 6, b: -6 },
    decor: { coral: 8, anemone: 5, seaweed: 3, rock: 2 },
  },
  {
    // 北冰洋 — icy water: moon jellies, Arctic cod, cold deep squid.
    id: 'arctic',
    kinds: [
      ['fish', 'jelly', 'jelly', 'hatchet', 'turtle', 'fish'],
      ['jelly', 'hatchet', 'fish', 'squid'],
      ['squid', 'jelly', 'hatchet', 'angler'],
      ['angler', 'squid', 'octopus', 'eel'],
    ],
    hues: [190, 200, 212, 265],
    tint: { r: -8, g: 4, b: 14 },
    decor: { ice: 7, rock: 5, seaweed: 2 },
  },
  {
    // 南大洋 — circumpolar deep: giant squid, vampire twilight, tube worms.
    id: 'southern',
    kinds: [
      ['fish', 'hatchet', 'jelly', 'turtle'],
      ['hatchet', 'squid', 'jelly', 'viper'],
      ['squid', 'squid', 'viper', 'jelly', 'eel'],
      ['squid', 'angler', 'octopus', 'viper', 'eel'],
    ],
    hues: [172, 195, 220, 272],
    tint: { r: -4, g: 0, b: 8 },
    decor: { rock: 6, tubeWorm: 6, kelp: 3 },
  },
]

/** Crash-proof profile lookup; unknown ids fall back to Pacific. */
export function oceanById(id: string | undefined): OceanProfile {
  return OCEANS.find((o) => o.id === id) ?? OCEANS[0]!
}

/** Kind pool for a zone under a profile (never empty — falls back). */
export function kindsOf(profile: OceanProfile, zone: number): readonly Creature['kind'][] {
  const pool = profile.kinds[zone] ?? DEFAULT_KINDS[zone]
  return pool !== undefined && pool.length > 0 ? pool : ['fish']
}

/** Zone hue under a profile (falls back to the historical table). */
export function hueOf(profile: OceanProfile | null, zone: number): number {
  const h = profile?.hues[zone]
  return typeof h === 'number' ? h : (DEFAULT_HUES[zone] ?? 28)
}

/** The session's ocean — rolled once per module lifetime (per page load),
 * shared by the ocean scene AND the fish pond. Module state, not React. */
let sessionOcean: OceanProfile | null = null

export function rollSessionOcean(): OceanProfile {
  if (sessionOcean === null) {
    sessionOcean = OCEANS[Math.floor(Math.random() * OCEANS.length)] ?? OCEANS[0]!
  }
  return sessionOcean
}

/** Test hook: pin or clear the memoized session ocean. */
export function setSessionOcean(profile: OceanProfile | null): void {
  sessionOcean = profile
}
