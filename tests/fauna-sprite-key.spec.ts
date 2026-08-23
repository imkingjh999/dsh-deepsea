/** drawFaunaSprite prefers the per-card sprite and falls back to the
 * kind sprite when the card sprite is missing (pond offline case).
 * v45 extended the chain: the engine stamps spriteKey 'minnow' on
 * pond ambient fish (and 'swamp_eel' on ambient eel); if those
 * painted sprites haven't loaded, drawFaunaSprite must still draw via
 * the kind sprite ('fish' / 'eel'). Lock the fall-back so a future
 * refactor can't silently drop the chain. */
import { describe, expect, it } from 'vitest'
import { drawFaunaSprite } from '../src/client/fauna.ts'

const noop = (): void => {}
const makeImg = (w: number, h: number): HTMLImageElement =>
  ({ complete: true, naturalWidth: w, naturalHeight: h }) as unknown as HTMLImageElement
const makeCtx = (): CanvasRenderingContext2D => ({
  save: noop, restore: noop, drawImage: noop, translate: noop, scale: noop, rotate: noop, filter: '',
}) as unknown as CanvasRenderingContext2D

describe('drawFaunaSprite spriteKey precedence', () => {
  it('uses the card sprite when present', () => {
    const cardImg = makeImg(100, 40)
    const kindImg = makeImg(200, 80)
    const sprites = new Map([['card-1', cardImg], ['fish', kindImg]])
    const drew = drawFaunaSprite(makeCtx(), { kind: 'fish', x: 0, y: 0, vx: 1,
      size: 10, phase: 0, hue: 100, spriteKey: 'card-1' }, sprites, 100)
    expect(drew).toBe(true)
  })

  it('falls back to the kind sprite when the card sprite is absent', () => {
    const kindImg = makeImg(200, 80)
    const sprites = new Map([['fish', kindImg]])
    const drew = drawFaunaSprite(makeCtx(), { kind: 'fish', x: 0, y: 0, vx: 1,
      size: 10, phase: 0, hue: 100, spriteKey: 'card-missing' }, sprites, 100)
    expect(drew).toBe(true)
  })

  it('returns false when neither sprite exists', () => {
    const drew = drawFaunaSprite(makeCtx(), { kind: 'viper', x: 0, y: 0, vx: 1,
      size: 10, phase: 0, hue: 100, spriteKey: 'card-x' }, new Map(), 100)
    expect(drew).toBe(false)
  })

  // v45 ambient fallback: pond fish carry spriteKey 'minnow' (the
  // painted ambient sprite). When 'minnow' is missing, drawFaunaSprite
  // must fall back to the kind sprite 'fish' so the existing v40
  // fish sprite keeps painting. Without this, the painted-sprite
  // first / kind-second chain would regress to "no sprite → no draw"
  // and ambient fish would vanish offline.
  it('v45 ambient fallback: spriteKey "minnow" missing → kind "fish" sprite wins', () => {
    const kindImg = makeImg(200, 80)
    const sprites = new Map([['fish', kindImg]])
    const drew = drawFaunaSprite(makeCtx(), { kind: 'fish', x: 0, y: 0, vx: 1,
      size: 10, phase: 0, hue: 100, spriteKey: 'minnow' }, sprites, 100)
    expect(drew).toBe(true)
  })

  it('v45 ambient fallback: spriteKey "swamp_eel" missing → kind "eel" sprite wins', () => {
    const kindImg = makeImg(200, 80)
    const sprites = new Map([['eel', kindImg]])
    const drew = drawFaunaSprite(makeCtx(), { kind: 'eel', x: 0, y: 0, vx: 1,
      size: 10, phase: 0, hue: 100, spriteKey: 'swamp_eel' }, sprites, 100)
    expect(drew).toBe(true)
  })
})
