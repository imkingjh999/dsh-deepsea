/**
 * Catch mechanics (split from engine.ts): the claw snap (manual grab),
 * the hands-free auto-catch attempt + wide sweep, the collision bite,
 * and the lane-fraction helper. The engine keeps thin method shells so
 * the instance shape (tests cast-peek lockUntil / closeAt /
 * autoConnectRate / autoWideGrab) is unchanged; these functions write
 * the engine's internal claw/lock state directly.
 */
import { zoneIndexOf } from './depth.ts'
import type { Creature } from './engine.ts'
import type { OceanEngine } from './engine.ts'

/** Pixels-per-second rate the claw snaps shut, and how long it stays
 * closed after a successful grab. Module-level so the timing is
 * deterministic for tests and ease-curves (was private statics). */
export const CLAW_SNAP = 0.18
export const CLAW_HOLD = 0.35

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** (c.y - bandLo) / bandH for a creature's CURRENT lane position. */
export function laneFracOf(eng: OceanEngine, c: Creature): number {
  const [ylo, yhi] = eng.zoneBand(c.zone)
  return clamp((c.y - ylo) / Math.max(yhi - ylo, 1), 0, 1)
}

/** Collision bite: the drifting hook physically touched this creature.
 * Does NOT touch the pity clock (lastCatchAt) or the local lock
 * (lockUntil) — those are owned by the caller via markMiss() /
 * markCatch() so the result branch (card vs. escape) decides whether
 * the player has to wait. */
export function biteAt(eng: OceanEngine, c: Creature): void {
  eng.caught = c
  eng.caughtFrac = laneFracOf(eng, c)
  eng.state = 'reeling'; eng.reelP = 0
}

/** Wide-sweep bite for the hands-free drip: the nearest creature inside
 * a 2.2× wet ellipse around the claw's visual center. Returns true when
 * one was latched (biteAt + clawShut, same as a manual grab). */
export function autoWideGrabOn(eng: OceanEngine): boolean {
  const hp = eng.hookPos()
  const ccx = hp.x; const ccy = hp.y + 11
  const vy0 = eng.camY - 20; const vy1 = eng.camY + eng.h + 20
  let best: Creature | null = null; let bestD = Infinity
  for (const c of eng.creatures) {
    if (c.y < vy0 || c.y > vy1) continue
    const rx = (12 + c.size * 1.6) * 2.2
    const ry = (14 + c.size * 1.2) * 2.2
    const dx = c.x - ccx; const dy = c.y - ccy
    const dn = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
    if (dn < 1 && dn < bestD) { bestD = dn; best = c }
  }
  if (best === null) return false
  biteAt(eng, best)
  eng.clawShut = 1
  return true
}

/** One hands-free attempt: an 80% "connect" roll, then a WIDE sweep
 * (2.2× the wet envelope) for the nearest fish around the patrolling
 * claw — the standard ellipse misses too often from random patrol
 * spots (user: "auto-catch never connects"). A failed connect or an
 * empty sweep plays the SAME empty-clap feedback a manual miss gets
 * (v36 removed the sideways glide — both manual and auto misses now
 * clap in place). Gate checks (lockUntil / hook settled) mirror
 * closeClaw(); while locked the attempt stays SILENT (no clap
 * animation — a locked idle claw shouldn't fidget every retry). */
export function autoAttemptOn(eng: OceanEngine): boolean {
  const hookSettled = Math.abs(eng.hookY - eng.hookTargetY) < eng.h * 0.05
  if (eng.t < eng.lockUntil || !hookSettled) return false
  eng.lastGrabAuto = true
  const connected = Math.random() < eng.autoConnectRate
  const swept = connected && autoWideGrabOn(eng)
  if (swept) return true
  eng.lastGrabAuto = false
  // Miss: empty clap (same feedback as a manual miss).
  eng.closeAt = eng.t
  eng.reopenAt = eng.t + CLAW_HOLD
  return false
}

/** Snap the claw shut on the nearest creature within the claw radius —
 * the NEW manual catch (replaces the old "manual bite closest of zone"
 * picker). Deterministic: runs the same search as the previous idle
 * auto-catch so the engine still answers "what would have bitten?" in
 * tests. Returns true on a real grab, false on an empty clap (or any
 * gate it short-circuits on). Mirrors closeClaw() verbatim. */
export function closeClawOn(eng: OceanEngine): boolean {
  if (eng.state !== 'idle' || eng.w === 0 || eng.pondMode) return false
  // Aim-snap: while manual steering is live the claw EASES toward the
  // pointer (time constant ~0.3s), so a fast flick-and-click would be
  // judged at the claw's LAGGING position — tens of px behind where the
  // player actually aimed. Snap the claw onto the pointer target first:
  // the click always grabs WHERE THE PLAYER AIMED (claw-machine feel).
  if (eng.manual !== null && eng.manualTarget !== null && eng.t <= eng.manualUntil) {
    const m = eng.manual
    m.x = clamp(eng.manualTarget.x, eng.w * 0.03, eng.w * 0.97)
    m.y = clamp(eng.manualTarget.y, eng.camY + eng.h * 0.05, eng.camY + eng.h * 0.95)
  }
  const hookSettled = Math.abs(eng.hookY - eng.hookTargetY) < eng.h * 0.05
  // Cooldown OR unsettled hook → flick the claw shut for a beat so the
  // player sees the click was registered, but never actually grab. The
  // claw claps in place — no glide (v36 removed the sideways fling that
  // used to follow every whiff). The cooldown gate reads lockUntil (set
  // by markMiss/markCatch) so a missed grab clears the gate immediately
  // — the dry-spell window above is driven by lastCatchAt and is
  // independent of this lock.
  if (eng.t < eng.lockUntil || !hookSettled) {
    eng.closeAt = eng.t
    eng.reopenAt = eng.t + CLAW_HOLD
    return false
  }
  const hp = eng.hookPos()
  const vy0 = eng.camY - 20; const vy1 = eng.camY + eng.h + 20
  // Claw visual center: midway between the hub (hp.y+6) and the open
  // outer tip (hp.y+22), bob ±2.5 absorbed by the ry margin below.
  const ccx = hp.x; const ccy = hp.y + 11
  let best: Creature | null = null; let bestD = Infinity
  for (const c of eng.creatures) {
    if (c.y < vy0 || c.y > vy1) continue
    const dx = c.x - ccx; const dy = c.y - ccy
    // Same luck window as the old auto-catch: a zone-scaled dry spell
    // widens the envelope — a grab is guaranteed in ~5min at the surface,
    // +90s per deeper band.
    const lw = 210 + zoneIndexOf(eng.occupancy) * 90
    // Claw-envelope ELLIPSE (v28): the drawn claw spans ±11px splay and
    // ~16px reach, with sprite fish rendering up to size×3.2 long. The
    // previous circular radius (≈9–19px) rejected fish the player could
    // see at the prong tips — edge contact must grab. rx aligns with
    // splay(11) + slack + fish visual half-width (1.6·size); ry aligns
    // with the claw-reach offset from the center (≈11px) + bob slack +
    // fish visual half-height (~1.2·size), tightened vertically so a
    // fish in the adjacent lane never gets cross-grabbed.
    const dry = eng.t - eng.lastCatchAt > lw
    const rx = dry ? 22 + c.size * 1.6 : 12 + c.size * 1.6
    const ry = dry ? 24 + c.size * 1.2 : 14 + c.size * 1.2
    // Normalized distance — dn < 1 means inside the ellipse, dn
    // monotonically smaller = closer to the visual claw center.
    const dn = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
    if (dn < 1 && dn < bestD) { bestD = dn; best = c }
  }
  if (best !== null) {
    biteAt(eng, best)
    eng.clawShut = 1
    return true
  }
  // Empty clap: shut → hold briefly → reopen, so the click reads.
  // v36 removed the sideways glide (the miss now claps in place — the
  // user feedback was that the claw visibly "slipping off" read as a
  // bug, not as feedback).
  eng.closeAt = eng.t
  eng.reopenAt = eng.t + CLAW_HOLD
  return false
}
