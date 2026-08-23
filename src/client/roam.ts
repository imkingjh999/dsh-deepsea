/**
 * Hook roaming physics helper (see engine.ts). Owns the whole-panel patrol
 * state so engine.ts stays lean: absolute target positions re-picked inside
 * the visible viewport every few seconds, gentle cruise easing, a slowly
 * turning current that nudges the hook mid-route, and a small sway on top.
 */

export interface RoamBounds {
  /** viewport width in px */
  w: number
  /** viewport height in px */
  h: number
  /** current camera top in world px */
  camY: number
}

export class Roam {
  /** Absolute patrol position (world coords). */
  x = 0
  y = 0
  private tx = 0
  private ty = 0
  private nextAt = 1.5
  private t = 0
  private flowAngle = Math.random() * Math.PI * 2
  private flowSpin = (Math.random() - 0.5) * 0.25
  private flowStrength = 18
  private swayPhase = Math.random() * Math.PI * 2

  /** Roaming X bounds, fraction of width. */
  private static readonly X0 = 0.04
  private static readonly X1 = 0.96
  /** Roaming Y bounds, fraction of the visible viewport height. */
  private static readonly Y0 = 0.08
  private static readonly Y1 = 0.9

  /** Start patrolling from an explicit point (the classic anchor). */
  seed(x: number, y: number): void {
    this.x = this.tx = x
    this.y = this.ty = y
    this.nextAt = 0.5
  }

  /** Re-scale both axes after a viewport resize: the patrol keeps its
   * relative spot, so hook-to-fish geometry survives window resizing. */
  scale(kx: number, ky: number): void {
    this.x *= kx; this.tx *= kx
    this.y *= ky; this.ty *= ky
  }

  /** Advance one frame; call with dt seconds and the current bounds. */
  step(dt: number, b: RoamBounds): void {
    this.t += dt
    this.swayPhase += dt * 1.1
    this.flowAngle += this.flowSpin * dt
    if (Math.random() < dt * 0.05) this.flowSpin = (Math.random() - 0.5) * 0.3
    this.flowStrength = 18 + Math.sin(this.t * 0.11) * 10
    const flowX = Math.cos(this.flowAngle) * this.flowStrength
    const flowY = Math.sin(this.flowAngle) * this.flowStrength * 0.3
    if (this.t >= this.nextAt) {
      this.tx = b.w * (Roam.X0 + Math.random() * (Roam.X1 - Roam.X0))
      this.ty = b.camY + b.h * (Roam.Y0 + Math.random() * (Roam.Y1 - Roam.Y0))
      this.nextAt = this.t + 2 + Math.random() * 2
    }
    // Patrol ease: a slow, gentle cruise back toward (tx, ty) on top of
    // the slow turning current + sway. v36 dropped the whiff-fling branch
    // (a faster ease for ~0.9s after a missed grab) — misses now clap
    // in place (see engine.closeClaw) and the patrol keeps its idle cadence.
    const ease = Math.min(dt * 0.45, 1)
    const easeY = Math.min(dt * 0.4, 1)
    this.x += (this.tx - this.x) * ease + flowX * dt
    this.y += (this.ty - this.y) * easeY + flowY * dt
    this.x = Math.min(Math.max(this.x, b.w * Roam.X0), b.w * Roam.X1)
    const yLo = b.camY + b.h * Roam.Y0
    const yHi = b.camY + b.h * Roam.Y1
    this.y = Math.min(Math.max(this.y, yLo), yHi)
  }

  /** Patrol position plus the small sway offset (draw/collide here). */
  pos(b: RoamBounds): { x: number, y: number } {
    const swayX = Math.sin(this.swayPhase) * b.w * 0.03
    const swayY = Math.sin(this.swayPhase * 0.6) * b.h * 0.02
    return { x: this.x + swayX, y: this.y + swayY }
  }
}
