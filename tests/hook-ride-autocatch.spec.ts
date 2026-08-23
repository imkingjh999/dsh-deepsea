/**
 * Idle auto-catch: the hands-free drip when the claw is unsteered.
 * enableAutoCatch() arms a timer that snaps the claw on its own (with a
 * wider search envelope than the manual grab); a failed connect roll
 * plays the same in-place whiff clap a manual miss gets, and an attempt
 * while the line is still sinking stays silent (v50: the lockUntil gate
 * is gone — the unsettled-hook check is the only silent short-circuit
 * left). Auto-catch stays off until enabled and never fires while the
 * claw is steered.
 *
 * Split from tests/hook-ride.spec.ts; shared fixtures live in
 * tests/helpers/hook-ride-utils.ts.
 */
import { describe, expect, it } from 'vitest'
import { OceanEngine } from '../src/client/engine.ts'
import { parkCreatureAtHook, run, runPastCooldown } from './helpers/hook-ride-utils.ts'

describe('idle auto-catch (hands-free drip when the claw is unsteered)', () => {
  /** Force the engine's auto-catch timer to fire almost-immediately so the
   * test doesn't have to wait the natural 40s warmup. */
  function armAutoCatch(e: OceanEngine): void {
    e.enableAutoCatch()
    ;(e as unknown as { nextAutoAt: number }).nextAutoAt = e.t + 0.5
  }

  it('idle auto-catch: an unsteered claw snaps on its own', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e) // a creature is sitting on the hook
    // parkCreatureAtHook() leaves manual steering alive (it refreshes
    // pointerTo every frame). The auto-catch block requires manual ===
    // null — the user-visible "unsteered" condition. Simulate the same
    // manual-handoff step() does when MANUAL_HOLD lapses: re-seed the
    // patrol at the last manual position (so the claw doesn't drift
    // off the parked creature), then drop the manual state.
    const m = (e as unknown as { manual: { x: number, y: number } }).manual
    ;(e as unknown as { roam: { seed: (x: number, y: number) => void } }).roam.seed(m.x, m.y)
    ;(e as unknown as { manual: null, manualTarget: null }).manual = null
    ;(e as unknown as { manual: null, manualTarget: null }).manualTarget = null
    // The auto target must stay inside the wet envelope each frame —
    // creatures drift ~46px/s horizontally and oscillate a few px
    // vertically, which would push the target out of the small wet
    // ellipse (rx≈28). Pin it to the hook every frame.
    const target = e.creatures.find((c) => c.zone === 0)
    if (target === undefined) { expect.fail('no zone-0 creature'); return }
    for (const c of e.creatures) if (c !== target) { c.x = -6000; c.y = -6000 }
    // Capture the auto flag on onCatchStart — fires at raised time.
    let autoSeen: boolean | null = null
    e.onCatchStart = (_depth: number, _zoneIdx: number, auto: boolean) => { autoSeen = auto }
    armAutoCatch(e)
    // Pin the connect roll to 1 (always connects) — the 80% dice is a
    // FIELD precisely so this test is deterministic. With rate=1 the
    // first armed attempt must latch the pinned creature.
    ;(e as unknown as { autoConnectRate: number }).autoConnectRate = 1
    // Step past nextAutoAt (0.5s) frame-by-frame while pinning the
    // target to the hook. Once the auto block fires the creature gets
    // latched (state → reeling) and the reel loop pulls it along.
    let hooked = false
    for (let i = 0; i < 60; i += 1) {
      if (e.state !== 'reeling') {
        const hp = e.hookPos()
        target.x = hp.x
        target.y = hp.y
      }
      e.step(1 / 60)
      if (e.state === 'reeling' && !hooked) { hooked = true; break }
    }
    expect(e.state).toBe('reeling')
    // ~3s reel to raised; onCatchStart fires here.
    run(e, 3)
    expect(e.state).toBe('raised')
    expect(autoSeen).toBe(true)
  })

  it('auto-catch stays off without enableAutoCatch and never fires while steered', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    // First half: arm the timer but DON'T enable auto-catch — even though
    // nextAutoAt arrives, the autoCatch flag is false so the block bails.
    ;(e as unknown as { nextAutoAt: number }).nextAutoAt = e.t + 0.5
    run(e, 1)
    expect(e.state).toBe('idle')

    // Second half: enable auto-catch + arm timer, BUT keep manual control
    // alive every frame — the auto block requires manual === null to fire.
    e.enableAutoCatch()
    ;(e as unknown as { nextAutoAt: number }).nextAutoAt = e.t + 0.5
    for (let i = 0; i < 60; i += 1) {
      e.pointerTo(200, 140)
      e.step(1 / 60)
    }
    expect(e.state).toBe('idle')
  })

  it('auto wide sweep grabs a fish beyond the manual ellipse', () => {
    // The hands-free drip is meant to actually connect — the standard
    // ellipse (rx≈28/ry≈26 for size=10) misses too often from random
    // patrol spots (user: "auto-catch never connects"). v35 widens the
    // search to 2.2× the wet envelope; this test plants the fish just
    // OUTSIDE the manual envelope and asserts autoWideGrab() latches it.
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // Pin the claw at a known point so the manual judgment center is
    // deterministic. (The wide sweep ALSO judges at this point — both
    // paths use hookPos()'s visual center.)
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    // parkCreatureAtHook leaves manual steering live (refreshing
    // pointerTo every frame). The auto path requires manual === null;
    // mirror the v34 manual-handoff step() does when MANUAL_HOLD lapses:
    // re-seed the patrol at the last manual position and drop manual.
    const m = (e as unknown as { manual: { x: number, y: number } }).manual
    ;(e as unknown as { roam: { seed: (x: number, y: number) => void } }).roam.seed(m.x, m.y)
    ;(e as unknown as { manual: null, manualTarget: null }).manual = null
    ;(e as unknown as { manual: null, manualTarget: null }).manualTarget = null
    const target = e.creatures.find((c) => c.zone === 0)
    if (target === undefined) { expect.fail('no zone-0 creature'); return }
    target.size = 10
    // dx=40 → WET rx=28 misses ((40/28)²≈2.04>1); WIDE rx=28·2.2=61.6
    // catches ((40/61.6)²≈0.42<1). dy=0 keeps the vertical axis safe.
    target.x = 200 + 40; target.y = 140 + 11
    for (const c of e.creatures) if (c !== target) { c.x = -6000; c.y = -6000 }
    // Cast the private method to confirm the sweep alone latches — the
    // 80% connect roll is non-deterministic, so the sweep is the only
    // piece we can pin down in a unit test.
    const swept = (e as unknown as { autoWideGrab: () => boolean }).autoWideGrab()
    expect(swept).toBe(true)
    expect(e.state).toBe('reeling')
    expect(e.caught).toBe(target)
    expect(e.clawShut).toBe(1)
  })

  it('a failed connect roll plays the whiff feedback (rate=0) and a sinking line stays silent', () => {
    // autoConnectRate is a FIELD — pin it to 0 so the connect roll ALWAYS
    // fails: the attempt must play the SAME empty-clap feedback a manual
    // miss gets (closeAt armed, state stays idle). v36 removed the
    // sideways glide — both manual and auto misses now clap in place.
    // The dice is deterministic here, no mocking needed.
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e) // a creature IS in reach — rate=0 must still miss
    const m = (e as unknown as { manual: { x: number, y: number } }).manual
    ;(e as unknown as { roam: { seed: (x: number, y: number) => void } }).roam.seed(m.x, m.y)
    ;(e as unknown as { manual: null }).manual = null
    ;(e as unknown as { manualTarget: null }).manualTarget = null
    e.enableAutoCatch()
    ;(e as unknown as { nextAutoAt: number }).nextAutoAt = e.t + 0.5
    ;(e as unknown as { autoConnectRate: number }).autoConnectRate = 0
    run(e, 0.7) // 0.5s arm + 0.2s — inside the clap hold window
    const peek = e as unknown as { closeAt: number, clawShut: number }
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
    // The whiff clap animation FIRED: closeAt is armed and clawShut is
    // animating toward 1 (run stayed inside hold+snap, so closeAt hasn't
    // been reset by the reopen-completion branch yet). v36: no glide
    // accompanies this — the clap is in place.
    expect(peek.closeAt).toBeGreaterThan(0)
    expect(peek.clawShut).toBeGreaterThan(0)

    // Sinking-line branch (v50 replacement for the old locked-claw case):
    // while the line is still easing to a new target depth the attempt
    // stays SILENT — no clap animation at all (the claw isn't where it
    // will fish yet, so a clap would read as a phantom miss). The old
    // lockUntil gate is gone; this physical check is the only silent
    // short-circuit left.
    const e2 = new OceanEngine()
    e2.resize(400, 600, 1)
    e2.enableAutoCatch()
    ;(e2 as unknown as { nextAutoAt: number }).nextAutoAt = e2.t + 0.5
    e2.setDepth(0.93) // hookTargetY jumps ~2100px → line is sinking
    const peek2 = e2 as unknown as { closeAt: number, reopenAt: number, clawShut: number }
    run(e2, 1) // the 0.5s attempt fires mid-sink (diff still ≈ 420px)
    expect(e2.state).toBe('idle')
    expect(peek2.closeAt).toBe(0)
    expect(peek2.clawShut).toBe(0)
    expect(e2.caught).toBeNull()
  })
})
