/**
 * Catch mechanics (split from engine.ts): the claw snap (manual grab),
 * the hands-free auto-catch attempt + wide sweep, the collision bite,
 * and the lane-fraction helper. The engine keeps thin method shells so
 * the instance shape (tests cast-peek closeAt / reopenAt /
 * autoConnectRate / autoWideGrab) is unchanged; these functions write
 * the engine's internal claw state directly.
 *
 * v50 contract — GUARANTEED CONTACT: whenever the claw visually overlaps
 * a fish and the player clicks, the grab ALWAYS lands. There is no
 * contact-layer probability left (no lockUntil cooldown gate, no
 * dry/wet pity envelope). The only randomness in the whole loop is the
 * server's dice (pow.ts), exactly as the user asked: 重叠+左键必摸到,
 * 中不中骰子由服务端概率决定.
 */
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
 * Starts the reel-up; whether this attempt turns into a card is decided
 * later by the SERVER's dice (see ocean-flow.ts → runCatchFlow) — the
 * engine has no say and no local lock either way. */
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
 * empty sweep plays the SAME empty-clap feedback a manual miss gets.
 * v50: the local lockUntil gate is gone with the other catch locks —
 * pacing is the nextAutoAt timer (engine-step) plus the server's
 * win-only 5-minute gate. Only the still-sinking hook stays silent
 * (no clap — the claw isn't where it will fish yet). */
export function autoAttemptOn(eng: OceanEngine): boolean {
  const hookSettled = Math.abs(eng.hookY - eng.hookTargetY) < eng.h * 0.05
  if (!hookSettled) return false
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

/** Snap the claw shut on the nearest creature within the claw envelope —
 * the manual catch. v50 GUARANTEED-CONTACT contract: whenever the claw
 * visually overlaps a fish, this ALWAYS grabs — there is no cooldown
 * gate and no dry/wet luck window anymore (user: 手和鱼重叠时按左键
 * 就一定能摸到鱼; whether it becomes a card is the server dice's 1/5 —
 * 1/2 for a rookie's first 5 minutes). The only short-circuits left are
 * physical: an unsettled hook (the line is still sinking to its target
 * depth after a depth change) claps empty, and so does a click that
 * genuinely misses every fish. */
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
  // Unsettled hook → flick the claw shut for a beat so the player sees
  // the click was registered, but never actually grab: the line is still
  // sinking toward its target depth, so the claw isn't where the player
  // is aiming yet. This is the ONLY remaining gate — transient physics,
  // not probability (it clears in ~a second after any depth change).
  if (!hookSettled) {
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
    // Claw-envelope ELLIPSE (v28, constant since v50): the drawn claw
    // spans ±11px splay and ~16px reach, with sprite fish rendering up
    // to size×3.2 long. rx aligns with splay(11) + slack + fish visual
    // half-width (1.6·size); ry aligns with the claw-reach offset from
    // the center (≈11px) + bob slack + fish visual half-height
    // (~1.2·size), tightened vertically so a fish in the adjacent lane
    // never gets cross-grabbed. Inside this ellipse = visual overlap ⇒
    // a click ALWAYS grabs (deterministic — no luck window widening).
    const rx = 12 + c.size * 1.6
    const ry = 14 + c.size * 1.2
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
  // A genuine miss — no fish under the claw. (v36 removed the sideways
  // glide; the miss claps in place.)
  eng.closeAt = eng.t
  eng.reopenAt = eng.t + CLAW_HOLD
  return false
}
