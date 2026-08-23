/**
 * Manual claw-grab mechanics. After the claw rewrite the catch is
 * MANUAL: bite() (== closeClaw()) only grabs a creature inside the
 * claw radius; idle step() never auto-catches (manual-mode contract).
 * Tests that previously relied on "bite picks the closest of the hook
 * zone" now place a specific creature directly on the hook first.
 * Also covers the win/miss gate separation (engine.markMiss /
 * markCatch): the short re-grab lock and the dry/wet envelope branches.
 *
 * Split from tests/hook-ride.spec.ts; shared fixtures live in
 * tests/helpers/hook-ride-utils.ts.
 */
import { describe, expect, it } from 'vitest'
import { OceanEngine } from '../src/client/engine.ts'
import {
  parkCreatureAtHook,
  parkCreaturesFar,
  run,
  runPastCooldown,
} from './helpers/hook-ride-utils.ts'

describe('claw grab — closeClaw behavior', () => {
  it('a creature inside the claw radius is caught (true + reeling + clawShut=1)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    const target = e.creatures.find((c) => c.zone === 0)
    expect(target).toBeDefined()
    if (target === undefined) return
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
    expect(e.caught).toBe(target)
    expect(e.clawShut).toBe(1)
  })

  it('an empty clap returns to idle after the hold window and clawShut resets to 0', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreaturesFar(e)
    expect(e.closeClaw()).toBe(false)
    // Step past CLAW_HOLD + CLAW_SNAP so the open ↔ close cycle completes.
    run(e, 1)
    expect(e.state).toBe('idle')
    expect(e.clawShut).toBe(0)
  })

  it('closeClaw() during the cooldown is a no-op (no reeling, claw still animates)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // No runPastCooldown — staying inside the 75s window.
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
    // No reeling — but the claw should still animate so the click reads.
    run(e, 1)
    expect(e.state).toBe('idle')
  })

  it('a fish whose edge just touches the prong tip is grabbed (v28 visual-contact ellipse)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // Park the claw at a FIXED known point: a constant pointerTo target
    // means closeClaw()'s aim-snap judges at EXACTLY (200, 140+0) — center
    // (200, 151). (parkCreatureAtHook's ±1.5px convergence tolerance would
    // shift the judgment center and eat the 1px margin between dx=27 and
    // rx=28 — that flaked this test run-to-run.)
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    const c0 = e.creatures[0]
    if (c0 === undefined) { expect.fail('no creature'); return }
    c0.size = 10 // deterministic semi-axes: wet rx=28 / ry=26
    // v28 visual-contact contract: the claw tip (splay ±11) just touching
    // the fish's far edge (visual half-width 1.6·size = 16) → dx = 27,
    // dy = 0. WET ellipse dn = (27/28)² ≈ 0.93 < 1 → MUST grab. (The old
    // circular radius 16+0.75·size = 23.5 < 27 missed exactly this — the
    // reported "claw touches fish but no grab" bug.)
    c0.x = 200 + 27; c0.y = 140 + 11
    for (const c of e.creatures) if (c !== c0) { c.x = -6000; c.y = -6000 }
    ;(e as unknown as { lockUntil: number, lastCatchAt: number }).lockUntil = 0
    ;(e as unknown as { lockUntil: number, lastCatchAt: number }).lastCatchAt = e.t - 100
    expect(e.closeClaw()).toBe(true)
    expect(e.caught).toBe(c0)

    const e2 = new OceanEngine()
    e2.resize(400, 600, 1)
    runPastCooldown(e2)
    for (let i = 0; i < 240; i += 1) { e2.pointerTo(200, 140); e2.step(1 / 60) }
    const c1 = e2.creatures[0]
    if (c1 === undefined) { expect.fail('no creature'); return }
    c1.size = 10
    // Outside the WET envelope: dx = 34 > rx=28 → dn = (34/28)² ≈ 1.47 > 1.
    c1.x = 200 + 34; c1.y = 140 + 11
    for (const c of e2.creatures) if (c !== c1) { c.x = -6000; c.y = -6000 }
    ;(e2 as unknown as { lockUntil: number, lastCatchAt: number }).lockUntil = 0
    ;(e2 as unknown as { lockUntil: number, lastCatchAt: number }).lastCatchAt = e2.t - 100
    expect(e2.closeClaw()).toBe(false) // outside the wet ellipse — no grab
  })

  it('a fish far below the claw center is not cross-grabbed (vertical overreach guard)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // Park the claw at a known mid-band point (deterministic, manual hold
    // refreshed every frame so steering stays live through the click).
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    const c = e.creatures[0]
    if (c === undefined) { expect.fail('no creature'); return }
    c.size = 10 // wet ry = 14 + 12 = 26
    const hp = e.hookPos()
    // Dead-on horizontally, 40px below the judgment center (hp.y+11):
    // dn = (40/26)² ≈ 2.37 > 1. The ellipse is tightened vertically on
    // purpose — a fish in the adjacent depth lane is never cross-grabbed
    // even though the horizontal splay would cover its x.
    c.x = hp.x; c.y = hp.y + 11 + 40
    for (const o of e.creatures) if (o !== c) { o.x = -6000; o.y = -6000 }
    ;(e as unknown as { lockUntil: number, lastCatchAt: number }).lockUntil = 0
    ;(e as unknown as { lockUntil: number, lastCatchAt: number }).lastCatchAt = e.t - 100
    expect(e.closeClaw()).toBe(false)
    expect(e.caught).toBeNull()
  })

  it('aim-snap: a fast flick-and-click grabs at the POINTER, not the lagging claw', () => {
    const e = new OceanEngine()
    e.resize(430, 680, 1)
    runPastCooldown(e)
    // One fish far from wherever the claw currently patrols.
    const fish = e.creatures.find((c) => c.zone === 0)
    expect(fish).toBeDefined()
    if (fish === undefined) return
    // Park the claw at a KNOWN far corner first (deterministic lag ≥ 250px).
    for (let i = 0; i < 240; i += 1) { e.pointerTo(40, 60); e.step(1 / 60) }
    const parked = e.hookPos()
    // NOW place the fish (it swims ~27px/s — over the 4s parking it would
    // drift away, so placement must come after parking) and clear rivals.
    fish.x = 380; fish.y = 300; fish.size = 14
    for (const c of e.creatures) if (c !== fish) { c.x = -6000; c.y = -6000 }
    ;(e as unknown as { lockUntil: number }).lockUntil = 0
    expect(Math.hypot(parked.x - fish.x, parked.y - fish.y)).toBeGreaterThan(250)
    // Flick the pointer onto the fish and click almost immediately — the
    // eased claw (time constant ~0.3s) is still hundreds of px behind.
    e.pointerTo(380, 300)
    for (let i = 0; i < 9; i += 1) e.step(1 / 60) // 0.15s — fish drifts ≤5px
    e.pointerTo(380, 300) // refresh manual hold (the click)
    const lag = e.hookPos()
    expect(Math.hypot(lag.x - fish.x, lag.y - fish.y)).toBeGreaterThan(50) // really lagging
    expect(e.closeClaw()).toBe(true) // judged at the AIM point regardless
    expect(e.caught).toBe(fish)
    // The claw snapped onto the pointer target.
    const hp = e.hookPos()
    expect(Math.hypot(hp.x - fish.x, hp.y - fish.y)).toBeLessThan(30)
  })

  it('a whiffed grab claps in place (glide removed)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e) // t ≈ 76s, lockUntil=75 → t > lockUntil ✓ hookSettled ✓
    parkCreaturesFar(e)
    // Pin the claw at a known point and refresh manual hold every frame so
    // the click sees a live manual target (matches v28/v29 park pattern).
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    // No-fish empty clap → in v36 the claw snaps shut, holds, reopens —
    // IN PLACE (the sideways whiffGlide was removed).
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('idle')
    // Manual steering still alive (v36: whiff no longer drops manual) so
    // the claw stays anchored at the pointer target while the clap cycles.
    expect((e as unknown as { manual: unknown }).manual).not.toBeNull()
    // The clap animation fired: closeAt is armed. After 0.2s of running
    // (well past the start) the clawShut ramp is visibly non-zero.
    const peek = e as unknown as { closeAt: number, clawShut: number }
    run(e, 0.2)
    expect(peek.closeAt).toBeGreaterThan(0)
    expect(peek.clawShut).toBeGreaterThan(0)
    // Position lock: the claw stays anchored to the pointer target — no
    // glide means the only motion is the idle sway/patrol micro-jitter.
    // 0.5s after the click the claw is still at the parked spot (|Δ| < 25px,
    // accounting for sway ±0.03·w ≈ ±12px and the slow patrol ease).
    const p0 = e.hookPos()
    run(e, 0.5)
    const p2 = e.hookPos()
    expect(Math.hypot(p2.x - p0.x, p2.y - p0.y)).toBeLessThan(25)
  })

  it('a cooldown-gated click claps in place (glide removed)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Deliberately do NOT runPastCooldown — lockUntil=75 blocks closeClaw
    // at the gate branch before any ellipse search runs.
    parkCreaturesFar(e)
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('idle')
    // Manual steering preserved (v36: the gate branch no longer drops manual).
    expect((e as unknown as { manual: unknown }).manual).not.toBeNull()
    // Clap animation fires on the gate branch too — closeAt is armed and
    // clawShut ramps non-zero after 0.2s of stepping.
    const peek = e as unknown as { closeAt: number, clawShut: number }
    run(e, 0.2)
    expect(peek.closeAt).toBeGreaterThan(0)
    expect(peek.clawShut).toBeGreaterThan(0)
    // No glide: 0.5s after the gated click the claw is still parked at the
    // pointer target (only sway/patrol micro-jitter — well under 25px).
    const p0 = e.hookPos()
    run(e, 0.5)
    const p2 = e.hookPos()
    expect(Math.hypot(p2.x - p0.x, p2.y - p0.y)).toBeLessThan(25)
  })
})

describe('no idle auto-catch (manual-mode contract)', () => {
  it('a creature parked on the hook is NOT caught by step() — the player must click', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    parkCreatureAtHook(e)
    // 300 frames × 1/60s = 5s, well past the cooldown.
    for (let i = 0; i < 300; i += 1) e.step(1 / 60)
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
  })
})

describe('claw grab — win/miss gate separation (engine.markMiss / markCatch)', () => {
  /** Drive the engine while bypassing the auto-catch: stay in idle until
   * the test explicitly calls bite()/closeClaw(). Mirrors the gating the
   * React layer uses (busyRef + nextAllowedRef) at a smaller scale. */
  function reopen(e: OceanEngine): void {
    ;(e as unknown as { lockUntil: number }).lockUntil = 0
  }

  it('markMiss() arms a short random re-grab lock (8–20s) — no instant re-grab spam', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // First grab: park, bite, reel → raised (same shape as the React flow).
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
    run(e, 3) // ~3s → raised
    expect(e.state).toBe('raised')
    // Card-flow contract: the FIRST attempt won a card → markCatch() arms
    // the short local lock (lockUntil = t + 75). Mirror the ocean.tsx call
    // order, then let the finally-clause resume() reset the catch state.
    e.markCatch()
    e.resume() // mirrors the finally clause in ocean.tsx onCatchStart
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
    // The very next attempt ESCAPED (no card minted): markMiss() must arm
    // a SHORT random re-grab lock so a wriggled fish can't be re-grabbed
    // instantly — the user-flagged "escape→re-grab→escape" spam loop.
    parkCreatureAtHook(e)
    const armed = e.t < e.t + 75 // (documentation: gate IS armed by markCatch)
    expect(armed).toBe(true)
    e.markMiss()
    // Immediately after markMiss the gate is hot (8–20s → 0 at t+0): next
    // closeClaw is blocked even with a creature inside the ellipse.
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('idle')
    // 21s is past the LONGEST possible 20s lock, so the gate releases.
    // autoCatch defaults to false so step() never fires an unintended grab;
    // hookSettled holds because hookY has long since converged on hookTargetY.
    run(e, 21)
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
  })

  it('markCatch() advances the dry-spell window — envelope shrinks from dry rx=38/ry=36 to wet rx=28/ry=26', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Run past the dry-spell boundary (zone-0 lw = 210s). No catch fires.
    run(e, 250)
    expect(e.t).toBeGreaterThan(210)
    // Place a size-10 creature inside the DRY ellipse but outside the WET
    // one: dx = 32, dy = 7 → dry dn = (32/38)²+(7/36)² ≈ 0.75 < 1 (grab);
    // wet dn = (32/28)²+(7/26)² ≈ 1.38 > 1 (miss). The asymmetry between
    // the two branches is what markCatch() resets.
    const c = e.creatures.find((cc) => cc.zone === 0)
    if (c === undefined) { expect.fail('no zone-0 creature'); return }
    c.size = 10
    const hp = e.hookPos()
    c.x = hp.x + 32; c.y = hp.y + 18
    for (const x of e.creatures) if (x !== c) { x.x = -6000; x.y = -6000 }
    // Pre-markCatch: t - lastCatchAt = 250 > 210 → DRY branch (rx=38/ry=36).
    reopen(e)
    expect(e.closeClaw()).toBe(true) // inside dry ellipse — caught
    expect(e.caught).toBe(c)
  })

  it('markCatch() commits the pity clock — same scenario now misses under the wet envelope', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Pin lastCatchAt = t (pity clock freshly reset) WITHOUT engaging the
    // 75s local lock — the test is about the ENVELOPE branch, not the gate.
    run(e, 250)
    reopen(e)
    e.markCatch() // lastCatchAt = e.t; lockUntil = e.t + 75
    reopen(e) // override the local lock the test doesn't care about
    const c = e.creatures.find((cc) => cc.zone === 0)
    if (c === undefined) { expect.fail('no zone-0 creature'); return }
    c.size = 10
    const hp = e.hookPos()
    // Same geometry as the dry-branch test — now WET (rx=28/ry=26).
    c.x = hp.x + 32; c.y = hp.y + 18
    for (const x of e.creatures) if (x !== c) { x.x = -6000; x.y = -6000 }
    // Post-markCatch: t - lastCatchAt = 0 < 210 → WET branch.
    expect(e.closeClaw()).toBe(false) // wet dn ≈ 1.38 > 1 — same fish misses
    expect(e.caught).toBeNull()
  })

  it('a hard-attachment row (caught fish) does not bend the 75s gate when missed', () => {
    // After a hard-attachment (raised) the engine is in "reeling/raised"
    // until resume(). A markMiss() should drop lockUntil to 0 but leave
    // caught/state alone — the consumer (React) drives resume().
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    run(e, 3) // raised
    expect(e.state).toBe('raised')
    expect(e.caught).not.toBeNull()
    e.markMiss()
    // markMiss only clears lockUntil; the fish still rides the hook until
    // resume() runs. Verify gate reopened and caught is preserved.
    reopen(e) // sanity: gate is < t
    expect((e as unknown as { lockUntil: number }).lockUntil).toBe(0)
    expect(e.caught).not.toBeNull()
    e.resume()
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
  })
})
