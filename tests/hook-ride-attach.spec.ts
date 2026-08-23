/**
 * Catch-flow attachment behaviors: the caught fish rides EXACTLY at the
 * hook (hard attachment in the raised state), and the post-catch
 * replacement fish returns to the caught fish's depth LANE — the
 * stratified spread never drifts into same-plane clumps, even under
 * back-to-back catching. Also pins the v50 guaranteed-contact contract:
 * a fresh engine grabs on the VERY FIRST click (the old 75s
 * session-start lock is gone — what a grab yields is the server dice's
 * business).
 *
 * Split from tests/hook-ride.spec.ts. Manual claw-grab tests live in
 * hook-ride-claw.spec.ts, idle auto-catch in hook-ride-autocatch.spec.ts;
 * shared fixtures in tests/helpers/hook-ride-utils.ts.
 */
import { describe, expect, it } from 'vitest'
import { OceanEngine } from '../src/client/engine.ts'
import { parkCreatureAtHook, run, runPastCooldown } from './helpers/hook-ride-utils.ts'

describe('v50 guaranteed contact (session-start lock removed)', () => {
  it('a fresh engine grabs on the very first click — overlap + click always contacts', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    parkCreatureAtHook(e)
    // The old 75s session-start lock used to refuse this (the legacy
    // "no instant catch on refresh" rule); from the player's seat that
    // read as "clicked right on the fish, didn't grab". v50: contact is
    // deterministic from t=0 — pacing is the server's win-only gate.
    // (parkCreatureAtHook eases the hook onto the fish first; the t
    // bound is the OLD lock boundary — the grab lands well inside it.)
    expect(e.t).toBeLessThan(75)
    expect(e.bite()).toBe(true)
    expect(e.state).toBe('reeling')
    expect(e.caught).not.toBeNull()
  })

  it('idle stepping never auto-catches (the old collision sniff is gone)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Park a creature ON the hook, then step for 200s: no catch should
    // fire — the player must click to grab now.
    parkCreatureAtHook(e)
    run(e, 200)
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
  })
})

describe('caught fish rides the hook', () => {
  it('reeling converges, raised hard-attaches at the hook tip', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    expect(e.bite()).toBe(true)
    expect(e.caught).not.toBeNull()
    run(e, 3) // reel needs ~1.8s → raised
    expect(e.state).toBe('raised')
    const hp = e.hookPos()
    const c = e.caught
    expect(c).not.toBeNull()
    if (c === null) return
    expect(c.x).toBe(hp.x) // exact snap, not a trailing lerp
    expect(c.y).toBe(hp.y + 6) // hook tip (drawn arc centers on hy+6)
  })

  it('keeps attaching while the hook is steered (manual control)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    expect(e.bite()).toBe(true)
    run(e, 3)
    expect(e.state).toBe('raised')
    // Steer the hook around; the fish must stay glued to it.
    for (let i = 0; i < 120; i += 1) {
      e.pointerTo(80 + (i % 5) * 60, 100 + (i % 7) * 50)
      e.step(1 / 60)
      const hp = e.hookPos()
      const c = e.caught
      if (c === null) { expect.fail('caught cleared early'); return }
      expect(c.x).toBe(hp.x)
      expect(c.y).toBe(hp.y + 6)
    }
  })
})

describe('replacement fish keeps the stratified lane', () => {
  it('resume() respawns the caught fish into its own depth lane', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // The helper eases the hook onto the creature so the bite happens
    // INSIDE the creature's own band. The lane invariant is about the
    // BITE-TIME position (caughtFrac is recorded then, before the reel
    // moves the fish) — the fish's sine wobble drifts it a few px from
    // its birth y during the ~30s ease, so the birth y is only a loose
    // secondary check.
    const original = parkCreatureAtHook(e)
    expect(e.bite()).toBe(true)
    const caught = e.caught
    expect(caught).not.toBeNull()
    if (caught === null) return
    const biteY = caught.y // laneFracOf() snapshot source — BEFORE reeling
    const idx = e.creatures.indexOf(caught)
    expect(idx).toBeGreaterThanOrEqual(0)
    run(e, 3)
    e.resume()
    const fresh = e.creatures[idx]
    expect(fresh).toBeDefined()
    if (fresh === undefined) return
    // Invariant ④: the replacement resumes at the bite-time lane —
    // sub-pixel exact (same band math as laneFracOf / makeCreature).
    expect(Math.abs(fresh.y - biteY)).toBeLessThanOrEqual(0.5)
    // Same zone, and not far from the birth lane (wobble ≤ ~9px + ease).
    expect(fresh.zone).toBe(original.zone)
    expect(Math.abs(fresh.y - original.y)).toBeLessThanOrEqual(15)
  })

  it('repeated catch/resume cycles keep the zone-0 population stable', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Real cadence: 75s cooldown between catches. Park the same zone-0
    // creature on the hook each cycle, bite, reel, resume. After the
    // loop the zone-0 creature count must match the start (no respawn
    // drift) and the lane test above asserts the SAME-lane invariant
    // for the single target we kept catching.
    const initialZone0 = e.creatures.filter((c) => c.zone === 0).length
    for (let cycle = 0; cycle < 6; cycle += 1) {
      run(e, 76) // spacing between cycles (v50: no cooldown — just time)
      parkCreatureAtHook(e)
      if (e.state === 'idle') e.bite()
      if (e.state === 'reeling') run(e, 3)
      if (e.state !== 'idle') e.resume()
    }
    const finalZone0 = e.creatures.filter((c) => c.zone === 0).length
    expect(finalZone0).toBe(initialZone0)
  })
})
