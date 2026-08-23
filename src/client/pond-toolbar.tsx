/**
 * pond-toolbar.tsx — the FishPond's top control strip, carved out of
 * pond.tsx (v47): title · ocean switcher · wander toggle · zoom trio
 * (＋ / live % as reset / −) · mute · back. Purely presentational —
 * every action arrives as a callback prop. aria-labels stay English
 * for stable test selectors; visible labels go through the locale
 * table (Chinese default).
 */
import React from 'react'
import { tr } from './locale.ts'
import { OceanSwitcher } from './ocean-switch.tsx'
import { SceneToggle, type SceneId } from './scene-toggle.tsx'

/** Shared chrome look for the pond's small buttons (unchanged from the
 * styles previously inlined in pond.tsx). */
const chip = {
  pointerEvents: 'auto' as const,
  background: 'rgba(10,30,50,.6)',
  color: '#cfe6fa',
  border: '1px solid rgba(120,180,230,.3)',
  borderRadius: 6, fontSize: 11,
  padding: '4px 10px', cursor: 'pointer',
}

export function PondToolbar(props: {
  count: number
  oceanId: string
  onPickOcean: (nextId: string) => void
  isPannable: boolean
  wanderOn: boolean
  onToggleWander: () => void
  /** v47 zoom: current zoom factor (1 = native) drives the % readout. */
  zoom: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  muted: boolean
  onToggleMute: () => void
  onClose: () => void
  /** v49: three-way scene switcher (replaces the back button). */
  scene: SceneId
  onScene: (next: SceneId) => void
}): React.ReactNode {
  const p = props
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4,
      padding: '6px 10px', flex: '0 0 auto', minHeight: 36,
      background: 'rgba(1,5,12,.92)',
      borderBottom: '1px solid rgba(42,84,132,.45)',
    }}>
      {/* v49.1: the scene toggle leads every toolbar (user: 三个场景都在
        * 左上角) — title and the rest follow it. */}
      <SceneToggle scene={p.scene} onPick={p.onScene} />
      <span style={{ fontSize: 12, color: 'rgba(180,215,245,.9)', whiteSpace: 'nowrap' }}>
        {tr('pond.title')} {'·'} {p.count}
      </span>
      <OceanSwitcher oceanId={p.oceanId} compact onPick={p.onPickOcean} />
      {p.isPannable && (
        <button
          type="button"
          aria-label="deepsea-pond-wander"
          onClick={() => { p.onToggleWander() }}
          style={{
            ...chip,
            background: p.wanderOn ? 'rgba(20,52,90,.7)' : chip.background,
          }}
        >
          {p.wanderOn ? '⏸' : '▶'} {tr('pond.wander')}
        </button>
      )}
      {/* v47 zoom trio: ＋ / live percentage (click = reset) / −. The %
        * chip doubles as the reset button so the strip gains zoom without
        * growing a fourth wide control. */}
      <button type="button" aria-label="deepsea-pond-zoom-in" title={tr('pond.zoomIn')}
        onClick={() => { p.onZoomIn() }} style={chip}>＋</button>
      <button type="button" aria-label="deepsea-pond-zoom-reset" title={tr('pond.zoomReset')}
        onClick={() => { p.onZoomReset() }}
        style={{ ...chip, padding: '4px 6px', fontFamily: 'ui-monospace, monospace' }}>
        {Math.round(p.zoom * 100)}%
      </button>
      <button type="button" aria-label="deepsea-pond-zoom-out" title={tr('pond.zoomOut')}
        onClick={() => { p.onZoomOut() }} style={chip}>－</button>
      <button
        type="button"
        aria-label="deepsea-pond-mute"
        onClick={() => { p.onToggleMute() }}
        style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 5 }}
      >
        <span style={{ fontSize: 10, color: 'rgba(207,230,250,.75)', letterSpacing: 1 }}>Alt+M</span>
        {p.muted ? '🔇' : '🔊'}
      </button>
      <span style={{ flex: 1 }} />
    </div>
  )
}
