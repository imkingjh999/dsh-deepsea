/**
 * Fauna population (split from engine.ts): the stratified ocean
 * populate pass, the bubble field, and the depth retune shuffle.
 * `make` is the engine's makeCreature callback (kept engine-side
 * because it wears card spirits from the engine's private pool).
 */
import type { Creature } from './engine.ts'
import type { OceanEngine } from './engine.ts'

/** Total fauna in the whole water column (only the visible band draws). */
export const FAUNA_COUNT = 30

/** Rebuild the ocean fauna list: zone weights (sunlit teems, the abyss
 * is lonely) then stratified lanes so each zone's fish spread EVENLY
 * down its band with jitter (distinct depths, no one-plane clustering)
 * — and fish never swim vertically; each keeps its lane for life.
 * Mirrors the private populate() body verbatim. */
export function populateInto(eng: OceanEngine, make: (zone: number, yFrac?: number) => Creature): void {
  eng.creatures = []
  // Deeper bands are sparser — sunlit teems, the abyss is lonely.
  const weights = [0.40, 0.30, 0.20, 0.10]
  const lanes: number[][] = [[], [], [], []]
  for (let i = 0; i < FAUNA_COUNT; i++) {
    const r = Math.random()
    let zone = 0; let acc = 0
    for (let z = 0; z < weights.length; z++) {
      acc += weights[z] ?? 0
      if (r < acc) { zone = z; break }
    }
    ;(lanes[zone] ?? []).push(i)
  }
  for (let z = 0; z < lanes.length; z++) {
    const idxs = lanes[z] ?? []
    idxs.forEach((ci, k) => {
      const frac = (k + 0.25 + Math.random() * 0.5) / Math.max(idxs.length, 1)
      eng.creatures[ci] = make(z, Math.min(Math.max(frac, 0), 1))
    })
  }
}

/** Seed the ocean bubble field (12 rising, wobbling bubbles). */
export function populateBubblesInto(eng: OceanEngine): void {
  eng.bubbles = Array.from({ length: 12 }, () => ({
    x: Math.random() * eng.w, y: Math.random() * eng.h,
    r: 1 + Math.random() * 2.4, w: Math.random() * Math.PI * 2, s: 0.2 + Math.random() * 0.5,
  }))
}

/** Shift population toward the hook's zone (deeper context → deeper
 * fauna): up to two shallow-zone fish are replaced by fresh deep
 * spawns entering from off-screen. Mirrors retune() verbatim. */
export function retuneInto(eng: OceanEngine, make: (zone: number, yFrac?: number) => Creature, zoneIdx: number): void {
  let replaced = 0
  for (let i = 0; i < eng.creatures.length && replaced < 2; i++) {
    const c = eng.creatures[i]
    if (c !== undefined && c.zone < zoneIdx && Math.random() < 0.4) {
      const fresh = make(zoneIdx)
      fresh.x = Math.random() < 0.5 ? -40 : eng.w + 40
      eng.creatures[i] = fresh
      replaced++
    }
  }
}
