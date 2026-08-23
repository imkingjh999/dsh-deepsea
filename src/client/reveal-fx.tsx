/**
 * Card reveal ceremony: a staged animation that scales with rarity —
 * COMMON fades in gently; RARE bursts a ring; EPIC adds rotating rays;
 * LEGENDARY gets the gold treatment with sparkles and a screen shake;
 * a gold foil card adds the golden flash + ribbon, and the ultimate
 * 金色传说 stacks everything with a rainbow sweep. Voice lines and the
 * open/gold stings ride the same timeline via the audio bus.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, CSSProperties } from 'react'
import type { CardRecord } from './depth.ts'
import { rarityMeta } from './depth.ts'
import { CardFace } from './cards.tsx'
import { audioBus, voiceClipFor } from './audio.ts'
import { isEn, tr } from './locale.ts'

export interface RevealPlan {
  /** 0 COMMON … 3 LEGENDARY, 4 = gold LEGENDARY (max). */
  level: number
  shake: boolean
  rainbow: boolean
  particles: number
}

/** Pure rarity→spectacle mapping (unit-tested). */
export function revealPlan(rarity: string, gold: boolean): RevealPlan {
  const level = gold && rarity === 'LEGENDARY' ? 4
    : rarity === 'LEGENDARY' ? 3
      : rarity === 'EPIC' ? 2 : rarity === 'RARE' ? 1 : 0
  return {
    level,
    shake: level >= 3 || (gold && level >= 2),
    rainbow: level >= 4,
    particles: level === 0 ? (gold ? 8 : 0) : level === 1 ? 10 : level === 2 ? 14 : level === 3 ? 18 : 26,
  }
}

const REVEAL_CSS: string = [
  '@keyframes ds-rev-rise { from { transform: translateY(64px) rotate(-7deg) scale(.7); opacity: 0 }',
   'to { transform: translateY(0) rotate(0) scale(1); opacity: 1 } }',
  '@keyframes ds-rev-flip { from { transform: rotateY(92deg) scale(.94) } to { transform: rotateY(0) scale(1) } }',
  '@keyframes ds-rev-flash { 0% { opacity: 0 } 22% { opacity: .95 } 100% { opacity: 0 } }',
  '@keyframes ds-rev-ring { from { transform: scale(.15); opacity: .9 } to { transform: scale(2.7); opacity: 0 } }',
  '@keyframes ds-rev-rays { to { transform: rotate(1turn) } }',
  '@keyframes ds-rev-shake { 0%,100% { transform: translate(0,0) } 12% { transform: translate(-7px,4px) }',
   '25% { transform: translate(6px,-5px) } 37% { transform: translate(-5px,-3px) }',
   '50% { transform: translate(7px,3px) }',
   '62% { transform: translate(-6px,5px) } 75% { transform: translate(5px,-4px) }',
   '87% { transform: translate(-3px,2px) } }',
  '@keyframes ds-rev-bubble { 0% { transform: translateY(0) scale(.6); opacity: 0 }',
   '18% { opacity: .5 } 100% { transform: translateY(-190px) scale(1.15); opacity: 0 } }',
  '@keyframes ds-rev-fly { 0% { transform: translate(0,0) scale(1); opacity: 1 }',
   '100% { transform: translate(var(--tx), var(--ty)) scale(.25); opacity: 0 } }',
  '@keyframes ds-rev-text { from { opacity: 0; transform: translateY(10px) }',
  'to { opacity: 1; transform: translateY(0) } }',
  '@keyframes ds-rev-ribbon { 0% { transform: translateX(-120%) skewX(-18deg) }',
  '100% { transform: translateX(320%) skewX(-18deg) } }',
].join(' ')

const BUBBLE_X = [12, 26, 38, 55, 67, 79, 90, 45]
const BUBBLE_D = [0, 1.1, 0.5, 1.7, 0.8, 0.2, 1.4, 2.0]
function conicRays(color: string): string {
  const stops: string[] = []
  for (let k = 0; k < 12; k++) {
    const a = k * 30
    const beam = k % 2 === 0 ? color + '26' : 'rgba(255,255,255,.13)'
    stops.push('transparent ' + (a + 6) + 'deg ' + (a + 13) + 'deg')
    stops.push(beam + ' ' + (a + 15) + 'deg ' + (a + 24) + 'deg')
  }
  return 'conic-gradient(from 0deg, ' + stops.join(', ') + ')'
}

function Rays(props: { rainbow: boolean, color: string, delay: number }): ReactNode {
  const bg = props.rainbow
    ? 'conic-gradient(from 0deg, rgba(255,128,0,.16), rgba(255,200,80,.14),'
      + ' rgba(163,53,238,.13), rgba(61,158,255,.13), rgba(255,128,0,.16))'
    : conicRays(props.color)
  return (
    <div style={{ position: 'absolute', left: '50%', top: '42%', width: 560, height: 560,
      marginLeft: -280, marginTop: -280, borderRadius: '50%', background: bg,
      pointerEvents: 'none', mixBlendMode: 'screen',
      animation: 'ds-rev-rays ' + (props.rainbow ? '5s' : '9s') + ' linear infinite',
      animationDelay: props.delay + 's' }} />
  )
}

export function CardReveal(props: { card: CardRecord, onClose: () => void }): ReactNode {
  const meta = rarityMeta(props.card.rarity)
  const gold = props.card.gold === true
  const plan = revealPlan(props.card.rarity, gold)
  const [stage, setStage] = useState(0) // 0 rise · 1 burst · 2 settled
  const [muted, setMuted] = useState(audioBus.muted)
  const timers = useRef<number[]>([])

  useEffect(() => {
    audioBus.sfx('open')
    timers.current.push(window.setTimeout(() => {
      setStage(1)
      if (gold) audioBus.sfx('gold')
    }, 560))
    timers.current.push(window.setTimeout(() => {
      const clip = voiceClipFor(props.card.rarity, gold, isEn())
      if (clip !== null) audioBus.voice(clip, isEn())
    }, 760))
    timers.current.push(window.setTimeout(() => { setStage(2) }, 940))
    return () => { for (const t of timers.current) clearTimeout(t) }
  }, [props.card, gold])

  const parts: ReactNode[] = []
  for (let i = 0; i < plan.particles; i++) {
    const ang = (i * 137.508) * Math.PI / 180
    const dist = 70 + (i % 5) * 26;
    const tx = Math.round(Math.cos(ang) * dist)
    const ty = Math.round(Math.sin(ang) * dist)
    const size = 3 + (i % 3) * 2;
    const style: CSSProperties & Record<string, string | number> = {
      position: 'absolute', left: '50%', top: '42%', width: size, height: size,
      marginLeft: -size / 2, marginTop: -size / 2, borderRadius: '50%',
      background: plan.rainbow ? (i % 2 === 0 ? '#ffd27a' : meta.color) : (gold ? '#ffd27a' : meta.color),
      boxShadow: '0 0 ' + size * 2 + 'px 1px ' + (gold ? '#ffd27a' : meta.color),
      '--tx': tx + 'px', '--ty': ty + 'px',
      animation: 'ds-rev-fly .9s cubic-bezier(.14,.9,.3,1) ' + (i % 7) * 40 + 'ms both',
    }
    parts.push(<span key={i} style={style} />)
  }

  return (
    <div onClick={props.onClose} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(1,4,10,.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 10, cursor: 'pointer',
      overflow: 'hidden', backdropFilter: 'blur(4px)' }}>
      <style>{REVEAL_CSS}</style>
      <button type='button' aria-label='deepsea-reveal-sound' title={tr('hud.sound')}
        onClick={(e) => { e.stopPropagation(); setMuted(audioBus.toggleMute()) }}
        style={{ position: 'absolute', top: 8, right: 10, fontSize: 13, cursor: 'pointer',
          background: 'rgba(10,24,46,.85)', border: '1px solid #2a5484', color: '#bfe2ff',
          borderRadius: 8, padding: '3px 9px',
          display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 10, color: 'rgba(191,226,255,.75)', letterSpacing: 1 }}>Alt+M</span>
        {muted ? '\uD83D\uDD07' : '\uD83D\uDD0A'}
      </button>
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {BUBBLE_X.map((x, i) => (
          <span key={i} style={{ position: 'absolute', left: x + '%', bottom: -14,
            width: 5 + (i % 3) * 3, height: 5 + (i % 3) * 3,
            borderRadius: '50%', border: '1px solid rgba(150,200,255,.35)', background: 'rgba(120,180,255,.08)',
            animation: 'ds-rev-bubble 2.8s ease-in ' + BUBBLE_D[i] + 's infinite' }} />
        ))}
      </div>
      <div style={{ animation: plan.shake && stage >= 1 ? 'ds-rev-shake .55s ease-out' : undefined, display: 'flex',
        flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
          {stage >= 1 && plan.level >= 2 && <Rays rainbow={plan.rainbow} color={meta.color} delay={0} />}
          {stage >= 1 && plan.level >= 3 && <Rays rainbow={false} color={gold ? '#ffd27a' : meta.color} delay={-3} />}
          {stage === 1 && (
            <div style={{ position: 'absolute', left: '50%', top: '42%', width: 560, height: 560,
              marginLeft: -280, marginTop: -280,
              borderRadius: '50%', border: '2px solid ' + (gold ? 'rgba(255,210,122,.8)' : meta.color + 'cc'),
              animation: 'ds-rev-ring .8s cubic-bezier(.1,.7,.3,1) both', pointerEvents: 'none' }} />
          )}
          {stage === 1 && plan.level >= 3 && (
            <div style={{ position: 'absolute', left: '50%', top: '42%', width: 560, height: 560,
              marginLeft: -280, marginTop: -280,
              borderRadius: '50%', border: '2px solid rgba(255,255,255,.5)',
              animation: 'ds-rev-ring 1s cubic-bezier(.1,.7,.3,1) .12s both', pointerEvents: 'none' }} />
          )}
          {stage === 1 && (
            <div style={{ position: 'absolute', inset: 0, background: gold
              ? 'radial-gradient(circle at 50% 42%, rgba(255,225,150,.95), rgba(255,170,60,.35) 40%, transparent 70%)'
              : 'radial-gradient(circle at 50% 42%, rgba(255,255,255,.9), transparent 65%)',
              animation: 'ds-rev-flash .5s ease-out both', pointerEvents: 'none' }} />
          )}
          {stage >= 1 && parts}
          <div style={{ animation: stage === 0 ? 'ds-rev-rise .55s cubic-bezier(.2,.9,.3,1) both'
            : 'ds-rev-flip .34s cubic-bezier(.2,.8,.3,1) both', transformStyle: 'preserve-3d', perspective: 900,
            overflow: 'visible', zIndex: 2 }}>
            {stage === 0
              ? (
                <div style={{ width: 216, height: 313, borderRadius: 15, position: 'relative', overflow: 'hidden',
                  background: 'linear-gradient(150deg, #0a1a30 0%, #050b18 55%, #0a1f3d 100%)',
                  border: '2px solid ' + (gold ? 'rgba(255,210,122,.7)' : 'rgba(90,140,200,.4)'),
                  boxShadow: '0 12px 40px rgba(0,0,0,.7), 0 0 26px ' + (gold ? 'rgba(255,200,90,.35)' : meta.glow),
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', inset: '-40%',
                    background: 'conic-gradient(from 0deg, transparent 0 40%, rgba(140,190,255,.14) 50%,'
                      + ' transparent 60% 100%)',
                    animation: 'ds-rev-rays 6s linear infinite' }} />
                  <span style={{ fontSize: 44, color: gold ? '#ffd27a' : '#7fb2e8',
                    textShadow: '0 0 18px ' + (gold ? '#ffb340' : '#3d9eff') }}>✦</span>
                </div>
              )
              : <CardFace card={props.card} width={216} />}
          </div>
          {stage >= 2 && gold && (
            <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: '10%', left: '-30%', width: '36%', height: '80%',
                background: 'linear-gradient(90deg, transparent, rgba(255,214,120,.5), transparent)',
                animation: 'ds-rev-ribbon 2.6s ease-in-out infinite' }} />
            </div>
          )}
        </div>
        {stage >= 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, maxWidth: 320,
            animation: 'ds-rev-text .45s ease-out both' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#eef5ff', textShadow: '0 1px 6px rgba(0,0,0,.8)' }}>
              {gold && <span style={{ color: '#ffd27a', marginRight: 6 }}>金</span>}
              {props.card.name}
            </div>
            <div style={{ fontSize: 11, color: meta.color, fontWeight: 700 }}>{meta.zh} · {props.card.species}</div>
            <div style={{ fontSize: 11, lineHeight: 1.7, color: '#c6d9ee',
              padding: '0 14px', textAlign: 'center' }}>{props.card.story}</div>
            <div style={{ fontSize: 10, color: '#5f7c9e' }}>
              {tr('card.date')} {new Date(props.card.createdAt).toLocaleString()}
            </div>
            <div style={{ fontSize: 10, color: '#51677f' }}>{tr('reveal.tap')}</div>
          </div>
        )}
      </div>
    </div>
  )
}