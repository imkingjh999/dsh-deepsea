/**
 * Per-tick simulation (split from engine.ts): the pond branch (school +
 * ambient + bubbles + v46 auto-tour camera) and the ocean branch (hook
 * easing, camera tracking, patrol/manual steering, fauna physics,
 * hands-free auto-catch drip, claw pose animation, reel-up ride).
 * stepEngine writes the engine's internal state directly; the class's
 * step() is a thin shell.
 */
import { zoneIndexOf } from './depth.ts'
import type { OceanEngine } from './engine.ts'
import { stepPondCreature, pondCamBounds } from './engine-ambient.ts'
import { autoAttemptOn, CLAW_SNAP } from './engine-catch.ts'

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** One simulation tick. Mirrors the step() body verbatim. */
export function stepEngine(eng: OceanEngine, dt: number): void {
  eng.t += dt
  if (eng.pondMode) {
    // Pond: creatures + bubbles + ambient only — no hook, no depth, no
    // catches. When the React layer has stocked a larger-than-viewport
    // pond world, the school's wrap bounds are world-sized (so fish
    // can live in screens off-screen until the camera pans over them);
    // with no world set the bounds fall back to the viewport (legacy
    // 14-fish pond — every existing test that builds an engine and
    // calls stockPond([]) must stay green).
    const worldW = eng.pondWW > 0 ? eng.pondWW : eng.w
    const worldH = eng.pondWH > 0 ? eng.pondWH : eng.h
    const yLo = worldH * 0.08
    const yHi = worldH * 0.92
    for (const c of eng.creatures) stepPondCreature(c, dt, worldW, yLo, yHi)
    for (const c of eng.ambient) stepPondCreature(c, dt, worldW, yLo, yHi)
    for (const b of eng.bubbles) {
      b.y -= b.s * dt * 34; b.w += dt * 2
      b.x += Math.sin(b.w) * dt * 12
      if (b.y < -12) { b.y = worldH + 6; b.x = Math.random() * worldW }
    }
    // v46: pond auto-tour. Slow cruise to random waypoints when the
    // diver isn't actively dragging. v49: waypoints use pondCamBounds
    // (center-anchored zoom semantics — see engine-ambient), so the
    // cruise never parks the camera where a zoomed view shows void; the
    // cruise speed divides by the zoom so the drift reads the same on
    // screen at every zoom.
    if (eng.pondWander && eng.pondWW > 0 && eng.pondWH > 0) {
      const { minX, maxX, minY, maxY } = pondCamBounds(eng)
      const spanX = Math.max(0, maxX - minX)
      const spanY = Math.max(0, maxY - minY)
      if (spanX > 0 || spanY > 0) {
        const dx = eng.wanderX - eng.camX
        const dy = eng.wanderY - eng.camY
        if (eng.t >= eng.wanderNextAt || (dx * dx + dy * dy < 24 * 24)) {
          // New random waypoint — uniform over the pannable area.
          eng.wanderX = spanX > 0 ? minX + Math.random() * spanX : minX
          eng.wanderY = spanY > 0 ? minY + Math.random() * spanY : minY
          eng.wanderNextAt = eng.t + 6 + Math.random() * 6
        } else {
          // Constant-rate cruise toward the waypoint (~32 screen px/s)
          // so the camera never outruns the easing. Clamped live: a
          // shrink-resize can leave a stale waypoint outside the new
          // bounds (targets re-clamp only on the next re-pick), and
          // the cruise itself must never push the camera past the
          // world edge into void.
          const d = Math.hypot(dx, dy)
          const stepPx = Math.min(32 * dt / eng.pondZoom, d)
          if (d > 0.001) {
            eng.camX = clamp(eng.camX + dx / d * stepPx, minX, maxX)
            eng.camY = clamp(eng.camY + dy / d * stepPx, minY, maxY)
          }
        }
      }
    }
    return
  }
  eng.hookY += (eng.hookTargetY - eng.hookY) * Math.min(dt * 1.6, 1)
  // Camera tracks the hook (hook sits ~38% from the viewport top); clamped to the water column.
  eng.camTargetY = clamp(eng.hookTargetY - eng.h * 0.38, 0, eng.worldH - eng.h)
  eng.camY += (eng.camTargetY - eng.camY) * Math.min(dt * 1.1, 1)

  // -- hook physics (all states, so the caught fish rides too) --
  eng.roam.step(dt, { w: eng.w, h: eng.h, camY: eng.camY })
  // Manual steering: ease toward the pointer target, clamped to the
  // visible band (the camera logic is untouched — the hook simply never
  // leaves the viewport). After MANUAL_HOLD seconds without a move the
  // patrol resumes from wherever the hook ended up.
  if (eng.manual !== null && eng.manualTarget !== null) {
    if (eng.t <= eng.manualUntil) {
      const m = eng.manual
      const ease = Math.min(dt * 3.4, 1)
      m.x += (eng.manualTarget.x - m.x) * ease
      m.y += (eng.manualTarget.y - m.y) * ease
      m.x = clamp(m.x, eng.w * 0.03, eng.w * 0.97)
      m.y = clamp(m.y, eng.camY + eng.h * 0.05, eng.camY + eng.h * 0.95)
    } else {
      eng.roam.seed(eng.manual.x, eng.manual.y)
      eng.manual = null
      eng.manualTarget = null
    }
  }
  for (const c of eng.creatures) {
    if (c === eng.caught) continue
    c.phase += dt * (1 + Math.abs(c.vx) * 2)
    if (Math.random() < 0.004) c.vx = (Math.random() * 0.4 + 0.18) * (Math.random() < 0.5 ? -1 : 1)
    c.x += c.vx * dt * 46
    const [ylo, yhi] = eng.zoneBand(c.zone)
    const ny = c.y + Math.sin(c.phase) * dt * 9
    c.y = Math.min(Math.max(ny, ylo), yhi)
    if (c.x < -50) c.x = eng.w + 40
    if (c.x > eng.w + 50) c.x = -40
  }
  for (const b of eng.bubbles) {
    b.y -= b.s * dt * 34; b.w += dt * 2
    b.x += Math.sin(b.w) * dt * 12
    if (b.y < eng.camY - 12) { b.y = eng.camY + eng.h + 6; b.x = Math.random() * eng.w }
  }
  // Hands-free drip (v35): an unsteered, idle claw takes an 80% "connect"
  // roll and, on a hit, sweeps a 2.2× wet envelope for the nearest
  // creature — the standard ellipse missed too often from random patrol
  // spots. A failed connect OR an empty wide sweep plays the SAME
  // empty-clap a manual miss gets (v36 removed the sideways glide). On
  // a real grab the next attempt waits 50–110s; on an empty clap
  // retries sooner.
  if (eng.autoCatch && eng.state === 'idle' && eng.manual === null && eng.t >= eng.nextAutoAt) {
    const ok = autoAttemptOn(eng)
    eng.nextAutoAt = eng.t + (ok ? 50 + Math.random() * 60 : 20 + Math.random() * 20)
  }
  // Old collision auto-catch removed: catches are now MANUAL (the player
  // snaps the claw on click). The claw still needs to animate open /
  // closed / opened each frame — closeClaw() set closeAt/reopenAt, this
  // block just damps clawShut toward the target pose.
  if (eng.state === 'reeling' || eng.state === 'raised') {
    eng.clawShut = 1
  } else if (eng.closeAt > 0 && eng.t < eng.reopenAt) {
    // Closing phase — ease toward 1 over CLAW_SNAP seconds.
    const target = Math.min((eng.t - eng.closeAt) / CLAW_SNAP, 1)
    eng.clawShut = Math.max(eng.clawShut, target)
  } else if (eng.closeAt > 0 && eng.t >= eng.reopenAt) {
    // Reopen phase — ease back to 0 over the same CLAW_SNAP window so
    // the open ↔ closed cycle takes the same wall-clock time both ways.
    const since = eng.t - eng.reopenAt
    eng.clawShut = Math.max(1 - since / CLAW_SNAP, 0)
    if (eng.clawShut === 0) { eng.closeAt = 0; eng.reopenAt = 0 }
  } else if (eng.clawShut > 0) {
    // Defensive: cover any drift below 0 (e.g. rounding).
    eng.clawShut = Math.max(eng.clawShut - dt / CLAW_SNAP, 0)
  }

  if (eng.state === 'reeling' && eng.caught !== null) {
    const c = eng.caught
    const hp = eng.hookPos()
    // Strong convergence: the fish reaches the hook quickly and rides it
    // even while the user steers the hook mid-reel.
    c.x += (hp.x - c.x) * Math.min(dt * 6, 1)
    c.y += (hp.y - c.y) * Math.min(dt * 6, 1)
    eng.reelP = Math.min(eng.reelP + dt * 0.55, 1)
    if (eng.reelP >= 1) {
      eng.state = 'raised'
      // Surface whether this grab was started by the auto-catch timer so
      // the React layer can suppress the "too soon" banner for hands-free
      // attempts (one automatic bite per minute must not spam the UI).
      // Manual pointer-downs leave lastGrabAuto at its post-consume false.
      eng.onCatchStart?.(eng.occupancy, zoneIndexOf(eng.occupancy), eng.lastGrabAuto)
      eng.lastGrabAuto = false
    }
  } else if (eng.state === 'raised' && eng.caught !== null) {
    // Hard attachment: the caught fish sits exactly at the hook tip
    // (the drawn hook arc centers on hy+6) — it can never drift off,
    // however fast the hook sways or the pointer steers it.
    const c = eng.caught
    const hp = eng.hookPos()
    c.x = hp.x
    c.y = hp.y + 6
  }
}
