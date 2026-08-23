/**
 * Scene rendering (split from engine.ts): the frame compositor
 * (renderOcean) plus the screen-space turbulence current lines and the
 * per-creature fish wake. Pure per-call: reads engine state, mutates
 * nothing. The engine's draw() delegates here with the world height and
 * a lazy seabed-decor closure so the memo stays engine-owned.
 */
import { ZONES } from './depth.ts'
import { waterColorAt } from './palette.ts'
import { drawPondBackdrop, pondSurfaceY } from './pond-bg.ts'
import type { OceanProfile } from './oceans.ts'
import { drawDecorItem, drawFloorBand, type seededDecor } from './decor.ts'
import type { Creature } from './engine.ts'
import type { OceanEngine } from './engine.ts'
import { drawCreature } from './engine-creature-draw.ts'

/** Seabed decor entry type (the engine memoizes the array per ocean). */
export type DecorItem = ReturnType<typeof seededDecor>[number]

/** Turbulence flow lines: 6–8 horizontal current streaks painted in
 * screen space, drifting sideways and wobbling vertically, plus two
 * counter-rotating vortex puffs that read as eddies behind rocks.
 * Deterministic per-stream parameters are hashed from the index `i`, so
 * each line has a stable baseline / speed / direction / amplitude
 * without any stored physics state — and resize stays proportional
 * because every property derives from `i + t + w + h`. Visibility is
 * tuned so the currents sit between bubbles (alpha ~0.16) and zone
 * boundary lines (alpha 0.05); if you can see bubbles, you can read
 * these. */
export function drawTurbulence(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const count = 7
  ctx.save()
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i += 1) {
    // Deterministic hash → fractional stream parameters in [0,1).
    const h1 = Math.sin(i * 12.9898 + 78.233) * 43758.5453
    const h2 = Math.sin(i * 39.346 + 11.135) * 24634.6345
    const h3 = Math.sin(i * 7.9173 + 91.117) * 12345.6789
    const frac1 = h1 - Math.floor(h1)
    const frac2 = h2 - Math.floor(h2)
    const frac3 = h3 - Math.floor(h3)
    const yFrac = 0.08 + frac1 * 0.84        // vertical lane (0..1 of viewport)
    const speed = 4 + frac2 * 12              // px/sec drift
    const dir = frac1 > 0.5 ? 1 : -1           // some flow L→R, others R→L
    const amp = 3 + frac3 * 5                 // vertical wobble amplitude (px)
    // x wraps around the viewport: lines flow forever without resetting.
    const xStart = (frac1 * w + t * speed * dir) % w
    const x = xStart < 0 ? xStart + w : xStart
    const y0 = yFrac * h + Math.sin(t * 0.8 + i) * amp
    // 70–140px short arc — short enough to read as eddies, not a band.
    const len = 70 + frac2 * 70
    const ctrlX = x + len * 0.5 * dir + Math.sin(t * 0.6 + i * 0.7) * 8
    const ctrlY = y0 + Math.cos(t * 0.9 + i) * 6
    const endX = x + len * dir
    const endY = y0 + Math.sin(t * 0.7 + i * 1.3) * 4
    // Visibility bump: bubbles sit at ~0.16, zone lines at 0.05; this
    // band (0.10–0.17) keeps the current visible without overpowering.
    const alpha = 0.10 + frac3 * 0.07
    ctx.strokeStyle = 'rgba(200,230,255,' + alpha.toFixed(3) + ')'
    ctx.lineWidth = 1.5 + frac2 * 0.7
    ctx.beginPath()
    ctx.moveTo(x, y0)
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY)
    ctx.stroke()
  }
  // -- vortex puffs: two counter-rotating eddies in the upper portion
  // of the viewport. Each paints two concentric partial arcs whose
  // start angle drifts with t, so the swirl is unmistakable without
  // becoming a busy disc. No physics — every property is hashed from
  // the vortex index, deterministic across frames.
  for (let v = 0; v < 2; v += 1) {
    const vh1 = Math.sin((v + 1) * 51.137 + 4.7) * 7919.0
    const vh2 = Math.sin((v + 1) * 27.91 + 19.2) * 4057.0
    const vh3 = Math.sin((v + 1) * 83.47 + 33.1) * 3344.0
    const vh4 = Math.sin((v + 1) * 11.31 + 7.5) * 1861.0
    const fx1 = vh1 - Math.floor(vh1)
    const fx2 = vh2 - Math.floor(vh2)
    const fx3 = vh3 - Math.floor(vh3)
    const fx4 = vh4 - Math.floor(vh4)
    // Stay out of the very top so the surface gradient keeps its calm.
    const xFrac = 0.12 + fx1 * 0.76
    const yFrac = 0.18 + fx2 * 0.68
    const cx = xFrac * w
    const cy = yFrac * h
    const r = 9 + fx3 * 7                       // 9..16 px
    const spinSign = fx4 > 0.5 ? 1 : -1          // some CW, some CCW
    const omega = 0.2 + fx3 * 0.15               // rad/s
    const baseAng = t * omega * spinSign
    // Two concentric partial arcs (~250°) spinning from the same
    // origin — outer and inner rim, slightly different start angle.
    const arcSpan = (250 * Math.PI) / 180
    for (let k = 0; k < 2; k += 1) {
      const kr = r * (k === 0 ? 1 : 0.6)
      const startAng = baseAng + k * 0.4
      const endAng = startAng + arcSpan
      ctx.strokeStyle = 'rgba(200,230,255,0.090)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(cx, cy, kr, startAng, endAng)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Fish wake: a 2–3 short trailing arc behind every creature, fanning
 * slightly so it reads as displaced water. Alpha scales with speed and
 * size — still creatures leave nothing; caught fish skip the wake
 * entirely (hard-attached to the hook). Stateless: phase + t +
 * c.vx + c.size, no accumulator arrays. */
export function drawWake(ctx: CanvasRenderingContext2D, c: Creature, t: number): void {
  const speed = Math.abs(c.vx)
  if (speed < 0.05) return // a creature at rest leaves no wake
  const dir = c.vx >= 0 ? 1 : -1
  // Tail end sits roughly a body-length behind the head, mirrored by dir.
  const tailX = c.x - dir * c.size * 1.1
  const tailY = c.y
  const baseAlpha = 0.04 + Math.min(speed, 1.0) * 0.05 + Math.min(c.size / 40, 1) * 0.03
  ctx.save()
  ctx.lineCap = 'round'
  const lines = 3
  for (let i = 0; i < lines; i += 1) {
    const a = baseAlpha * (1 - i * 0.25)
    if (a <= 0.005) continue
    ctx.strokeStyle = 'rgba(210,235,255,' + a.toFixed(3) + ')'
    ctx.lineWidth = 1
    const offY = (i - 1) * c.size * 0.18
    const len = c.size * (0.7 + i * 0.1)
    const ctrlX = tailX - dir * len * 0.5 + Math.sin(t * 1.4 + c.phase + i) * 2
    const ctrlY = tailY + offY + Math.cos(t * 1.2 + c.phase + i * 0.7) * 3
    const endX = tailX - dir * len
    const endY = tailY + offY + Math.sin(t + c.phase + i) * 1.5
    ctx.beginPath()
    ctx.moveTo(tailX, tailY + offY)
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY)
    ctx.stroke()
  }
  ctx.restore()
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** Paint one full frame: water gradient, turbulence, world-space
 * backdrop (pond floor / light shafts / zone lines / seabed), bubbles,
 * ambient + foreground fauna, and the hook + claw rig. Mirrors the
 * engine.draw() body verbatim; `deriveSeabed` lazily memoizes the
 * ocean's decor layout (engine-owned state). */
export function renderOcean(
  ctx: CanvasRenderingContext2D,
  eng: OceanEngine,
  worldH: number,
  deriveSeabed: () => ReadonlyArray<DecorItem>,
): void {
  const { w, h, t, camY } = eng
  // v47 pond zoom: the world is scaled around the viewport center, so
  // every world-space computation below (gradient span, cull window,
  // shaft fade, backdrop plant sizing) uses the VISIBLE world span
  // (w/z × h/z) instead of the raw viewport. Ocean mode keeps z=1 and
  // renders exactly as before.
  const z = eng.pondMode ? eng.pondZoom : 1
  const visW = w / z
  const visH = h / z
  // Pond-world samples the water gradient from camY's fraction of the
  // POND world (a multi-screen pond also darkens as the diver pans
  // toward its bottom row); falls back to the legacy 4-screen world in
  // ocean mode.
  const pondH = (eng.pondMode && eng.pondWH > 0) ? eng.pondWH : worldH
  const tint = eng.ocean?.tint
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, waterColorAt(camY / pondH, tint))
  grad.addColorStop(0.5, waterColorAt((camY + visH * 0.5) / pondH, tint))
  grad.addColorStop(1, waterColorAt((camY + visH) / pondH, tint))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  // Turbulence streaks: drawn in SCREEN space (above the camY translate)
  // so they read as flat current lines layered over the water column.
  // Stateless — every per-stream property is hashed from `i` and drifts
  // on `t`, so resize keeps proportions for free.
  drawTurbulence(ctx, w, h, t)

  ctx.save()
  // Translate by both cameras: ocean mode has camX=0 so it stays
  // unchanged; pond mode uses both axes for the panned multi-screen
  // world. drawPondBackdrop lives inside the translate so the floor
  // and light shafts anchor to world coordinates (otherwise panning
  // would leave the floor sliding off the screen). v47: the pond first
  // scales the world around the viewport center — at z=1 the composed
  // matrix is identical to the old single translate.
  if (eng.pondMode && z !== 1) {
    ctx.translate(w / 2, h / 2)
    ctx.scale(z, z)
    ctx.translate(-w / 2, -h / 2)
  }
  ctx.translate(-eng.camX, -camY)
  if (eng.pondMode) {
    const pw = eng.pondWW > 0 ? eng.pondWW : w
    const ph = eng.pondWH > 0 ? eng.pondWH : h
    const screens = Math.max(1, Math.round((pw * ph) / Math.max(1, w * h)))
    // screenH (VISIBLE world height under the current zoom) sizes the
    // PLANTS per screen — the world dims size the seam/beams/motes.
    // Without it a multi-screen pond scales seaweed by the world height
    // (v42 regression, v43 fixed); under zoom the visible span keeps the
    // perceived plant density constant.
    // v49 span: waves/beams/soil draw across the VISIBLE x-range (plus a
    // little margin), not just the world width — a zoomed-out camera (or
    // a world narrower than the view) then sees the surface and floor
    // continue to the screen edges instead of bare void margins.
    const visL = eng.camX + (w / 2) * (1 - 1 / z)
    const visR = eng.camX + (w / 2) * (1 + 1 / z)
    drawPondBackdrop(ctx, pw, ph, t, eng.ocean, screens, visH,
      { x0: visL - 80, x1: visR + 80 })
  }

  // Light shafts live at the surface (world y ≈ 0); they leave the viewport
  // as the camera dives, plus a gentle depth fade. v48: in pond mode the
  // shaft tops follow the wavy water surface (pondSurfaceY) so they match
  // the pond-bg beams and the visible surface line; ocean mode keeps the
  // flat world top (no pond surface there).
  const shaftFade = clamp(1 - camY / (visH * 1.2), 0, 1)
  if (shaftFade > 0.02) {
    const pw = eng.pondWW > 0 ? eng.pondWW : w
    const ph = eng.pondWH > 0 ? eng.pondWH : h
    const surfTop = (x: number): number =>
      eng.pondMode ? pondSurfaceY(x, t, pw, ph) : 0
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = shaftFade
    for (let i = 0; i < 3; i++) {
      const bx = visW * (0.2 + i * 0.3) + Math.sin(t * 0.3 + i) * 24
      const rg = ctx.createLinearGradient(0, 0, 0, visH * 0.5)
      rg.addColorStop(0, 'rgba(190,235,255,0.10)')
      rg.addColorStop(1, 'rgba(190,235,255,0)')
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.moveTo(bx - 14, surfTop(bx - 14)); ctx.lineTo(bx + 14, surfTop(bx + 14))
      ctx.lineTo(bx + 70, visH * 0.5); ctx.lineTo(bx - 30, visH * 0.5)
      ctx.closePath(); ctx.fill()
    }
    ctx.restore()
  }

  // Zone boundary lines at their world depths (only those in view draw).
  if (!eng.pondMode) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    for (let i = 1; i < ZONES.length; i++) {
      const y = (ZONES[i]?.lo ?? 0) * worldH
      if (y < camY - 4 || y > camY + h + 4) continue
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
    }
  }

  // -- the seabed: sediment floor + decor (seaweed/coral/...) rooted on
  // the world bottom. Stateless per frame: x positions are fractions of
  // the CURRENT width and sway is horizontal-only, so window resizes
  // stay exactly proportional and nothing here swims. Ocean mode only;
  // the pond draws its own floor via pond-bg.
  if (!eng.pondMode && eng.ocean !== null) {
    const floorTop = worldH - h * 0.26
    if (camY + h > floorTop - 60) {
      const seabedItems = deriveSeabed()
      drawFloorBand(ctx, w, floorTop, worldH + 40, eng.ocean.tint)
      const scale = Math.max(h * 0.16, 46)
      for (const item of seabedItems) {
        drawDecorItem(ctx, item, item.xFrac * w, worldH + 6, t, scale)
      }
    }
  }

  // Visible band (with margin) — bubbles and fauna outside it don't draw.
  // Pond mode adds an x-axis cull so creatures in the off-screen parts
  // of the multi-screen pond world don't waste draw calls. v47: the
  // window is the VISIBLE world span (visW × visH), so zooming out
  // widens the cull instead of clipping the revealed margin away.
  const vy0 = camY - 80; const vy1 = camY + visH + 80
  const vx0 = eng.camX - 80; const vx1 = eng.camX + visW + 80
  ctx.fillStyle = 'rgba(210,235,255,0.16)'
  for (const b of eng.bubbles) {
    if (b.y < vy0 || b.y > vy1) continue
    if (eng.pondMode && (b.x < vx0 || b.x > vx1)) continue
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill()
  }

  // v44 ambient fauna: drawn BEFORE the diver's catch (which is the
  // foreground) and at globalAlpha 0.82 so the small background school
  // reads as a softer layer behind the player's fish. Pond-mode only
  // — ocean mode never populates `ambient`. Same viewport culling
  // (vx0/vx1/vy0/vy1) and drawWake treatment as the foreground
  // school, just rendered with a wrapped alpha so any sprite's own
  // filter (hue-rotate) multiplies through correctly.
  if (eng.pondMode && eng.ambient.length > 0) {
    ctx.save()
    ctx.globalAlpha = 0.82
    for (const c of eng.ambient) {
      if (c.y < vy0 || c.y > vy1) continue
      if (c.x < vx0 || c.x > vx1) continue
      drawWake(ctx, c, t)
      drawCreature(ctx, c, eng.sprites, eng.ocean)
    }
    ctx.restore()
  }

  for (const c of eng.creatures) {
    if (c.y < vy0 || c.y > vy1) continue
    if (eng.pondMode && (c.x < vx0 || c.x > vx1)) continue
    // Fish wake: a faint trailing arc behind every swimming creature,
    // purely cosmetic. A caught fish (reeling/raised) skips the wake —
    // it's hard-attached to the hook and physically motionless. Wake
    // uses no per-frame stored state (phase + i + t), so the render
    // layer change cannot perturb any physics assertion in
    // hook-ride.spec.
    if (c !== eng.caught) drawWake(ctx, c, t)
    // Struggle: a caught fish (reeling up + raised) shakes hard at the
    // RENDER layer only — the physics keeps the hard-attachment invariant
    // (c.x === hp.x exactly in raised; tests assert equality), so the
    // wobble is an outer canvas translate that composes with BOTH the
    // sprite and the procedural draw paths.
    if (c === eng.caught && (eng.state === 'reeling' || eng.state === 'raised')) {
      ctx.save()
      ctx.translate(Math.sin(t * 24) * 3.5, Math.cos(t * 29) * 1.2)
      drawCreature(ctx, c, eng.sprites, eng.ocean)
      ctx.restore()
    } else {
      drawCreature(ctx, c, eng.sprites, eng.ocean)
    }
  }

  // Claw: the line from the surface to the swaying claw center, then a
  // two-prong U-shaped claw (with a small middle spike) that snaps shut
  // when the player clicks. The line bends (quadratic curve) toward the
  // drift offset so the current + sway read as physics, not a rigid rod.
  // Hidden entirely in pond mode.
  if (!eng.pondMode) {
    const hp = eng.hookPos()
    const bob = Math.sin(t * 1.4) * 2.5
    const hx = hp.x
    const hy = hp.y + bob
    const anchorX = eng.hookX * w
    ctx.strokeStyle = 'rgba(225,240,255,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(anchorX, 0)
    ctx.quadraticCurveTo(anchorX + (hx - anchorX) * 0.25, hy * 0.55, hx, hy)
    ctx.stroke()

    // Claw geometry. Center is at (hx, hy+6) — the same point the caught
    // fish hard-attaches to, so the visual contact is consistent with the
    // physics. The openness multiplier is (1 - clawShut): 1 = wide U,
    // 0 = tight fist. Three prongs: left, middle, right (mirror).
    const open = 1 - eng.clawShut
    const cx = hx
    const cy = hy + 6
    const splay = 11 * open            // horizontal spread of the outer tips
    const reach = 16                   // how far DOWN the closed fist extends
    const outerY = cy + reach          // outer tip rest y (open)
    const midY = cy + reach * 0.85     // middle tip rest y (slightly shorter)
    const tipY = cy + 16               // converged tip y (closed)
    ctx.strokeStyle = '#e8f4ff'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    // Left prong: from hub (cx, cy) curve to (cx-splay, outerY) open or
    // (cx-1, tipY) shut.
    const ltx = cx - splay
    const lcx = cx - splay * 0.55
    const lcy = cy + (outerY - cy) * 0.6
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.quadraticCurveTo(lcx, lcy, ltx, outerY)
    ctx.stroke()
    // Right prong (mirror).
    const rtx = cx + splay
    const rcx = cx + splay * 0.55
    const rcy = lcy
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.quadraticCurveTo(rcx, rcy, rtx, outerY)
    ctx.stroke()
    // Middle prong: shorter, dives straight down on shutdown.
    const mtx = cx
    const mcy = cy + (midY - cy) * 0.6
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.quadraticCurveTo(mtx, mcy, mtx, midY)
    ctx.stroke()
    // Hub: a small solid disc that ties the three prongs together.
    ctx.fillStyle = '#e8f4ff'
    ctx.beginPath()
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2)
    ctx.fill()
    // When shut, overlay a tiny pinch dot at the converged tip so the
    // closed fist reads as a grip, not three free-floating lines.
    if (eng.clawShut > 0.5) {
      ctx.beginPath()
      ctx.arc(cx, tipY, 1.4 * eng.clawShut, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.restore()
}
