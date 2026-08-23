/**
 * Rarity foil effects, Hearthstone-style: EPIC gets a purple breathing
 * glow; LEGENDARY gets the full orange-gold treatment — gold pulse +
 * rainbow conic sweep + twinkling sparkles (the classic legendary vibe).
 */
import type { ReactNode } from 'react'

export const RARITY_FX_CSS: string = [
  '@keyframes deepsea-epic-pulse { 0%,100% { box-shadow: 0 0 14px 2px rgba(163,53,238,.5),',
  ' 0 0 40px 8px rgba(163,53,238,.24) } 50% { box-shadow: 0 0 24px 5px rgba(190,90,255,.8),',
  ' 0 0 64px 15px rgba(163,53,238,.42) } }',
  '@keyframes deepsea-gold-pulse { 0%,100% { box-shadow: 0 0 18px 3px rgba(255,128,0,.55),',
  ' 0 0 48px 9px rgba(255,160,40,.3) } 50% { box-shadow: 0 0 30px 6px rgba(255,190,70,.85),',
  ' 0 0 76px 18px rgba(255,128,0,.45) } }',
  '@keyframes deepsea-ur-spin { to { transform: rotate(1turn) } }',
  '@keyframes deepsea-sparkle { 0%,100% { opacity: 0; transform: scale(.2) }',
  ' 40% { opacity: 1; transform: scale(1) } 60% { opacity: 1 } }',
].join(' ')

/** Sparkle dot positions (percent of card) for legendary foils. */
const SPARKLES: ReadonlyArray<{ x: number, y: number, delay: number, size: number }> = [
  { x: 14, y: 18, delay: 0, size: 5 }, { x: 82, y: 12, delay: 0.8, size: 4 },
  { x: 70, y: 62, delay: 1.6, size: 6 }, { x: 22, y: 74, delay: 2.2, size: 4 },
  { x: 48, y: 32, delay: 3.0, size: 5 }, { x: 88, y: 84, delay: 3.6, size: 5 },
]

/** Twinkling dots layer; mount inside a clipping container. */
export function SparkleLayer(props: { color: string }): ReactNode {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {SPARKLES.map((s, i) => (
        <span key={i} style={{
          position: 'absolute', left: s.x + '%', top: s.y + '%', width: s.size, height: s.size,
          borderRadius: '50%', background: props.color,
          boxShadow: '0 0 ' + s.size * 2 + 'px ' + s.size / 2 + 'px ' + props.color,
          animation: 'deepsea-sparkle 3.6s ' + s.delay + 's infinite',
        }} />
      ))}
    </div>
  )
}
