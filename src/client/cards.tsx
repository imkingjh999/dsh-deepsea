/**
 * Card presentation: the holographic card face, the card wall, and the big
 * card modal.
 *
 * Hologram technique: the host pipeline bakes TWO decoration layers per card
 * with Python (scripts/holo.py) — a diffraction rainbow texture and an
 * elliptical specular mask. The DOM stacks art + diffraction
 * (mix-blend-mode: color-dodge, opacity driven by tilt) + mask
 * (mix-blend-mode: overlay, background-position sliding with the pointer).
 * Pointer position drives a spring-damped rotateX/rotateY so the sheen "flows"
 * across the foil as the card tilts — pure CSS compositing, no WebGL.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { rarityMeta, type CardRecord } from './depth.ts'

import { RARITY_FX_CSS, SparkleLayer } from './rarity-fx.tsx'
import { tr, isEn } from './locale.ts'
import { SceneToggle, type SceneId } from './scene-toggle.tsx'
import { ZONES } from './depth.ts'
import { uploadBattle } from './api.ts'
import { buildWallAlbum, RARITY_WEIGHT, SEAT_COUNT, SEAT_DISPLAY_ORDER, wallGrid, WALL_GAP } from './wall.ts'
import { oceanById, rollSessionOcean, setSessionOcean } from './oceans.ts'
import { audioBus } from './audio.ts'
import { OceanSwitcher } from './ocean-switch.tsx'

/** Card-wall hover: cards sit at full brightness by default; hovering gives
 * a gentle lift + slight brighten. Transitions (not animations) keep it
 * reversible and smooth in both directions. */
const WALL_HOVER_CSS = [
  '.deepsea-wall-card { filter: brightness(1);' +
    ' transition: filter .3s ease, transform .3s cubic-bezier(.16,1,.3,1) }',
  '.deepsea-wall-card:hover { filter: brightness(1.12);' +
    ' transform: translateY(-3px) scale(1.06); z-index: 2; position: relative }',
].join(' ')

/** One holographic card face. `width` px; height = width * 1.45.
 * `count` (>1) renders a ×N copies badge on the wall seat. */
export function CardFace(props: { card: CardRecord, width: number, onClick?: () => void, count?: number }): ReactNode {
  const meta = rarityMeta(props.card.rarity)
  const star = props.card.star ?? ''
  const starRank = props.card.starRank ?? 0
  const ref = useRef<HTMLDivElement | null>(null)
  const target = useRef({ rx: 0, ry: 0, gx: 50, gy: 50, on: false })
  const cur = useRef({ rx: 0, ry: 0, gx: 50, gy: 50 })
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const c = cur.current; const t = target.current
      c.rx += (t.rx - c.rx) * 0.16
      c.ry += (t.ry - c.ry) * 0.16
      c.gx += (t.gx - c.gx) * 0.2
      c.gy += (t.gy - c.gy) * 0.2
      if (Math.abs(t.rx - c.rx) + Math.abs(t.ry - c.ry) + Math.abs(t.gx - c.gx) > 0.05) setFrame((n) => (n + 1) % 4096)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf) }
  }, [])
  void frame

  const w = props.width
  const h = Math.round(w * 1.45)
  const c = cur.current
  const sheen = Math.min(Math.abs(c.ry) / 13 + Math.abs(c.rx) / 15, 1)
  const rarity = props.card.rarity
  const legendary = rarity === 'LEGENDARY'
  const epic = rarity === 'EPIC'
  const gold = props.card.gold === true

  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const rect = (ref.current ?? e.currentTarget).getBoundingClientRect()
        const px = (e.clientX - rect.left) / rect.width
        const py = (e.clientY - rect.top) / rect.height
        target.current = { rx: (0.5 - py) * 22, ry: (px - 0.5) * 26, gx: px * 100, gy: py * 100, on: true }
      }}
      onPointerLeave={() => { target.current = { ...target.current, rx: 0, ry: 0, on: false } }}
      onClick={props.onClick}
      style={{
        width: w, height: h, position: 'relative', borderRadius: Math.round(w * 0.07), overflow: 'hidden',
        transform: `perspective(900px) rotateX(${c.rx.toFixed(2)}deg) rotateY(${c.ry.toFixed(2)}deg)`,
        transformStyle: 'preserve-3d',
        border: gold ? '2px solid #ffd27a' : legendary ? '2px solid #ffb340' : `1.5px solid ${meta.color}`,
        boxShadow: legendary || epic
          ? undefined
          : `0 10px 30px rgba(0,0,0,.55), 0 0 ${Math.round(14 + sheen * 26)}px ${meta.glow}`,
        animation: legendary ? 'deepsea-gold-pulse 2.2s ease-in-out infinite'
          : epic ? 'deepsea-epic-pulse 2.4s ease-in-out infinite' : undefined,
        cursor: props.onClick !== undefined ? 'pointer' : 'default',
        background: '#05080f',
        willChange: 'transform',
      }}
    >
      <style>{RARITY_FX_CSS}</style>
      {/* copies badge — ×N when the diver owns more than one (wall seats) */}
      {props.count !== undefined && props.count > 1 && (
        <span style={{
          position: 'absolute', top: Math.max(3, w * 0.035), right: Math.max(3, w * 0.045), zIndex: 4,
          background: 'rgba(4,10,20,.85)', color: '#ffd27a',
          border: '1px solid rgba(255,210,122,.45)', borderRadius: 9,
          fontSize: Math.max(9, Math.round(w * 0.085)), fontWeight: 700,
          padding: '1px 6px', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
          pointerEvents: 'none', textShadow: '0 1px 3px rgba(0,0,0,.9)',
        }}>×{props.count}</span>
      )}
      {/* base art */}
      <img src={props.card.art} alt={props.card.name} draggable={false}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* diffraction layer — color-dodge, opacity scales with tilt */}
      <img src={props.card.holo} alt="" draggable={false}
        style={{
          position: 'absolute', inset: '-18%', width: '136%', height: '136%', objectFit: 'cover',
          mixBlendMode: 'color-dodge',
          opacity: (0.32 + sheen * 0.45).toFixed(3),
          transform: `translate(${((c.gx - 50) * -0.22).toFixed(1)}%, ${((c.gy - 50) * -0.14).toFixed(1)}%)`,
          pointerEvents: 'none',
        }} />
      {/* elliptical specular mask — overlay blend, slides with the pointer */}
      <img src={props.card.mask} alt="" draggable={false}
        style={{
          position: 'absolute', inset: '-30%', width: '160%', height: '160%', objectFit: 'cover',
          mixBlendMode: 'overlay',
          opacity: (0.38 + sheen * 0.4).toFixed(3),
          transform: `translate(${((c.gx - 50) * -0.3).toFixed(1)}%, ${((c.gy - 50) * -0.2).toFixed(1)}%)`,
          pointerEvents: 'none',
        }} />
      {/* moving glare line */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `linear-gradient(${105 + c.ry * 1.4}deg, transparent 30%, rgba(255,255,255,${(0.05 +
           sheen * 0.22).toFixed(3)}) 48%, transparent 62%)`,
        transform: `translateX(${((c.gx - 50) * 0.5).toFixed(1)}%)`,
      }} />
      {legendary && (
        <>
          {/* gold foil wash */}
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'linear-gradient(135deg, rgba(255,190,70,.18), rgba(255,160,40,0) 42%, rgba(255,190,70,.12))',
            mixBlendMode: 'screen',
          }} />
          {/* rainbow conic sweep */}
          <div style={{
            position: 'absolute', inset: '-30%', pointerEvents: 'none',
            background: 'conic-gradient(from 0deg, rgba(255,128,0,.26), rgba(255,200,80,.2), rgba(163,53,238,.2),'
              + ' rgba(61,158,255,.2), rgba(255,128,0,.26))',
            mixBlendMode: 'color-dodge',
            animation: 'deepsea-ur-spin 7s linear infinite',
          }} />
          <SparkleLayer color="#ffd27a" />
        </>
      )}
      {star !== '' && (
        <span title={'一百单八星 第' + starRank + '位'} style={{
          position: 'absolute', top: Math.max(4, Math.round(w * 0.035)), left: Math.max(4, Math.round(w * 0.05)),
          fontSize: Math.max(9, Math.round(w * 0.045)), fontWeight: 700, letterSpacing: 1,
          color: legendary ? '#ffe3a3' : '#cfe6ff', textShadow: '0 1px 5px rgba(0,0,0,.9)',
          background: 'rgba(2,8,18,.55)', padding: '1px 7px', borderRadius: 999,
          border: '1px solid rgba(190,220,255,.28)', pointerEvents: 'none',
        }}>★{star}</span>
      )}
      {/* 108-seat number badge — independent of the star chip above. Helps the
       * diver find the seat on the album wall without hovering (the title
       * tooltip is the only other place this is exposed). Sits flush under
       * the ★ chip at the same left; if no star chip, takes its top slot. */}
      {starRank >= 1 && starRank <= 108 && (
        <span title={'一百单八星 第' + starRank + '位'} style={{
          position: 'absolute',
          top: star !== ''
            ? Math.max(4, Math.round(w * 0.035)) + Math.max(14, Math.round(w * 0.085))
            : Math.max(4, Math.round(w * 0.035)),
          left: Math.max(4, Math.round(w * 0.05)),
          background: 'rgba(4,10,20,.85)',
          color: '#9fc4e8',
          border: '1px solid rgba(150,190,230,.35)',
          borderRadius: 7,
          fontSize: Math.max(8, Math.round(w * 0.075)),
          fontWeight: 700,
          padding: '1px 5px',
          fontFamily: 'ui-monospace, monospace',
          lineHeight: 1.4,
          pointerEvents: 'none',
          zIndex: 4,
          textShadow: '0 1px 3px rgba(0,0,0,.9)',
        }}>{starRank}/108</span>
      )}
      {gold && (
        <span title={tr('hud.goldSeal')} style={{
          position: 'absolute', top: Math.max(4, Math.round(w * 0.035)), right: Math.max(4, Math.round(w * 0.05)),
          fontSize: Math.max(10, Math.round(w * 0.05)), fontWeight: 800, color: '#3c2a05',
          background: 'linear-gradient(135deg, #ffe9b0, #f5c04a 55%, #d99a1d)',
          padding: '1px 6px', borderRadius: 6, letterSpacing: 1,
          border: '1px solid rgba(120,80,10,.55)', textShadow: '0 1px 0 rgba(255,255,255,.35)',
          boxShadow: '0 0 10px rgba(255,200,90,.45)', pointerEvents: 'none',
        }}>金</span>
      )}
      {/* name plate */}
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: `${Math.round(w * 0.04)}px ${Math.round(
          w * 0.05)}px`,
        background: 'linear-gradient(180deg, rgba(3,7,14,0) 0%, rgba(3,7,14,.88) 55%)',
        display: 'flex', flexDirection: 'column', gap: 1,
      }}>
        <span style={{
          fontSize: Math.round(w * 0.066), fontWeight: 800, color: '#f2f8ff',
          textShadow: '0 1px 6px rgba(0,0,0,.8)',
        }}>{props.card.name}</span>
        <span style={{ fontSize: Math.round(w * 0.05), color: meta.color }}>
          {props.card.rarity} · {props.card.species}
        </span>
      </div>
    </div>
  )
}

/** Locked star seat: a pure-black placeholder with the same footprint as a
 * wall card (same width, aspect 1.45, matching border radius). Only a
 * faint seat number shows — hero name/species/story stay hidden until the
 * seat is caught. Not clickable, and it never gets the .deepsea-wall-card
 * class, so no hover lift either. `width` mirrors the CardFace width so the
 * grid stays perfectly aligned regardless of the adaptive column count. */
function LockedSeat(props: { rank: number, width: number }): ReactNode {
  const w = props.width
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div aria-label="deepsea-locked-seat" style={{
        width: w, height: Math.round(w * 1.45), borderRadius: Math.round(w * 0.07),
        background: '#000', border: '1px solid #10151d',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default',
      }}>
        <span style={{
          fontSize: Math.max(10, Math.round(w * 0.11)), fontWeight: 700, letterSpacing: 2, color: '#39424e',
          fontFamily: 'ui-monospace, monospace', userSelect: 'none',
        }}>{String(props.rank).padStart(3, '0')}</span>
      </div>
    </div>
  )
}

/**
 * The card wall — the 108-star collection album (图鉴). All SEAT_COUNT seats
 * render in rank order: obtained seats show the newest caught copy of that
 * hero (click opens the big card + story modal), locked seats show a
 * pure-black placeholder carrying only a faint seat number, so hero
 * identity stays hidden until the seat is caught. Player-owned cards that
 * cannot claim a seat (duplicate copies, no valid starRank) still render
 * in a small overflow row at the end — no owned card ever disappears. The
 * header counts distinct obtained seats as X/108.
 */
export function CardWall(props: { cards: CardRecord[], onClose: () => void,
  onModalChange?: (open: boolean) => void, onPond?: () => void, onRank?: () => void,
  scene?: SceneId, onScene?: (next: SceneId) => void }): ReactNode {
  const [modal, setModal] = useState<CardRecord | null>(null)
  const [uploadState, setUploadState] = useState<'idle' | 'busy' | 'done' | 'fail'>('idle')
  // Battle upload keeps operating on the raw obtained list (every owned card).
  const owned = props.cards
  /** v46: local mirror of audioBus.muted so the header mute button can
   * render synchronously with the rest of the chrome without a
   * subscription round-trip. */
  const [muted, setMuted] = useState(audioBus.muted)
  /** v46: ocean-id state backing the header's OceanSwitcher — the picker
   * label must re-render on every hop, and the module-level session
   * ocean alone can't trigger that (setSessionOcean mutates module
   * state, not React state). Mirrors the same pattern as the pond. */
  const [oceanId, setOceanId] = useState(() => rollSessionOcean().id)
  const album = useMemo(() => buildWallAlbum(owned), [owned])

  // Scroll container — the adaptive grid (wallGrid) sizes off its width.
  // We watch with ResizeObserver so the wall fans out / collapses when the
  // host panel resizes, the float window expands, or the user drags a
  // border. Safe defaults (4×118) cover the first paint before the
  // observer fires.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [grid, setGrid] = useState<{ cols: number, cardW: number }>(() => wallGrid(0))
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const measure = (): void => { setGrid(wallGrid(el.clientWidth)) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setModal(null)
      props.onModalChange?.(false)
      props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props])

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 6,
      background: '#01030a',
      display: 'flex', flexDirection: 'column',
    }}>
      <style>{WALL_HOVER_CSS}</style>
      {/* Header chrome: flexWrap keeps the growing control set (title,
       * upload, rank, ocean switcher, mute, close) stacking onto a
       * second line on narrow hosts instead of overflowing / colliding
       * (v46 feedback: 按钮重叠). v49.1: padding/gap unified with the
       * ocean + pond strips (6px 10px / 8) and the title sized to match,
       * so the top-left scene toggle does not jump when switching scenes
       * (user: 边距没统一). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        flexWrap: 'wrap', rowGap: 4, minHeight: 36 }}>
        {/* v49.1: the scene toggle leads the header (user: 三个场景都在
         * 左上角). Falls back to the legacy pond button when no scene
         * wiring is provided (e.g. other embedders). */}
        {props.onScene !== undefined && props.scene !== undefined
          ? <SceneToggle scene={props.scene} onPick={props.onScene} />
          : (props.onPond !== undefined && (
            <button type="button" aria-label="deepsea-pond" onClick={props.onPond} style={btn}>
              🐟 {tr('hud.pond')}
            </button>
          ))}
        <span style={{ fontSize: 12, fontWeight: 800, color: '#cfe6ff', flex: 1, minWidth: 120, whiteSpace: 'nowrap' }}>
          🃏 {tr('hud.wall')} · {album.obtained}/{SEAT_COUNT}
          {album.copies > album.obtained ? ` · ${String(album.copies)}${tr('wall.copies')}` : ''}
        </span>
        <button
          type="button"
          disabled={uploadState === 'busy' || owned.length === 0}
          onClick={() => {
            setUploadState('busy')
            uploadBattle(owned).then(() => setUploadState('done')).catch(() => setUploadState('fail'))
          }}
          style={{ ...btn, opacity: uploadState === 'busy' || owned.length === 0 ? 0.5 : 1 }}
        >
          {uploadState === 'done' ? `☁ ${tr('hud.uploaded')}` : uploadState === 'fail' ? tr('hud.uploadfail') :
             `☁ ${tr('hud.upload')}`}
        </button>
        <button type="button" aria-label="deepsea-rank" onClick={props.onRank} style={btn}>🏆 {tr('wall.rank')}</button>

        <OceanSwitcher
          oceanId={oceanId}
          onPick={(nextId) => {
            const next = oceanById(nextId)
            // The wall has no engine — just update the session ocean,
            // the BGM, and the local label state (setSessionOcean alone
            // mutates module state and cannot re-render the picker).
            // The main scene picks up the change via its overlay-sync
            // effect; the pond reads rollSessionOcean() on mount.
            setSessionOcean(next)
            setOceanId(next.id)
            audioBus.setBgmOcean(next.id)
          }}
        />
        <button
          type="button"
          aria-label="deepsea-wall-mute"
          onClick={() => { setMuted(audioBus.toggleMute()) }}
          style={btn}
        >{muted ? '🔇' : '🔊'}</button>
        <button type="button" onClick={props.onClose} style={btn}>✕ {tr('wall.close')}</button>
      </div>
      {/* The album grid: 108 seats in an ADAPTIVE column layout (2..8 cols
       * via wallGrid, sized off the scroll container's clientWidth — wide
       * panels fan out, narrow ones collapse to 2 columns instead of
       * squeezing below card width or overflowing horizontally). Unseated
       * legacy cards never enter the seat grid — they render in a
       * separate appendix row below that mirrors the same column count. */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto',
        overflowX: 'auto', padding: '4px 12px 14px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${grid.cols}, ${grid.cardW}px)`,
          gap: WALL_GAP, justifyContent: 'center',
        }}>
          {SEAT_DISPLAY_ORDER.map((rank) => {
            const seat = album.seats[rank - 1]
            return seat !== undefined
              ? (
                <div key={seat.card.id} className="deepsea-wall-card"
                  style={{ display: 'flex', justifyContent: 'center' }}>
                  <CardFace card={seat.card} count={seat.count} width={grid.cardW}
                    onClick={() => { setModal(seat.card); props.onModalChange?.(true) }} />
                </div>
              )
              : <LockedSeat key={'seat-' + rank} rank={rank} width={grid.cardW} />
          })}
        </div>
        {album.unseated.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, color: '#5f7c9e', letterSpacing: 1, marginBottom: 8 }}>
              {tr('wall.unseated')} · {album.unseated.length}
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${grid.cols}, ${grid.cardW}px)`,
              gap: WALL_GAP, justifyContent: 'center',
            }}>
              {[...album.unseated]
                .sort((a, b) => RARITY_WEIGHT[a.rarity] - RARITY_WEIGHT[b.rarity] || b.createdAt - a.createdAt)
                .map((card) => (
                  <div key={card.id} className="deepsea-wall-card"
                    style={{ display: 'flex', justifyContent: 'center' }}>
                    <CardFace card={card} width={grid.cardW}
                      onClick={() => { setModal(card); props.onModalChange?.(true) }} />
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      {modal !== null && <CardModal card={modal} onClose={() => { setModal(null); props.onModalChange?.(false) }} />}
    </div>
  )
}

/** Enlarged card + full story. */
export function CardModal(props: { card: CardRecord, onClose: () => void }): ReactNode {
  const meta = rarityMeta(props.card.rarity)
  const zone = ZONES.find((z) => z.id === props.card.zone)
  return (
    <div onClick={props.onClose} style={{
      position: 'absolute', inset: 0, zIndex: 7, background: 'rgba(1,3,10,.82)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      gap: 14, cursor: 'pointer', backdropFilter: 'blur(6px)', padding: '16px 14px', overflowY: 'auto',
    }}>
      <CardFace card={props.card} width={240} />
      <div style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 10,
         cursor: 'default' }} onClick={(e) => { e.stopPropagation() }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#eef5ff' }}>{props.card.name}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, border: `1px solid ${meta.color}`,
             color: meta.color }}>{props.card.rarity} {meta.zh}</span>
          <span style={{ fontSize: 11, color: '#8fa8c8' }}>{props.card.species}</span>
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.9, color: '#c6d9ee' }}>
          <div style={{ color: '#7fa6cf', marginBottom: 4 }}>{tr('card.story')}</div>
          {props.card.story}
        </div>
        <div style={{ fontSize: 11, color: '#5f7c9e', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span>{tr('card.depthAt')}：{Math.round(props.card.depth * 100)}%（{isEn() ? zone?.en ?? '' : zone?.zh ??
             ''}）</span>
          {props.card.star !== undefined && props.card.star !== '' && (
            <span style={{ color: props.card.rarity === 'LEGENDARY' ? '#ffd27a' : '#cfe6ff', letterSpacing: 1 }}>
              ★ {props.card.star} · 一百单八星 第 {props.card.starRank ?? 0} 位
            </span>
          )}
          <span>{tr('card.date')}：{new Date(props.card.createdAt).toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}

const btn: CSSProperties = {
  background: 'rgba(12,26,48,.9)', border: '1px solid #2a5484', color: '#bfe2ff',
  borderRadius: 8, fontSize: 11, padding: '5px 12px', cursor: 'pointer',
}
