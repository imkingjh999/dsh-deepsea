/**
 * aspect.ts - geometry helper that keeps the ocean canvas at its
 * INITIAL aspect ratio: fit the largest rect with that ratio inside
 * a (possibly differently shaped) box. Window resizes then only ever
 * zoom the world uniformly (letterbox) instead of stretching it, so
 * the hook/fish control feel never changes with the window shape.
 * Invalid aspect or box sizes pass through unchanged.
 */
export function fitAspect(w: number, h: number, aspect: number): { w: number, h: number } {
  if (!(aspect > 0) || !(w > 0) || !(h > 0)) return { w, h }
  return w / h > aspect ? { w: h * aspect, h } : { w, h: w / aspect }
}