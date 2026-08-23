// @vitest-environment node
/**
 * v42 pond world: the school lives in a world wider than the viewport,
 * the camera pans via panPond(), and stockPond(...) takes optional world
 * dimensions. Engine invariants (legacy ocean resize, sprite balance,
 * card-spirit guards) are covered in their own specs — this file focuses
 * on the world-aware pond surface only.
 *
 * v46: the roster is now `cards` directly (every card → one fish,
 * duplicates included). The v42-era `wallFishOf()` helper is gone;
 * `pondRosterOf` is its thin pass-through replacement, and the 1:1
 * stocking spec below locks that behavior. The wander block in step()
 * gets its own suite (3D world + 1×1 world + off-toggle).
 */
import { describe, expect, it } from 'vitest'
import { OceanEngine, type Creature } from '../src/client/engine.ts'
import { pondRosterOf, pondStock, pondWorldFor } from '../src/client/pond.tsx'
import type { CardRecord } from '../src/client/depth.ts'

const card = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  id: 'aaaa1111', name: '暮光小灯', species: '灯笼鱼', rarity: 'COMMON',
  story: '她点亮额顶小灯。', depth: 0.42, zone: 'twilight',
  createdAt: 1_786_991_217_191, model: 'MiniMax-M3',
  art: '', holo: '', mask: '',
  ...overrides,
})

const fakeCard = (i: number): CardRecord =>
  card({ id: 'card-' + i, name: '鱼' + i, zone: 'sunlit', rarity: 'COMMON', starRank: (i % 108) + 1 })

describe('OceanEngine.stockPond (world-aware)', () => {
  it('legacy call (no world dims) keeps pondWW=0/pondWH=0 (sentinel: step()/draw() fall back to viewport)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([
      { zone: 0, kind: 'fish', x: 100, y: 300, vx: 1, size: 20, hue: 28, phase: 0 } as Creature,
      { zone: 0, kind: 'fish', x: 200, y: 400, vx: -1, size: 20, hue: 28, phase: 0 } as Creature,
    ])
    // 0 sentinel — the spec's chosen "legacy" representation. step()
    // and draw() read pondWW || this.w so the school still wraps on the
    // viewport; panPond() short-circuits on pondWW <= 0.
    expect(e.pondWW).toBe(0)
    expect(e.pondWH).toBe(0)
    // Step: x wraps on the viewport width (400), not on a 0 world width.
    const c = e.creatures[0]
    if (c === undefined) throw new Error('expected first creature')
    c.x = 1000 // far past viewport 400 → wraps via the >worldW+50 branch
    e.step(1 / 60)
    expect(c.x).toBeLessThanOrEqual(400 + 50)
  })

  it('world dims stock a multi-screen pond and reset the camera to (0,0)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    expect(e.pondWW).toBe(1200)
    expect(e.pondWH).toBe(1800)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  it('step() wraps fish on the WORLD width, not the viewport width', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([
      { zone: 0, kind: 'fish', x: 500, y: 300, vx: 0, size: 20, hue: 28, phase: 0 } as Creature,
    ], 1200, 1800)
    // Hand-place the fish past the world right edge → wrap via the
    // >worldW+50 branch, NOT on the viewport edge.
    const c = e.creatures[0]
    if (c === undefined) throw new Error('expected first creature')
    c.x = 1500 // > worldW 1200 + 50 → wraps
    e.step(1 / 60)
    // After wrap, fish lands at -40 (just off the left edge of the
    // world), still inside the world's pond band.
    expect(c.x).toBe(-40)
  })

  it('bubbles respawn on the WORLD width when they exit the top of the world', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 800, 1800) // 1×3 world
    const b = e.bubbles[0]
    if (b === undefined) throw new Error('expected first bubble')
    b.y = -100 // already past the top of the world → respawn
    b.x = 0
    const before = e.bubbles.length
    e.step(1 / 60)
    expect(e.bubbles.length).toBeGreaterThanOrEqual(before)
    expect(b.y).toBeGreaterThanOrEqual(1800 - 60) // respawn near world bottom
  })
})

describe('OceanEngine.panPond (camera pan with clamp)', () => {
  it('is a no-op when no pond world was set (legacy pondMode, pondWW=0)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([
      { zone: 0, kind: 'fish', x: 100, y: 100, vx: 0, size: 12, hue: 28, phase: 0 } as Creature,
    ])
    // pondWW=0 sentinel → panPond must NOT touch the camera.
    e.panPond(50, 50)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  it('moves the camera by (dx, dy) and clamps to [0, world - viewport]', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    // Spec contract: camX = clamp(camX + dx, 0, worldW - w).
    e.panPond(100, 100)
    expect(e.camX).toBe(100)
    expect(e.camY).toBe(100)
    // Huge positive pan → clamps to maxX/Y.
    e.panPond(9999, 9999)
    expect(e.camX).toBe(800) // 1200 - 400
    expect(e.camY).toBe(1200) // 1800 - 600
    // Past-the-edge in the other direction clamps back to 0.
    e.panPond(-9999, -9999)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  it('non-pannable world (worldW <= w) keeps the camera pinned at 0', () => {
    const e = new OceanEngine()
    e.resize(1200, 1800, 1)
    e.stockPond([], 1200, 1800) // same as viewport → maxX = 0
    e.panPond(300, 300) // positive dx → still clamped to 0 (maxX=0)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })
})

describe('OceanEngine.screenToWorld (viewport → world conversion)', () => {
  it('adds the current camera offset to a viewport point', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    e.panPond(100, 50) // camX=100, camY=50
    expect(e.screenToWorld(0, 0)).toEqual({ x: 100, y: 50 })
    expect(e.screenToWorld(200, 300)).toEqual({ x: 300, y: 350 })
  })

  it('returns the viewport point as-is when there is no pan', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    expect(e.screenToWorld(123, 456)).toEqual({ x: 123, y: 456 })
  })
})

describe('OceanEngine.resize (camera re-clamp on viewport change)', () => {
  it('clamps camX/camY into the new bounds when the viewport shrinks', () => {
    const e = new OceanEngine()
    e.resize(1200, 1800, 1)
    e.stockPond([], 1200, 1800)
    e.panPond(200, 100) // camX=200, camY=100
    // Shrink the viewport: pondWW stays 1200, but now maxX = 1200 - 800 = 400.
    e.resize(800, 1200, 1)
    expect(e.camX).toBeLessThanOrEqual(400)
    expect(e.camY).toBeLessThanOrEqual(600)
  })

  it('centers the camera when the viewport reaches/exceeds the world (v49)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    e.panPond(200, 100) // camX=200, camY=100
    e.resize(1300, 2000, 1) // viewport bigger than world → invalid range
    // v49 center-anchored bounds: z=1 keeps [0, ww−w] = invalid when the
    // viewport exceeds the world, so the camera centers the world in the
    // view (symmetric margins) instead of the old top-left pin. camX =
    // (0 + (1200−1300))/2 = −50; camY = (0 + (1800−2000))/2 = −100.
    expect(e.camX).toBe(-50)
    expect(e.camY).toBe(-100)
  })
})

describe('pond wall → world integration', () => {
  it('full wall (108 cards) drives a 3×3 pond world with 108 fish', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const input = Array.from({ length: 108 }, (_, i) => fakeCard(i))
    const wallFish = pondRosterOf(input)
    const geom = pondWorldFor(wallFish.length, e.w, e.h)
    expect(wallFish.length).toBe(108)
    expect(geom.cols).toBe(3)
    expect(geom.rows).toBe(3)
    expect(geom.worldW).toBe(1200)
    expect(geom.worldH).toBe(1800)
    e.stockPond(pondStock(wallFish, geom.worldW, geom.worldH), geom.worldW, geom.worldH)
    expect(e.creatures.length).toBe(108)
    expect(e.pondWW).toBe(1200)
    expect(e.pondWH).toBe(1800)
    // Pan to the bottom-right corner of the pond: camX=800, camY=1200.
    e.panPond(800, 1200)
    expect(e.camX).toBe(800)
    expect(e.camY).toBe(1200)
    // screenToWorld(0,0) at that pan = (800, 1200) — bottom-right corner.
    expect(e.screenToWorld(0, 0)).toEqual({ x: 800, y: 1200 })
  })

  it('small deck (5 cards) collapses to a 1×1 world, panning is a no-op', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const wallFish = pondRosterOf(Array.from({ length: 5 }, (_, i) => fakeCard(i)))
    expect(wallFish.length).toBe(5)
    const geom = pondWorldFor(wallFish.length, e.w, e.h)
    expect(geom.cols).toBe(1)
    expect(geom.rows).toBe(1)
    e.stockPond(pondStock(wallFish, geom.worldW, geom.worldH), geom.worldW, geom.worldH)
    e.panPond(500, 500) // maxX=0, maxY=0 → clamps to (0,0)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  // v46: 1:1 stocking — three copies of the same hero PLUS two distinct
  // cards → exactly five fish, duplicates included. The user wanted every
  // owned card to surface in the pond (the v42 seat-folding hid repeats).
  it('v46 1:1 stocking: 3 same-name copies + 2 distinct cards = 5 fish', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const dup = card({ id: 'dup1', name: '暮光小灯', starRank: 1, createdAt: 300 })
    const input = [
      dup,
      card({ id: 'dup2', name: '暮光小灯', starRank: 1, createdAt: 200 }),
      card({ id: 'dup3', name: '暮光小灯', starRank: 1, createdAt: 100 }),
      card({ id: 'otherA', name: '星河蛟鲨', starRank: 5, createdAt: 50 }),
      card({ id: 'otherB', name: '暮棘灵灯', starRank: 7, createdAt: 25 }),
    ]
    const roster = pondRosterOf(input)
    expect(roster.length).toBe(5) // every card is a fish, no folding
    const geom = pondWorldFor(roster.length, e.w, e.h)
    e.stockPond(pondStock(roster, geom.worldW, geom.worldH), geom.worldW, geom.worldH)
    expect(e.creatures.length).toBe(5)
  })
})

// -- v46 pond auto-tour -------------------------------------------------
// setPondWander(true) makes the engine cruise toward random waypoints in
// pond mode; off keeps the camera parked. The wander block lives inside
// the pond branch of step() only — ocean-mode behavior is untouched.
describe('OceanEngine.setPondWander (v46 auto-tour)', () => {
  it('armed: camera moves within the world bounds and leaves (0,0) within 300 frames', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    expect(e.pondWW).toBe(1200)
    expect(e.pondWH).toBe(1800)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
    e.setPondWander(true)
    // The 1.5s grace window delays the first waypoint — step 300 frames
    // at 1/60s (~5s) so the camera has had time to actually move.
    for (let i = 0; i < 300; i += 1) e.step(1 / 60)
    const maxX = 1200 - 400
    const maxY = 1800 - 600
    expect(e.camX).toBeGreaterThanOrEqual(0)
    expect(e.camX).toBeLessThanOrEqual(maxX)
    expect(e.camY).toBeGreaterThanOrEqual(0)
    expect(e.camY).toBeLessThanOrEqual(maxY)
    // A successful wander must actually have moved (otherwise the picker
    // would silently no-op and the user would never see the world).
    expect(e.camX + e.camY).toBeGreaterThan(0)
  })

  it('disarmed: camera is pinned after a manual pan and stays still across many steps', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    e.panPond(500, 800)
    const beforeX = e.camX; const beforeY = e.camY
    e.setPondWander(false)
    for (let i = 0; i < 300; i += 1) e.step(1 / 60)
    expect(e.camX).toBe(beforeX)
    expect(e.camY).toBe(beforeY)
  })

  it('1×1 world (maxX=maxY=0): camera stays at (0,0) no matter the wander flag', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 400, 600) // world == viewport → panning is a no-op
    expect(e.pondWW).toBe(400)
    expect(e.pondWH).toBe(600)
    e.setPondWander(true)
    for (let i = 0; i < 300; i += 1) e.step(1 / 60)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })

  it('no pond world (legacy mode, pondWW=0): wander block short-circuits, camera untouched', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([]) // legacy call → pondWW/pondWH stay 0
    e.setPondWander(true)
    for (let i = 0; i < 60; i += 1) e.step(1 / 60)
    expect(e.camX).toBe(0)
    expect(e.camY).toBe(0)
  })
})

// -- v44 ambient fauna ---------------------------------------------------
// stockPond auto-populates a background school (fish / shrimp / crab /
// eel). The ambient list is independent of the diver's catch (creatures)
// but shares stepPondCreature for physics. The contract here locks the
// count, the kind recipe, the lane clamps for the floor-hugging fauna,
// and the resize invariance.
describe('OceanEngine.ambient (v44 pond background fauna)', () => {
  it('1-screen stockPond populates exactly 8 ambient creatures (4 fish / 2 shrimp / 1 crab / 1 eel)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([])
    expect(e.ambient.length).toBe(8)
    const kinds = e.ambient.map((c) => c.kind)
    expect(kinds.filter((k) => k === 'fish').length).toBe(4)
    expect(kinds.filter((k) => k === 'shrimp').length).toBe(2)
    expect(kinds.filter((k) => k === 'crab').length).toBe(1)
    expect(kinds.filter((k) => k === 'eel').length).toBe(1)
  })

  it('v45 ambient sprite wiring: each fish carries spriteKey="minnow", each eel carries spriteKey="swamp_eel"', () => {
    // The engine stamps spriteKey on the fish + eel ambient slots so
    // drawFaunaSprite tries the painted minnow / swamp_eel sprites
    // first. shrimp + crab's kind IS the sprite key, so they need no
    // explicit stamp (the existing fallback chain still works for them).
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([])
    expect(e.ambient.length).toBe(8)
    const fish = e.ambient.filter((c) => c.kind === 'fish')
    const eels = e.ambient.filter((c) => c.kind === 'eel')
    expect(fish.length).toBe(4)
    expect(eels.length).toBe(1)
    for (const c of fish) expect(c.spriteKey).toBe('minnow')
    expect(eels[0]?.spriteKey).toBe('swamp_eel')
  })

  it('v45 ambient: shrimp + crab ambient slots do NOT carry an explicit spriteKey (kind is the key)', () => {
    // The recipe's spriteKey field is undefined for shrimp/crab —
    // drawFaunaSprite uses c.kind (which is 'shrimp' / 'crab') as the
    // sprite key. The 'shrimp' / 'crab' sprites are loaded alongside
    // 'minnow' / 'swamp_eel' by loadFaunaSprites (FAUNA_KINDS widened
    // in v45). Lock the absence so a future refactor doesn't double up.
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([])
    for (const c of e.ambient) {
      if (c.kind === 'shrimp' || c.kind === 'crab') {
        expect(c.spriteKey).toBeUndefined()
      }
    }
  })

  it('a large world stock caps the ambient population at 80', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 4000, 4000) // 4000*4000 / 400*600 ≈ 66.7 screens → 8×66 = 528 → capped at 80
    expect(e.ambient.length).toBe(80)
  })

  it('ambient stays independent of the diver\'s catch (separate arrays)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    const stocked = [
      { zone: 0, kind: 'fish', x: 100, y: 300, vx: 1, size: 20, hue: 28, phase: 0 } as Creature,
      { zone: 0, kind: 'turtle', x: 200, y: 400, vx: -1, size: 20, hue: 28, phase: 0 } as Creature,
    ]
    e.stockPond(stocked)
    expect(e.creatures.length).toBe(2)
    expect(e.ambient.length).toBe(8)
    // The catch is NOT in the ambient list, and vice-versa.
    const ambientIds = new Set(e.ambient.map((c) => c.kind))
    expect(ambientIds.has('turtle')).toBe(false)
    // And every ambient is one of the four recipes.
    for (const c of e.ambient) {
      expect(['fish', 'shrimp', 'crab', 'eel']).toContain(c.kind)
    }
  })

  it('crab lanes nail the soil seam: y is within [floorTop-5, floorTop+1] regardless of world size', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    const floorTop = 1800 * 0.986 // pondFloorY(1800)
    for (const c of e.ambient) {
      if (c.kind === 'crab') {
        expect(c.y).toBeGreaterThanOrEqual(floorTop - 5)
        expect(c.y).toBeLessThanOrEqual(floorTop + 1)
      }
    }
  })

  it('ambient respects its lane after a step() (no creature escapes the floor band)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    for (let i = 0; i < 30; i += 1) e.step(1 / 60)
    const floorTop = 1800 * 0.986
    for (const c of e.ambient) {
      if (c.kind === 'crab') {
        expect(c.y).toBeGreaterThanOrEqual(floorTop - 5)
        expect(c.y).toBeLessThanOrEqual(floorTop + 1)
      }
      if (c.kind === 'shrimp') {
        expect(c.y).toBeGreaterThanOrEqual(floorTop - 0.06 * 1800 - 1) // tiny epsilon
        expect(c.y).toBeLessThanOrEqual(floorTop - 0.015 * 1800 + 1)
      }
      if (c.kind === 'eel') {
        expect(c.y).toBeGreaterThanOrEqual(floorTop - 0.10 * 1800 - 1)
        expect(c.y).toBeLessThanOrEqual(floorTop - 0.03 * 1800 + 1)
      }
    }
  })

  it('ambient x wraps on the WORLD width (not the viewport) for multi-screen ponds', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    const c = e.ambient[0]
    if (c === undefined) throw new Error('expected first ambient')
    c.x = 1500 // > worldW 1200 + 50 → wraps
    e.step(1 / 60)
    expect(c.x).toBe(-40) // wrap via the >worldW+50 branch
  })

  it('resize kx/ky-scales ambient (y, x, laneLo, laneHi) the same way as the catch', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 1200, 1800)
    // Snapshot every ambient's geometry.
    const snap = e.ambient.map((c) => ({ x: c.x, y: c.y, lo: c.laneLo, hi: c.laneHi }))
    e.resize(800, 1200, 1) // double viewport → kx=2, ky=2
    const kx = 2; const ky = 2
    for (let i = 0; i < e.ambient.length; i += 1) {
      const c = e.ambient[i]
      const b = snap[i]
      if (c === undefined || b === undefined) continue
      expect(c.x).toBeCloseTo(b.x * kx, 6)
      expect(c.y).toBeCloseTo(b.y * ky, 6)
      if (b.lo !== undefined && c.laneLo !== undefined) {
        expect(c.laneLo).toBeCloseTo(b.lo * ky, 6)
      }
      if (b.hi !== undefined && c.laneHi !== undefined) {
        expect(c.laneHi).toBeCloseTo(b.hi * ky, 6)
      }
    }
  })

  // v44 review (GLM): ambientFrac originally parsed as `(hash>>>shift) &
  // (0x3ff/0x3ff) = (hash>>>shift) & 1` because `/` binds tighter than `&`
  // — every ambient then collapsed to x=0, size=min, hue=min. Existing
  // count/lane/wrap assertions all stayed green because they don't sample
  // the distribution. These two cases lock the hash spread so the
  // precedence regression can't sneak back unnoticed.
  it('hash spread is healthy on a 1-screen pond (8 ambient creatures, not all stacked at x=0)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([])
    expect(e.ambient.length).toBe(8)
    const xs = e.ambient.map((c) => c.x)
    const sizes = e.ambient.map((c) => c.size)
    // None of the 8 creatures shares its x with all the others; the
    // operator-precedence bug gave x === 0 for every creature.
    expect(new Set(xs).size).toBeGreaterThanOrEqual(6)
    // Size draws from a 5–11 / 5–8 / 9–13 / 10–15 range — at least 3
    // distinct values across the 8 creatures.
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(3)
    // And explicitly: no creature sits at exactly x === 0.
    expect(e.ambient.every((c) => c.x > 0)).toBe(true)
  })

  it('hash spread stays healthy on a large world (80 ambient creatures, distinct xs >= 50)', () => {
    const e = new OceanEngine()
    e.resize(400, 600, 1)
    e.stockPond([], 4000, 4000) // 80 creatures (capped)
    expect(e.ambient.length).toBe(80)
    const xs = e.ambient.map((c) => c.x)
    // 80 distinct buckets from a 10-bit hash window is already too
    // strict; require at least 50 so the precedence regression (which
    // gives 1 unique value) is loud-failing.
    expect(new Set(xs).size).toBeGreaterThanOrEqual(50)
  })
})