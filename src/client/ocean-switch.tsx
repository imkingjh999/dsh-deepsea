/**
 * ocean-switch.tsx — the small `‹ 太平洋 ›` picker shared by the main
 * fish-tank scene, the card wall, and the fish pond. Each view embeds
 * one of these in its header so the diver can hop between oceans without
 * leaving wherever they are.
 *
 * Design contract (v46):
 *   - Pure presentational: the component never mutates the session ocean
 *     itself. Every caller receives `(nextId: string)` and is responsible
 *     for three things: `setSessionOcean(oceanById(next))`, then the view's
 *     own reaction (engine.setOcean for the main scene / pond, just audio
 *     for the card wall), then `audioBus.setBgmOcean(oceanById(next).id)`.
 *   - Looping: prev/next wrap around the five OCEANS list — the picker
 *     has no beginning or end. `nextOceanId(id, dir)` is exported as a
 *     pure helper so the wrap logic can be unit-tested without a DOM.
 *   - Compact + consistent: a single line with two small arrow buttons
 *     around the localized ocean name. Mirrors the pond / wall header
 *     small-button style (rgba deep-blue background, thin border, 11px
 *     font) so all three views feel like the same control in different
 *     chrome.
 */
import type { ReactNode } from 'react'
import { OCEANS, oceanById } from './oceans.ts'
import { tr } from './locale.ts'

/** Step the current ocean id in `dir` (1 = next, -1 = prev), wrapping
 * around the OCEANS list. Unknown ids clamp to the pacific anchor before
 * walking, so a stale session never strands the picker on a missing
 * ocean. Exported for tests. */
export function nextOceanId(id: string, dir: 1 | -1): string {
  const i = OCEANS.findIndex((o) => o.id === id)
  const start = i >= 0 ? i : 0
  const n = OCEANS.length
  const next = (start + (dir >= 0 ? 1 : -1) + n) % n
  return OCEANS[next]?.id ?? id
}

/** The compact `‹ 太平洋 ›` picker. `compact` (default false) drops the
 * ocean emoji so it fits inside the pond header without forcing a wider
 * row. Buttons carry stable aria-labels so the picker is keyboard-testable
 * from any view. */
export function OceanSwitcher(props: {
  oceanId: string
  onPick: (id: string) => void
  compact?: boolean
}): ReactNode {
  const id = oceanById(props.oceanId).id
  // pointerEvents 'auto' is REQUIRED: every host header that embeds this
  // switcher sets pointerEvents 'none' on its container (so the chrome
  // never eats canvas drags) and re-enables it per control. Without the
  // explicit auto here the arrows inherit none — clicks fall THROUGH the
  // header onto the pond canvas underneath, which reads them as drag
  // starts (pausing the auto-tour) and the ocean never switches.
  const style: React.CSSProperties = {
    background: 'rgba(10,24,46,.85)',
    border: '1px solid #2a5484',
    color: '#bfe2ff',
    borderRadius: 6,
    fontSize: 11,
    padding: '2px 8px',
    cursor: 'pointer',
    lineHeight: 1.6,
    pointerEvents: 'auto',
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button
        type="button"
        aria-label="deepsea-ocean-prev"
        onClick={() => { props.onPick(nextOceanId(id, -1)) }}
        style={style}
      >‹</button>
      <span style={{ fontSize: 11, color: 'rgba(191,226,255,.85)', whiteSpace: 'nowrap' }}>
        {props.compact === true ? '' : '🌊 '}{tr('ocean.' + id)}
      </span>
      <button
        type="button"
        aria-label="deepsea-ocean-next"
        onClick={() => { props.onPick(nextOceanId(id, 1)) }}
        style={style}
      >›</button>
    </span>
  )
}
