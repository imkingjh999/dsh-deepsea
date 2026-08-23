/** Regression: the painted-sprite path in drawCreature must not leak
 * canvas state. The original bug returned from between ctx.save() and
 * ctx.restore(), so every sprite creature leaked one save per frame —
 * transforms accumulated until the ocean rendered sideways and pond
 * fish flew off-canvas. Balance + per-creature drawImage are locked here.
 *
 * v44 ambient note: stockPond([]) now ALSO populates the ambient fauna
 * (8 creatures per screen: 4 fish + 2 shrimp + 1 crab + 1 eel). With no
 * world dim the engine falls back to the viewport → screens=1 → 8
 * ambient. Only 'fish' has a sprite in the fake sprite bag, so 4 of
 * those 8 ambient creatures also use the sprite path. Total sprite draws
 * per frame = 3 (stocked) + 4 (ambient fish) = 7; over 5 frames = 35.
 * shrimp/crab are procedural-only (no sprite in fauna.ts); eel also
 * falls back to procedural here because the test sprite bag only has
 * 'fish'. The save/restore balance assertion is unchanged. */
import { describe, expect, it } from 'vitest'
import { OceanEngine, type Creature } from '../src/client/engine.ts'
import type { FaunaSprites } from '../src/client/fauna.ts'

const noop = (): void => {}

interface Counts { save: number, restore: number, drawImage: number }

function makeCtx(): { ctx: CanvasRenderingContext2D, counts: Counts } {
  const counts: Counts = { save: 0, restore: 0, drawImage: 0 }
  const ctx = {
    save: () => { counts.save += 1 },
    restore: () => { counts.restore += 1 },
    drawImage: () => { counts.drawImage += 1 },
    createLinearGradient: () => ({ addColorStop: noop }),
    translate: noop, scale: noop, rotate: noop,
    beginPath: noop, arc: noop, ellipse: noop,
    fill: noop, stroke: noop, fillRect: noop,
    moveTo: noop, lineTo: noop, quadraticCurveTo: noop, closePath: noop,
    setTransform: noop,
    filter: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    shadowColor: '', shadowBlur: 0,
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, counts }
}

const creature = (x: number, y: number): Creature => ({
  zone: 0, kind: 'fish', x, y, vx: 1, size: 20, hue: 28, phase: 0,
})

const fakeSprite = { complete: true, naturalWidth: 256, naturalHeight: 128 } as unknown as HTMLImageElement
const sprites: FaunaSprites = new Map([['fish', fakeSprite]])

describe('fauna sprite rendering keeps canvas state balanced', () => {
  it('balances save/restore and draws every creature across repeated frames', () => {
    const engine = new OceanEngine()
    engine.resize(400, 600, 1)
    engine.setSprites(sprites)
    engine.stockPond([creature(100, 300), creature(200, 400), creature(300, 500)])
    const { ctx, counts } = makeCtx()
    for (let frame = 0; frame < 5; frame += 1) {
      engine.draw(ctx)
      expect(counts.save).toBe(counts.restore)
    }
    expect(counts.drawImage).toBe(35)
  })
})
