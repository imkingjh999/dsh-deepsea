/**
 * Manual claw-grab mechanics. After the claw rewrite the catch is
 * MANUAL: bite() (== closeClaw()) only grabs a creature inside the
 * claw radius; idle step() never auto-catches (manual-mode contract).
 * Tests that previously relied on "bite picks the closest of the hook
 * zone" now place a specific creature directly on the hook first.
 *
 * v50 GUARANTEED CONTACT (user: 爪子和鱼重叠+左键 ⇒ 一定碰到): the local
 * catch locks (session-start 75s, post-catch 75s, post-miss 8–20s) and
 * the dry/wet pity envelope are GONE. Overlap + click always grabs;
 * pacing authority is the server's win-only 5-minute gate. These specs
 * pin the deterministic contract: immediate grabs at t=0, instant
 * re-grabs after an escape, and a CONSTANT visual-contact envelope (no
 * dry-spell widening, no cross-lane overreach).
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

  it('v50 guaranteed contact: a click at t=0 grabs immediately — no session-start lock', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // NO runPastCooldown — the very first click of a fresh session must
    // contact. The old 75s session-start lock used to clap empty here,
    // which from the player's seat read as "clicked right on the fish,
    // didn't grab" (the user complaint that motivated v50).
    const c = e.creatures.find((cc) => cc.zone === 0)
    expect(c).toBeDefined()
    if (c === undefined) return
    const hp = e.hookPos()
    c.x = hp.x; c.y = hp.y + 11 // dead on the claw's judgment center
    for (const o of e.creatures) if (o !== c) { o.x = -6000; o.y = -6000 }
    expect(e.t).toBe(0)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
    expect(e.caught).toBe(c)
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
    c0.size = 10 // deterministic semi-axes: rx=28 / ry=26
    // v28 visual-contact contract: the claw tip (splay ±11) just touching
    // the fish's far edge (visual half-width 1.6·size = 16) → dx = 27,
    // dy = 0. dn = (27/28)² ≈ 0.93 < 1 → MUST grab. (The old circular
    // radius 16+0.75·size = 23.5 < 27 missed exactly this — the reported
    // "claw touches fish but no grab" bug.)
    c0.x = 200 + 27; c0.y = 140 + 11
    for (const c of e.creatures) if (c !== c0) { c.x = -6000; c.y = -6000 }
    expect(e.closeClaw()).toBe(true)
    expect(e.caught).toBe(c0)

    const e2 = new OceanEngine()
    e2.resize(400, 600, 1)
    runPastCooldown(e2)
    for (let i = 0; i < 240; i += 1) { e2.pointerTo(200, 140); e2.step(1 / 60) }
    const c1 = e2.creatures[0]
    if (c1 === undefined) { expect.fail('no creature'); return }
    c1.size = 10
    // Outside the envelope: dx = 34 > rx=28 → dn = (34/28)² ≈ 1.47 > 1.
    c1.x = 200 + 34; c1.y = 140 + 11
    for (const c of e2.creatures) if (c !== c1) { c.x = -6000; c.y = -6000 }
    expect(e2.closeClaw()).toBe(false) // outside the ellipse — no grab
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
    c.size = 10 // ry = 14 + 12 = 26
    const hp = e.hookPos()
    // Dead-on horizontally, 40px below the judgment center (hp.y+11):
    // dn = (40/26)² ≈ 2.37 > 1. The ellipse is tightened vertically on
    // purpose — a fish in the adjacent depth lane is never cross-grabbed
    // even though the horizontal splay would cover its x. v50 keeps this
    // guard: guaranteed contact means OVERLAP guarantees a grab, not that
    // everything nearby gets vacuumed up.
    c.x = hp.x; c.y = hp.y + 11 + 40
    for (const o of e.creatures) if (o !== c) { o.x = -6000; o.y = -6000 }
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
    runPastCooldown(e) // settle the hook + patrol (deterministic parking)
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

  it('a click while the line is still sinking claps empty (the only remaining gate)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    parkCreaturesFar(e)
    for (let i = 0; i < 240; i += 1) { e.pointerTo(200, 140); e.step(1 / 60) }
    // Slam the hook's target depth far away (occupancy 0 → 0.93 world) so
    // the hook is momentarily UNSETTLED — the one physical gate v50 keeps.
    e.setDepth(0.93)
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('idle')
    // The clap still fires so the click reads, and manual steering is
    // preserved (the gate never drops it).
    expect((e as unknown as { manual: unknown }).manual).not.toBeNull()
    const peek = e as unknown as { closeAt: number, clawShut: number }
    run(e, 0.2)
    expect(peek.closeAt).toBeGreaterThan(0)
    expect(peek.clawShut).toBeGreaterThan(0)
    // …and once the line settles the very next click grabs again — the
    // gate is transient physics (≈1s), never a wait the player feels.
    run(e, 4) // line eases to the new depth (rate 1.6/s → converged)
    const c = e.creatures[0]
    if (c === undefined) { expect.fail('no creature'); return }
    c.size = 10
    const hp = e.hookPos()
    c.x = hp.x; c.y = hp.y + 11
    for (const o of e.creatures) if (o !== c) { o.x = -6000; o.y = -6000 }
    // Refresh the pointer dead-on (viewport = world − camY) so closeClaw()'s
    // aim-snap judges exactly at the parked fish.
    e.pointerTo(hp.x, hp.y + 11 - e.camY)
    expect(e.closeClaw()).toBe(true)
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

describe('v50 guaranteed contact — no local locks, constant envelope', () => {
  it('an escaped fish can be re-grabbed IMMEDIATELY — the post-miss lock is gone', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    // First grab → reel → raised (same shape as the React flow).
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
    run(e, 3) // ~3s → raised
    expect(e.state).toBe('raised')
    // The attempt ESCAPED (no card minted): resume() resets the catch
    // state. Under the old contract markMiss() then armed an 8–20s
    // re-grab lock; v50 removes it — the server's miss rule (a miss never
    // consumes the 5-min wait) IS the pacing, so the next overlap+click
    // must grab right away, zero seconds later.
    e.resume()
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
  })

  it('a grab right after a WIN also lands immediately — the post-catch lock is gone', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    run(e, 3) // raised
    e.resume()
    // Server answered "won" ⇒ the React layer would hold nextAllowedRef
    // for 5 minutes (too-soon banner), but the ENGINE no longer locks:
    // the player can still physically grab fish; the server decides what
    // the grab yields.
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    expect(e.state).toBe('reeling')
  })

  it('the envelope is CONSTANT — no dry-spell widening after 250s without a catch', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    // Run past the OLD dry-spell boundary (zone-0 window was 210s). v50
    // removed the pity widening: the same visual-contact ellipse applies
    // forever, so a fish inside the old DRY ellipse but outside the
    // contact ellipse must MISS no matter how long the dry spell runs.
    run(e, 250)
    expect(e.t).toBeGreaterThan(210)
    const c = e.creatures.find((cc) => cc.zone === 0)
    if (c === undefined) { expect.fail('no zone-0 creature'); return }
    c.size = 10
    const hp = e.hookPos()
    // dx = 32, dy = 7 → dn = (32/28)²+(7/26)² ≈ 1.38 > 1 (outside).
    // (Under the old DRY branch rx=38/ry=36 this grabbed ≈0.75 < 1.)
    c.x = hp.x + 32; c.y = hp.y + 18
    for (const x of e.creatures) if (x !== c) { x.x = -6000; x.y = -6000 }
    expect(e.closeClaw()).toBe(false) // no luck window — same ellipse
    expect(e.caught).toBeNull()
    // And the contact ellipse itself still grabs dead-center after the
    // same 250s dry spell — determinism both ways.
    const c2 = e.creatures.find((cc) => cc.zone === 0)
    if (c2 === undefined) { expect.fail('no zone-0 creature'); return }
    c2.size = 10
    const hp2 = e.hookPos()
    c2.x = hp2.x; c2.y = hp2.y + 11
    for (const x of e.creatures) if (x !== c2) { x.x = -6000; x.y = -6000 }
    expect(e.closeClaw()).toBe(true)
  })

  it('a hard-attachment row (caught fish) survives a missed outcome until resume()', () => {
    // After a hard-attachment (raised) the engine is in "reeling/raised"
    // until resume(). The consumer (React) drives resume(); until then the
    // caught fish keeps riding the hook and closeClaw is gated by state.
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    runPastCooldown(e)
    parkCreatureAtHook(e)
    expect(e.closeClaw()).toBe(true)
    run(e, 3) // raised
    expect(e.state).toBe('raised')
    expect(e.caught).not.toBeNull()
    // Mid-flow a click must NOT start a second grab — the busy state
    // (reeling/raised) is the guard now that the time locks are gone.
    parkCreatureAtHook(e) // (park is a no-op on the caught rider — it finds another zone-0 fish)
    expect(e.closeClaw()).toBe(false)
    expect(e.state).toBe('raised')
    e.resume()
    expect(e.state).toBe('idle')
    expect(e.caught).toBeNull()
  })
})
