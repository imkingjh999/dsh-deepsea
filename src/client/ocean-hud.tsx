/**
 * ocean-hud.tsx — the ocean app's presentational chrome, carved out of
 * ocean.tsx: the v46.1 unified top toolbar (card wall / sound / ocean
 * switcher / steer hint), the top-left depth HUD, and the center status
 * banner with its roll-theater detail row. Everything here is prop-driven;
 * engine, audio and API access stay in ocean.tsx / ocean-flow.ts.
 */
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { tr, isEn } from './locale.ts'
import { OceanSwitcher } from './ocean-switch.tsx'
import type { Zone } from './depth.ts'
import type { OceanStatus, RollInfo } from './ocean-flow.ts'
import { SceneToggle, type SceneId } from './scene-toggle.tsx'

/** Shared button look for the toolbar strip (moved verbatim from ocean.tsx). */
const btnStyle = {
  background: 'rgba(10,24,46,.85)', border: '1px solid #2a5484', color: '#bfe2ff',
  borderRadius: 8, fontSize: 11, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

// Once-per-app: inject the banner pop keyframe. The animation is purely
// visual, so a global tag is fine — React unmount cleans the DOM anyway
// and the rule is idempotent (append on each mount, harmlessly duplicate).
export function usePopStyle(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return
    const id = 'deepsea-pop-style'
    if (document.getElementById(id) !== null) return
    const el = document.createElement('style')
    el.id = id
    el.textContent = '@keyframes deepsea-pop { from { opacity: 0; transform: translateX(-50%) scale(0.6); }' +
      ' to { opacity: 1; transform: translateX(-50%) scale(1); } }'
    document.head.appendChild(el)
  }, [])
}

/** The v46.1 unified top toolbar (user: 也要统一) — same solid strip as
 * the pond/wall chrome. All controls on one bar at the window top; the
 * bottom gradient bar is gone. flexWrap is the narrow-host safety net.
 * Purely presentational: every action arrives as a callback prop. */
export function OceanToolbar(props: {
  cardsCount: number
  muted: boolean
  oceanId: string
  scene: SceneId
  onScene: (next: SceneId) => void
  onToggleMute: () => void
  onPickOcean: (nextId: string) => void
}): ReactNode {
  const { cardsCount, muted, oceanId, scene, onScene, onToggleMute, onPickOcean } = props
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4,
      padding: '6px 10px', flex: '0 0 auto', minHeight: 36,
      background: 'rgba(1,5,12,.92)',
      borderBottom: '1px solid rgba(42,84,132,.45)',
    }}>
      {/* v49: the wall/pond buttons became the three-way scene toggle
        * (user: 把海洋 卡墙 鱼池 弄成一个 toggle); the card count rides
        * the wall segment's title so the count is still one glance away. */}
      <span title={tr('hud.wall') + ' ' + cardsCount}>
        <SceneToggle scene={scene} onPick={onScene} />
      </span>
      <button type="button" aria-label="deepsea-sound" title={tr('hud.sound')}
        onClick={() => { onToggleMute() }}
        style={{ ...btnStyle, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 10, color: 'rgba(191,226,255,.75)', letterSpacing: 1 }}>Alt+M</span>
        {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
      </button>
      <OceanSwitcher oceanId={oceanId} onPick={onPickOcean} />
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: 'rgba(150,190,230,.45)' }}>
        {tr('hud.steer')}
      </span>
    </div>
  )
}

/** Top-left depth HUD: context occupancy % + zone name, plus the token
 * budget row when the session projects one. Pointer-transparent. */
export function OceanHud(props: {
  occPct: number | null
  zone: Zone | null
  used: number | null
  win: number | null
}): ReactNode {
  const { occPct, zone, used, win } = props
  return (
    <div style={{ position: 'absolute', top: 8, left: 10, display: 'flex', flexDirection: 'column', gap: 4,
       pointerEvents: 'none' }}>
      <div style={{ fontSize: 11, color: '#bfe2ff', textShadow: '0 1px 4px rgba(0,0,0,.8)' }}>
        {occPct === null ? tr('hud.noproject') : `${tr('hud.depth')} ${occPct}% · ${zone !== null ? (isEn() ?
           zone.en : zone.zh) : ''}`}
      </div>
      {used !== null && win !== null && (
        <div style={{ fontSize: 10, color: 'rgba(191,226,255,.75)', textShadow: '0 1px 4px rgba(0,0,0,.8)' }}>
          {fmtK(used)} / {fmtK(win)} {tr('hud.tokens')}
        </div>
      )}
    </div>
  )
}

/** Center status banner: touch / roll / grabbed / wriggled / too-soon /
 * fail, with the roll-theater detail row (spinning hex + mine-vs-target)
 * while a challenge roll is in flight. Moved verbatim from ocean.tsx. */
export function StatusBanner(props: {
  status: OceanStatus
  tooSoonMin: number
  rollInfo: RollInfo | null
  wrigFlavor: string
}): ReactNode {
  const { status, tooSoonMin, rollInfo, wrigFlavor } = props
  return (
    <>
      {status !== null && status !== 'idle' && (() => {
        const palette = {
          touch: { color: '#ffe9a3', glow: 'rgba(255,233,163,0.55)' },
          roll: { color: '#a3e4ff', glow: 'rgba(120,180,255,0.55)' },
          grabbed: { color: '#9dffb0', glow: 'rgba(110,255,150,0.55)' },
          wriggled: { color: '#ffb38a', glow: 'rgba(255,140,90,0.55)' },
          toosoon: { color: '#ff9db0', glow: 'rgba(255,120,160,0.55)' },
          fail: { color: '#ff9db0', glow: 'rgba(255,120,160,0.55)' },
        }[status]
        const textKey = status === 'touch' ? 'hud.touch'
          : status === 'roll' ? 'hud.roll'
          : status === 'grabbed' ? 'hud.grabbed'
          : status === 'wriggled' ? 'hud.wriggled'
          : status === 'toosoon' ? 'hud.toosoonwait'
          : 'hud.genfail'
        const raw = status === 'toosoon'
          ? tr(textKey).replace('{m}', String(tooSoonMin))
          // The roll-theater banner main line is driven by rollInfo.flavor
          // (one line from hud.rollpool) — falls back to hud.roll on the
          // rare frame where setStatus('roll') lands before setRollInfo.
          : status === 'roll'
            ? (rollInfo?.flavor ?? tr('hud.roll'))
            // wrigFlavor is picked once on the wriggled branch and stays
            // stable across re-renders. Empty when not yet chosen (e.g.
            // external setStatus('wriggled') paths).
            : status === 'wriggled'
              ? (wrigFlavor !== '' ? wrigFlavor : tr('hud.wriggled'))
              : tr(textKey)
        const prefix = status === 'roll' ? '🎲 ' : ''
        return (
          <div style={{
            position: 'absolute', top: '26%', left: '50%', transform: 'translateX(-50%)',
            padding: '10px 22px', background: 'rgba(2,6,15,0.72)', borderRadius: 14,
            color: palette.color, fontSize: 24, fontWeight: 800, lineHeight: 1.2, textAlign: 'center',
            textShadow: `0 0 12px ${palette.glow}, 0 1px 6px rgba(0,0,0,.85)`,
            pointerEvents: 'none', whiteSpace: 'nowrap',
            animation: 'deepsea-pop 0.25s ease-out',
            display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center',
          }}>
            <div style={{ whiteSpace: 'nowrap' }}>{prefix}{raw}</div>
            {status === 'roll' && rollInfo !== null && (
              <div style={{
                fontSize: 15, fontWeight: 700, letterSpacing: 3,
                fontFamily: 'ui-monospace, monospace', color: '#bfe2ff',
                display: 'flex', gap: 14, alignItems: 'baseline',
                whiteSpace: 'nowrap',
              }}>
                <span>🎲 {rollInfo.shown}</span>
                <span style={{ color: '#8fb8dd' }}>
                  {tr('hud.rollmine')} vs {tr('hud.rolltarget')} {rollInfo.target}
                </span>
              </div>
            )}
          </div>
        )
      })()}
    </>
  )
}
