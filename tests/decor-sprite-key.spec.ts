/**
 * The decor sprite layer mirrors fauna: a module-scoped cache, a loader
 * that gracefully omits failed kinds, and a render-time draw that, for
 * seaweed + kelp + coral + starfish, paints nothing when the cache is
 * empty (sprite-only — no procedural fallback). This spec locks the
 * public shape (kinds + helpers + empty-cache no-op) so the engine,
 * the worker route regex, and the generator script all agree on the
 * key namespace.
 *
 * v45: coral + starfish joined seaweed + kelp as sprite kinds. soil
 * is loaded too (via loadDecorSprites) but is not a decor item — it
 * has no DECOR_SPRITE_HEIGHT entry. hasDecorSprite still works for
 * it but is only used by pond-bg's coral/starfish guard, never for
 * the soil itself (pond-bg reads it via getSoilSprite).
 */
import { describe, expect, it } from 'vitest'
import {
  DECOR_SPRITE_HEIGHT, drawDecorItem, hasDecorSprite, loadDecorSprites, type DecorSpriteKind,
} from '../src/client/decor.ts'

/** Route regex mirrors the worker's /assets/decor/<name>.png handler.
 * Anything sent by the client MUST pass this pattern or the worker
 * answers 404 — a stale (?v=1 / ?v=2) cache must never break the regex. */
const ROUTE = /^\/assets\/decor\/([a-z0-9_]+)\.png(?:\?.*)?$/

describe('decor sprite shape', () => {
  it('ships seaweed + kelp + coral + starfish as sprite kinds today (v45 widened the list)', () => {
    const kinds = Object.keys(DECOR_SPRITE_HEIGHT) as DecorSpriteKind[]
    expect(kinds.sort()).toEqual(['coral', 'kelp', 'seaweed', 'starfish'])
  })

  it('locks the worker route regex for /assets/decor/<name>.png', () => {
    expect('/assets/decor/seaweed.png?v=1'.match(ROUTE)?.[1]).toBe('seaweed')
    expect('/assets/decor/kelp.png'.match(ROUTE)?.[1]).toBe('kelp')
    expect('/assets/decor/kelp2.png'.match(ROUTE)?.[1]).toBe('kelp2')
    expect('/assets/decor/coral.png'.match(ROUTE)?.[1]).toBe('coral')
    expect('/assets/decor/starfish.png'.match(ROUTE)?.[1]).toBe('starfish')
    expect('/assets/decor/soil.png'.match(ROUTE)?.[1]).toBe('soil')
    // Pathological cases that must NOT match.
    expect('/assets/decor/../fauna.png'.match(ROUTE)).toBeNull()
    expect('/assets/decor/UPPER.png'.match(ROUTE)).toBeNull()
    expect('/assets/decor/seaweed.jpg'.match(ROUTE)).toBeNull()
  })

  it('pins the v39 shrunken sprite heights + the v45 coral / starfish heights', () => {
    expect(DECOR_SPRITE_HEIGHT.seaweed).toBe(1.1)
    expect(DECOR_SPRITE_HEIGHT.kelp).toBe(1.9)
    expect(DECOR_SPRITE_HEIGHT.coral).toBe(1.0)
    expect(DECOR_SPRITE_HEIGHT.starfish).toBe(0.5)
  })

  it('hasDecorSprite reports false before any load attempt (offline default)', () => {
    expect(hasDecorSprite('seaweed')).toBe(false)
    expect(hasDecorSprite('kelp')).toBe(false)
    expect(hasDecorSprite('coral')).toBe(false)
    expect(hasDecorSprite('starfish')).toBe(false)
  })

  it('loadDecorSprites resolves without throwing even when the worker is unreachable', async () => {
    // jsdom has no Image source fetching — the loader must still resolve
    // (each kind resolves individually, the load failure is swallowed).
    await expect(loadDecorSprites()).resolves.toBeUndefined()
  })

  it('drawDecorItem paints NOTHING for seaweed when the sprite cache is empty (sprite-only)', () => {
    // jsdom never triggers Image.onload — the cache stays empty. With no
    // procedural fallback, the renderer must short-circuit BEFORE issuing
    // a single drawing call. We count via spy methods on a stub ctx.
    const ctx = {
      save: () => { saveCount += 1 },
      restore: () => { restoreCount += 1 },
      beginPath: () => { beginPathCount += 1 },
      moveTo: () => { strokeCalls += 1 },
      quadraticCurveTo: () => { strokeCalls += 1 },
      stroke: () => { strokeCalls += 1 },
      drawImage: () => { drawImageCount += 1 },
      translate: () => { transforms += 1 },
      rotate: () => { transforms += 1 },
      scale: () => { transforms += 1 },
    } as unknown as CanvasRenderingContext2D
    let saveCount = 0
    let restoreCount = 0
    let beginPathCount = 0
    let strokeCalls = 0
    let drawImageCount = 0
    let transforms = 0
    drawDecorItem(ctx, { kind: 'seaweed', xFrac: 0.5, s: 1.0, seed: 1.2 }, 200, 480, 0, 40)
    expect(saveCount).toBe(0)
    expect(restoreCount).toBe(0)
    expect(beginPathCount).toBe(0)
    expect(strokeCalls).toBe(0)
    expect(drawImageCount).toBe(0)
    expect(transforms).toBe(0)
  })
})
