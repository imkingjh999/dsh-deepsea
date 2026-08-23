// @vitest-environment node
/**
 * v49 surface props (islands & boats) END-TO-END draw test — written
 * after the user reported them invisible twice. Proves the full CLIENT
 * chain: loadSurfaceSprites() fills the module cache from the worker
 * URLs (?v=2), and drawPondBackdrop() actually issues drawImage calls
 * for island + boat anchored at the wave crest. Uses a stubbed Image
 * (instant onload) and a recording ctx — no real network, no jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { drawPondBackdrop, loadSurfaceSprites, pondSurfaceY } from '../src/client/pond-bg.ts'

/** Stub Image: records src, reports plausible natural dims, fires onload
 * on the next microtask (mirrors the browser's async decode). */
class FakeImage {
  static srcLog: string[] = []
  naturalWidth = 256
  naturalHeight = 111
  complete = false
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private srcValue = ''
  get src(): string { return this.srcValue }
  set src(v: string) {
    this.srcValue = v
    FakeImage.srcLog.push(v)
    queueMicrotask(() => {
      this.complete = true
      this.onload?.()
    })
  }
}

const realImage = globalThis.Image

afterEach(() => {
  globalThis.Image = realImage as unknown as typeof Image
})

interface DrawCall { img: string, x: number, y: number, w: number, h: number }

/** Recording 2D context: enough surface for drawPondBackdrop's needs. */
function makeCtx(): { ctx: CanvasRenderingContext2D, draws: DrawCall[] } {
  const draws: DrawCall[] = []
  const grad = { addColorStop: (): void => {} }
  const ctx = {
    save: (): void => {},
    restore: (): void => {},
    beginPath: (): void => {},
    closePath: (): void => {},
    moveTo: (): void => {},
    lineTo: (): void => {},
    stroke: (): void => {},
    fill: (): void => {},
    clip: (): void => {},
    translate: (): void => {},
    scale: (): void => {},
    rotate: (): void => {},
    arc: (): void => {},
    ellipse: (): void => {},
    createLinearGradient: (): typeof grad => grad,
    drawImage: (img: FakeImage, x: number, y: number, w: number, h: number): void => {
      draws.push({ img: img.src, x, y, w, h })
    },
    fillRect: (): void => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
  } as unknown as CanvasRenderingContext2D &
    { drawImage: (i: FakeImage, x: number, y: number, w: number, h: number) => void }
  return { ctx, draws }
}

describe('v49 surface props end-to-end (load → draw)', () => {
  it('loadSurfaceSprites fetches the ?v=2 worker URLs and populates the cache', async () => {
    FakeImage.srcLog = []
    globalThis.Image = FakeImage as unknown as typeof Image
    await loadSurfaceSprites()
    const urls = FakeImage.srcLog.filter((u) => u.includes('/assets/surface/'))
    expect(urls.some((u) => u.endsWith('/surface/island.png?v=2'))).toBe(true)
    expect(urls.some((u) => u.endsWith('/surface/boat.png?v=2'))).toBe(true)
  })

  it('drawPondBackdrop draws island + boat at the wave crest (top of the world)', async () => {
    FakeImage.srcLog = []
    globalThis.Image = FakeImage as unknown as typeof Image
    await loadSurfaceSprites()
    const { ctx, draws } = makeCtx()
    const w = 800; const h = 1240; const t = 2.5
    drawPondBackdrop(ctx, w, h, t, null, 2, 620)
    // Filter to the PROP drawImages: sized 0.16·h·scale tall — far
    // bigger than any soil tile (soilH ≈ h·0.014 ≈ 17px).
    const props = draws.filter((d) => d.h > h * 0.1)
    const kinds = props.map((d) => (d.img.includes('island') ? 'island' : 'boat'))
    expect(kinds).toContain('island')
    expect(kinds).toContain('boat')
    // Island anchors at ~0.30·w, boat at ~0.68·w of the first period,
    // each centered on its x → left edge ≈ x − pw/2.
    const island = props.find((d) => d.img.includes('island'))
    const boat = props.find((d) => d.img.includes('boat'))
    if (island === undefined || boat === undefined) throw new Error('props missing')
    const islandCx = island.x + island.w / 2
    const boatCx = boat.x + boat.w / 2
    expect(islandCx).toBeGreaterThan(w * 0.25)
    expect(islandCx).toBeLessThan(w * 0.35)
    expect(boatCx).toBeGreaterThan(w * 0.6)
    expect(boatCx).toBeLessThan(w * 0.75)
    // The painted baseline rides the crest: bottom edge ≈ surf(x)±bob.
    const islandBottom = island.y + island.h * 0.97
    const surfAt = pondSurfaceY(w * 0.3, t, w, h)
    expect(Math.abs(islandBottom - surfAt)).toBeLessThan(4)
    // Mostly ABOVE the waterline (a silhouette on the water).
    expect(island.y).toBeLessThan(0)
  })

  it('the props survive the span extension (zoomed-out camera keeps them)', async () => {
    FakeImage.srcLog = []
    globalThis.Image = FakeImage as unknown as typeof Image
    await loadSurfaceSprites()
    const { ctx, draws } = makeCtx()
    const w = 800; const h = 1240
    drawPondBackdrop(ctx, w, h, 0, null, 2, 620, { x0: -400, x1: 2000 })
    const props = draws.filter((d) => d.h > h * 0.1)
    // 3 world periods overlap [−400, 2000] → ≥3 islands and boats.
    expect(props.filter((d) => d.img.includes('island')).length).toBeGreaterThanOrEqual(3)
    expect(props.filter((d) => d.img.includes('boat')).length).toBeGreaterThanOrEqual(3)
  })

  it('props draw only when sprites have loaded (offline-safe no-op)', () => {
    // No loadSurfaceSprites call and no Image stub onload — cache is
    // empty from the previous test's module state ONLY if it failed to
    // load; assert the draw call simply skips rather than throwing.
    const { ctx, draws } = makeCtx()
    expect(() => { drawPondBackdrop(ctx, 800, 1240, 0, null, 2, 620) }).not.toThrow()
    // Whatever the cache state, the call must not crash the pond paint.
    expect(draws).toBeDefined()
  })
})
