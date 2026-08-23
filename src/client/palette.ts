/** Zone water palette helpers — shared color sampling for the ocean
 * renderer (extracted from engine.ts). */
import { ZONES } from './depth.ts'

const rgbTriple = (s: string): [number, number, number] => {
  const m = s.match(/\d+/g)
  return [Number(m?.[0] ?? 0), Number(m?.[1] ?? 0), Number(m?.[2] ?? 0)]
}
const ZONE_TOP_RGB = ZONES.map((z) => rgbTriple(z.waterTop))
const ZONE_BOT_RGB = ZONES.map((z) => rgbTriple(z.waterBottom))

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** Water color at a world depth fraction (0 surface … 1 bottom), lerped inside each zone.
 * `tint` is the session ocean's additive RGB shift (see oceans.ts) — omit
 * for the historical untinted palette. The tint fades with depth so the
 * abyss stays black in every ocean. */
export function waterColorAt(t: number, tint?: { r: number, g: number, b: number }): string {
  const tt = clamp(t, 0, 0.999999)
  for (let i = ZONES.length - 1; i >= 0; i -= 1) {
    if (tt >= (ZONES[i]?.lo ?? 0)) {
      const lo = ZONES[i]?.lo ?? 0
      const hi = ZONES[i]?.hi ?? 1
      const f = clamp((tt - lo) / Math.max(hi - lo, 1e-6), 0, 1)
      const a = ZONE_TOP_RGB[i] ?? ZONE_TOP_RGB[0]!
      const b = ZONE_BOT_RGB[i] ?? ZONE_BOT_RGB[0]!
      const fade = tint !== undefined ? 1 - tt * 0.8 : 0
      const mix = (x: number, y: number, off: number): number => clamp(Math.round(lerp(x, y, f) + off * fade), 0, 255)
      return 'rgb(' + mix(a[0], b[0], tint?.r ?? 0) + ',' + mix(a[1], b[1], tint?.g ?? 0) + ','
        + mix(a[2], b[2], tint?.b ?? 0) + ')'
    }
  }
  return 'rgb(2,5,16)'
}
