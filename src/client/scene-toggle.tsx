/**
 * scene-toggle.tsx — the v49 three-way scene switcher (user: 把海洋
 * 卡墙 鱼池 弄成一个 toggle，切换三个场景). One segmented control in
 * every scene's toolbar: 🌊 海洋 · 🃏 卡墙 · 🐟 鱼池. The active scene
 * is highlighted; picking another switches scenes directly (no more
 * wall→pond→wall back-chaining). aria-labels stay English for stable
 * test selectors; visible labels go through the locale table.
 */
import React from 'react'
import { tr } from './locale.ts'

export type SceneId = 'ocean' | 'wall' | 'pond'

const SEGMENTS: ReadonlyArray<{ id: SceneId, glyph: string, labelKey: string, aria: string }> = [
  { id: 'ocean', glyph: '🌊', labelKey: 'scene.ocean', aria: 'deepsea-scene-ocean' },
  { id: 'wall', glyph: '🃏', labelKey: 'scene.wall', aria: 'deepsea-scene-wall' },
  { id: 'pond', glyph: '🐟', labelKey: 'scene.pond', aria: 'deepsea-scene-pond' },
]

/** Shared segment look so the toggle reads as one control in any
 * toolbar (ocean / wall / pond strips all use the same chip family). */
const seg = {
  background: 'rgba(10,30,50,.6)',
  color: '#cfe6fa',
  border: '1px solid rgba(120,180,230,.3)',
  fontSize: 11,
  padding: '4px 10px',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
}

export function SceneToggle(props: { scene: SceneId, onPick: (next: SceneId) => void }): React.ReactNode {
  return (
    <div
      aria-label="deepsea-scene-toggle"
      style={{ display: 'inline-flex', borderRadius: 6, overflow: 'hidden' }}
    >
      {SEGMENTS.map((m, i) => {
        const active = m.id === props.scene
        return (
          <button
            key={m.id}
            type="button"
            aria-label={m.aria}
            onClick={() => { if (!active) props.onPick(m.id) }}
            style={{
              ...seg,
              borderLeftWidth: i === 0 ? 1 : 0,
              background: active ? 'rgba(20,52,90,.85)' : seg.background,
              color: active ? '#eaf6ff' : seg.color,
              fontWeight: active ? 700 : 400,
            }}
          >
            {m.glyph} {tr(m.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
