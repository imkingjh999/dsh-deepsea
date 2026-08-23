/**
 * Shared fixtures for the hook-ride spec suite (split out of the
 * original tests/hook-ride.spec.ts): engine stepping, the cooldown
 * bypass, and the deterministic claw-parking helpers the catch-flow
 * tests rely on.
 */
import { expect } from 'vitest'
import type { OceanEngine } from '../../src/client/engine.ts'

/** Step the engine for `secs` at 60fps. */
export function run(e: OceanEngine, secs: number): void {
  for (let i = 0; i < Math.round(secs * 60); i += 1) e.step(1 / 60)
}

/** CATCH_COOLDOWN is 75s; step just past it so bite() is allowed. */
export function runPastCooldown(e: OceanEngine): void {
  run(e, 76)
}

/** Park a creature dead-center on the hook so bite() (== closeClaw())
 * snaps shut on it — the old "pick the nearest of the hook zone" branch
 * is gone, so tests must seed the geometry explicitly. Always picks a
 * zone-0 creature (the visible band), sweeps every other creature far
 * out of the claw radius, then eases the hook onto the target's CURRENT
 * position (re-targeting every frame while it swims) until the gap is
 * under CONVERGED_PX — so caughtFrac records the creature's true lane
 * with sub-pixel error and the ±5px lane assertion stays deterministic.
 * Returns the parked creature's ORIGINAL position. */
export function parkCreatureAtHook(e: OceanEngine): { x: number, y: number, zone: number } {
  const target = e.creatures.find((c) => c.zone === 0)
  expect(target).toBeDefined()
  if (target === undefined) return { x: 0, y: 0, zone: 0 }
  const original = { x: target.x, y: target.y, zone: target.zone }
  // Push every other creature WAY out of the claw radius so the search
  // resolves to the target we parked.
  for (const c of e.creatures) {
    if (c === target) continue
    c.x = -6000; c.y = -6000
  }
  // Ease the hook onto the (swimming) target, re-issuing pointerTo every
  // frame so the manual hold never lapses; stop once truly converged.
  const CONVERGED_PX = 1.5
  for (let i = 0; i < 1800; i += 1) {
    e.pointerTo(target.x, target.y)
    e.step(1 / 60)
    const hp = e.hookPos()
    if (Math.hypot(hp.x - target.x, hp.y - target.y) < CONVERGED_PX) break
  }
  // Snap the creature onto the converged hook (error < CONVERGED_PX).
  const hp = e.hookPos()
  target.x = hp.x
  target.y = hp.y
  return original
}

/** Drop every creature OUT of the claw radius — useful for "no grail in
 * range" assertions. Birds-eye: 6000px is well past the claw window. */
export function parkCreaturesFar(e: OceanEngine): void {
  for (const c of e.creatures) { c.x = -6000; c.y = -6000 }
}
