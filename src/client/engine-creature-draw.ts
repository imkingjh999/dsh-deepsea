/**
 * Procedural creature painting (split from engine.ts): the sprite-fallback
 * canvas silhouettes for every Creature kind. Sprites own their
 * save→restore; when no sprite matches, this module draws the hand-coded
 * side-view body. Pure per-call — takes ctx, the creature, the sprite
 * table and the ocean profile; touches no engine state.
 */
import { ZONES } from './depth.ts'
import { drawFaunaSprite, type FaunaSprites } from './fauna.ts'
import { hueOf, type OceanProfile } from './oceans.ts'
import type { Creature } from './engine.ts'

/** Draw one creature: painted sprite first (fauna.ts), procedural
 * silhouette as the fallback. Mirrors engine.drawCreature verbatim. */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  c: Creature,
  sprites: FaunaSprites | null,
  ocean: OceanProfile | null,
): void {
  const zone = ZONES[c.zone]
  // Sprites own their save→restore; run BEFORE the procedural save/translate
  // (an early return inside that block leaked transforms — sideways canvas).
  if (sprites !== null && drawFaunaSprite(ctx, c, sprites, hueOf(ocean, c.zone))) return
  ctx.save()
  ctx.translate(c.x, c.y + Math.sin(c.phase) * 3)
  if (c.vx < 0) ctx.scale(-1, 1)
  const s = c.size
  const dark = (zone?.light ?? 1) < 0.3
  const body = `hsl(${c.hue.toFixed(0)} ${dark ? 45 : 70}% ${dark ? 34 : 62}%)`
  ctx.fillStyle = body
  if (dark) { ctx.shadowColor = `hsl(${c.hue.toFixed(0)} 90% 65%)`; ctx.shadowBlur = 10 }

  switch (c.kind) {
    case 'fish': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.8, s * 0.45, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath()
      ctx.moveTo(-s * 0.75, 0); ctx.lineTo(-s * 1.25, -s * 0.4); ctx.lineTo(-s * 1.25, s * 0.4)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#0a1622'
      ctx.beginPath(); ctx.arc(s * 0.42, -s * 0.08, s * 0.08, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'turtle': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.7, s * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#2e7d5b'
      ctx.beginPath(); ctx.ellipse(0, -s * 0.18, s * 0.55, s * 0.32, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = body
      ctx.beginPath(); ctx.ellipse(s * 0.82, -s * 0.05, s * 0.22, s * 0.16, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'hatchet': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.62, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#cfe6ff'
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.arc(-s * 0.2 + i * s * 0.15, s * 0.3, 1.1, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'jelly': {
      const pul = 1 + Math.sin(c.phase * 1.6) * 0.12
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.5 * pul, s * 0.38 * pul, 0, 0, Math.PI); ctx.fill()
      ctx.strokeStyle = body; ctx.lineWidth = 1.4
      for (let i = 0; i < 4; i++) {
        const tx = -s * 0.32 + i * s * 0.21
        ctx.beginPath(); ctx.moveTo(tx, s * 0.1)
        ctx.quadraticCurveTo(tx + Math.sin(c.phase + i) * 6, s * 0.7, tx, s * 1.25)
        ctx.stroke()
      }
      break
    }
    case 'viper': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 1.05, s * 0.22, 0, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#dff3ff'
      for (let i = 0; i < 5; i++) {
        ctx.beginPath()
        ctx.moveTo(s * 0.45 - i * s * 0.16, -s * 0.12)
        ctx.lineTo(s * 0.4 - i * s * 0.16, s * 0.16)
        ctx.lineTo(s * 0.33 - i * s * 0.16, -s * 0.12)
        ctx.fill()
      }
      break
    }
    case 'squid': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.3, s * 0.7, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = body; ctx.lineWidth = 1.6
      for (let i = 0; i < 5; i++) {
        const tx = -s * 0.22 + i * s * 0.11
        ctx.beginPath(); ctx.moveTo(tx, s * 0.55)
        ctx.quadraticCurveTo(tx + Math.sin(c.phase + i * 0.7) * 7, s * 1.1, tx, s * 1.5)
        ctx.stroke()
      }
      ctx.fillStyle = '#8ef0ff'; ctx.shadowBlur = 12
      ctx.beginPath(); ctx.arc(0, -s * 0.45, 1.8, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'angler': {
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.62, s * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = body; ctx.lineWidth = 1.6
      ctx.beginPath(); ctx.moveTo(s * 0.3, -s * 0.4); ctx.quadraticCurveTo(s * 0.85, -s * 1.05,
        s * 1.05, -s * 0.72); ctx.stroke()
      ctx.fillStyle = '#bfffee'; ctx.shadowColor = '#7dffe3'; ctx.shadowBlur = 14
      ctx.beginPath(); ctx.arc(s * 1.05, -s * 0.72, 3, 0, Math.PI * 2); ctx.fill()
      ctx.shadowBlur = 10
      ctx.fillStyle = '#eaf7ff'
      for (let i = 0; i < 4; i++) {
        ctx.beginPath()
        ctx.moveTo(s * 0.3 - i * s * 0.18, s * 0.1)
        ctx.lineTo(s * 0.24 - i * s * 0.18, s * 0.34)
        ctx.lineTo(s * 0.16 - i * s * 0.18, s * 0.1)
        ctx.fill()
      }
      break
    }
    case 'octopus': {
      ctx.beginPath(); ctx.ellipse(0, -s * 0.15, s * 0.5, s * 0.4, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = body; ctx.lineWidth = 2.2
      for (let i = 0; i < 3; i++) {
        const tx = -s * 0.3 + i * s * 0.3
        ctx.beginPath(); ctx.moveTo(tx, s * 0.15)
        ctx.quadraticCurveTo(tx + Math.sin(c.phase + i) * 8, s * 0.8, tx, s * 1.2)
        ctx.stroke()
      }
      break
    }
    case 'eel': {
      ctx.strokeStyle = body; ctx.lineWidth = s * 0.24; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(-s * 1.2, 0)
      ctx.quadraticCurveTo(-s * 0.4, Math.sin(c.phase) * s * 0.5, s * 0.3, 0)
      ctx.quadraticCurveTo(s * 0.9, -Math.sin(c.phase) * s * 0.5, s * 1.4, Math.sin(c.phase * 0.7) * s * 0.3)
      ctx.stroke()
      ctx.fillStyle = '#ffb3c8'; ctx.shadowBlur = 10
      ctx.beginPath(); ctx.arc(s * 1.4, Math.sin(c.phase * 0.7) * s * 0.3, 2.2, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'shrimp': {
      // v44 ambient side-view shrimp: pale pink-white curved body, a
      // tiny triangular tail fan at the rear, two long thin antennae
      // extending forward (the parent's vx flip mirrors them correctly),
      // and 3 short legs paddling underneath. Body uses a translucent
      // pink-white so the wrapped 0.82 ambient-alpha still reads as a
      // distinct silhouette against the sand. No fauna sprite by design
      // (procedural-only; FAUNA_KINDS in fauna.ts is unchanged).
      ctx.fillStyle = 'rgba(240,205,195,0.85)'
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.85, s * 0.35, 0, 0, Math.PI * 2); ctx.fill()
      // Tail fan (small triangle behind the body).
      ctx.fillStyle = 'rgba(220,175,165,0.8)'
      ctx.beginPath()
      ctx.moveTo(-s * 0.8, 0)
      ctx.lineTo(-s * 1.25, -s * 0.35)
      ctx.lineTo(-s * 1.25, s * 0.35)
      ctx.closePath()
      ctx.fill()
      // Two thin antennae extending forward (parent's ctx.scale(-1,1)
      // mirrors them with the body).
      ctx.strokeStyle = 'rgba(200,150,140,0.75)'
      ctx.lineWidth = Math.max(0.8, s * 0.05)
      ctx.lineCap = 'round'
      for (let a = 0; a < 2; a += 1) {
        const offY = (a - 0.5) * s * 0.18
        ctx.beginPath()
        ctx.moveTo(s * 0.7, offY)
        ctx.quadraticCurveTo(s * 1.2, offY + Math.sin(c.phase + a) * s * 0.1,
          s * 1.55, offY + Math.sin(c.phase + a + 1) * s * 0.18)
        ctx.stroke()
      }
      // 3 short legs paddling underneath.
      ctx.strokeStyle = 'rgba(220,175,165,0.7)'
      ctx.lineWidth = Math.max(0.8, s * 0.05)
      for (let l = 0; l < 3; l += 1) {
        const lx = -s * 0.4 + l * s * 0.35
        ctx.beginPath()
        ctx.moveTo(lx, s * 0.3)
        ctx.lineTo(lx + Math.sin(c.phase + l) * s * 0.12, s * 0.55)
        ctx.stroke()
      }
      break
    }
    case 'crab': {
      // v44 ambient side-view crab: orange-red wide flat oval body
      // (using the precomputed `body` so the creature's hue drives the
      // palette), two small front claws (a small circle + short line
      // pointing forward), 3 visible legs going down at an angle, and
      // a tiny eyestalk dot. Nailed to the soil seam by laneLo/laneHi
      // (built in stockPond), so the legs read as gripping the sand.
      ctx.fillStyle = body
      ctx.beginPath(); ctx.ellipse(0, 0, s * 0.9, s * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      // Front claw: small circle + short line extending forward.
      ctx.strokeStyle = body
      ctx.lineWidth = Math.max(1.6, s * 0.1)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(s * 0.55, -s * 0.12)
      ctx.lineTo(s * 1.1, -s * 0.42)
      ctx.stroke()
      ctx.fillStyle = body
      ctx.beginPath(); ctx.arc(s * 1.1, -s * 0.42, s * 0.16, 0, Math.PI * 2); ctx.fill()
      // 3 visible legs going down at an angle — small stroke near the
      // body root, fanning slightly so the silhouette reads as alive.
      ctx.strokeStyle = body
      ctx.lineWidth = Math.max(1.2, s * 0.07)
      ctx.lineCap = 'round'
      for (let l = 0; l < 3; l += 1) {
        const lx = -s * 0.5 + l * s * 0.45
        ctx.beginPath()
        ctx.moveTo(lx, s * 0.35)
        ctx.lineTo(lx + s * 0.1, s * 0.55 + l * s * 0.08)
        ctx.stroke()
      }
      // Eyestalk: a tiny dark dot on a short stem above the body.
      ctx.fillStyle = '#1a1410'
      ctx.beginPath()
      ctx.moveTo(s * 0.25, -s * 0.4)
      ctx.lineTo(s * 0.3, -s * 0.55)
      ctx.lineWidth = Math.max(1, s * 0.05)
      ctx.strokeStyle = body
      ctx.stroke()
      ctx.beginPath(); ctx.arc(s * 0.3, -s * 0.58, s * 0.07, 0, Math.PI * 2); ctx.fill()
      break
    }
  }
  ctx.restore()
}
