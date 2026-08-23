/**
 * FishPond — the diver's own pond on the SAME canvas engine the ocean uses
 * (OceanEngine pond mode). Every caught card maps to ONE creature, 1:1 and
 * DETERMINISTIC: the card's name picks the creature kind (lamp cards are
 * glowing anglers, turtle cards are turtles...), the name hash fixes hue
 * and size, rarity enlarges and gilds. Hover shows the card name, click
 * opens the card, drag pans the multi-screen pond world so the diver can
 * look at fish beyond the viewport.
 *
 * Pond world layout (v42+): the school may span a multi-screen pond whose
 * size scales with the card count, keeping a constant ~14 fish per visible
 * screen (same density as before). Drag pans the camera so the diver can
 * explore the whole pond; when count ≤ POND_PER_SCREEN the world collapses
 * to a single screen and panning is a no-op (no drag-hint shown).
 *
 * v46: stocking is 1:1 — every owned card becomes a fish, even duplicates.
 * The pre-v46 `wallFishOf()` helper used to fold same-name cards into the
 * wall's seat representative so a 100-card collection with lots of repeats
 * showed ~14 fish. The user wanted every catch in the pond, so the helper
 * is gone and `props.cards` IS the pond roster directly.
 *
 * v46: auto-tour (wander) — when the pond is pannable and the diver isn't
 * actively dragging, the camera slowly cruises to random waypoints so the
 * diver can see the whole school without dragging. Any pointerdown pauses
 * the tour; releasing the pointer re-arms it after a 3s grace window.
 * Pointermove (hover) bumps that grace window so inspecting a fish
 * doesn't make the camera drift away mid-look.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { OceanEngine } from './engine.ts'
import { pondCamBounds } from './engine-ambient.ts'
import { loadCardSprites, loadFaunaSprites } from './fauna.ts'
import { loadDecorSprites } from './decor.ts'
import { loadSurfaceSprites } from './pond-bg.ts'
import { CardModal } from './cards.tsx'
import { tr } from './locale.ts'
import { type CardRecord } from './depth.ts'
import { oceanById, rollSessionOcean, setSessionOcean } from './oceans.ts'
import { audioBus } from './audio.ts'
import { POND_PER_SCREEN, pondRosterOf, pondStock, pondWorldFor } from './pond-stock.ts'
import { PondToolbar } from './pond-toolbar.tsx'
import type { SceneId } from './scene-toggle.tsx'

export { POND_PER_SCREEN, pondRosterOf, pondStock, pondWorldFor } from './pond-stock.ts'

export function FishPond(props: { cards: CardRecord[], onClose: () => void,
  scene?: SceneId, onScene?: (next: SceneId) => void }): React.ReactNode {
  const { cards, onClose } = props
  /** Full pond roster: 1:1 (every card → one fish, duplicates included).
   * The wallFishOf() helper used to fold duplicates into the seat
   * representative — the user wanted every catch visible in the pond,
   * so the roster is now `cards` directly. We memoise on `cards` so a
   * parent re-render with the same array identity doesn't re-stock. */
  const wallFish = useMemo(() => pondRosterOf(cards), [cards])
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<OceanEngine | null>(null)
  const [selected, setSelected] = useState<CardRecord | null>(null)
  const [hover, setHover] = useState<{ name: string, x: number, y: number } | null>(null)
  /** True once the user has actually panned the camera — the drag-hint
   * banner hides itself after the first real drag so veterans don't see
   * it forever. */
  const [draggedEver, setDraggedEver] = useState(false)
  /** Pointer-drag bookkeeping lives in a ref so the gesture survives
   * React renders without re-arming the listeners. Only the pointer's
   * starting canvas coords and the `moved` flag are needed: panning uses
   * incremental deltas (`panPond(-dx, -dy)`) so the camera position at
   * press time is irrelevant. */
  const dragRef = useRef<{ startX: number, startY: number, moved: boolean } | null>(null)

  /** v46: local ocean-id state. Defaults to the session-ocean the main
   * scene rolled (or whatever the wall set last via setSessionOcean).
   * Header re-renders follow this state directly instead of calling
   * rollSessionOcean() every render, so the title never flickers when
   * the parent passes the same `cards` identity. */
  const [oceanId, setOceanId] = useState(() => rollSessionOcean().id)
  /** v46: mute state mirrors audioBus.muted. The local copy exists so
   * the header button reflects the bus without a round-trip through
   * the engine. */
  const [muted, setMuted] = useState(audioBus.muted)
  /** v47: pond zoom mirror for the toolbar % readout. The engine's
    * pondZoom is the source of truth; this state only exists so the
    * label re-renders (imperative wheel zooms happen inside the mount
    * effect, outside React's render loop). */
  const [zoomUi, setZoomUi] = useState(1)
  /** v47: apply a zoom and sync the toolbar readout in one place —
    * every zoom path (buttons / wheel) funnels through here. */
  const applyZoom = (eng: OceanEngine, fn: () => void): void => {
    fn()
    setZoomUi(eng.pondZoom)
  }
  /** v46: auto-tour toggle. Default ON (the user asked for "see the whole
   * pond without dragging"); the engine flag is consulted every restock
   * / resize via the effect below so re-stocks don't quietly drop it. */
  const [wanderOn, setWanderOnState] = useState(true)
  /** Live mirror of wanderOn for imperative paths (restock runs inside
   * the rAF/resize closures, which would otherwise capture a stale
   * state snapshot for the lifetime of the mount effect). */
  const wanderOnRef = useRef(true)
  const setWanderOn = (updater: (v: boolean) => boolean): void => {
    setWanderOnState((prev) => {
      const next = updater(prev)
      wanderOnRef.current = next
      return next
    })
  }
  /** Hold the grace-window timer so a fast drag-then-release can be
   * cancelled cleanly (the same handle is reused across pointerdown /
   * pointermove so re-arming doesn't leak dangling timeouts). */
  const wanderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Cancel + clear the grace timer (pointerdown or unmount). */
  const cancelWanderGrace = (): void => {
    const t = wanderTimerRef.current
    if (t !== null) { clearTimeout(t); wanderTimerRef.current = null }
  }
  /** (Re)arm the 3s grace window after which the auto-tour resumes from
   * wherever the camera currently sits. Shared by pointerup, hover moves
   * and pointercancel so the timer never stacks. */
  const armWanderGrace = (): void => {
    cancelWanderGrace()
    wanderTimerRef.current = setTimeout(() => {
      wanderTimerRef.current = null
      const eng = engineRef.current
      if (eng !== null) eng.setPondWander(true)
    }, 3000)
  }

  /** Index of the creature under a canvas-RELATIVE point, or null.
   * creatures[i] corresponds to wallFish[i] (pondStock keeps order).
   * The click point is converted from viewport px into world px via
   * engine.screenToWorld so the diver hits the fish they actually see,
   * even after the camera has been panned. */
  const hitTest = (mx: number, my: number): number | null => {
    const engine = engineRef.current
    if (engine === null) return null
    const w = engine.screenToWorld(mx, my)
    for (let i = 0; i < engine.creatures.length; i += 1) {
      const c = engine.creatures[i]
      if (c === undefined) continue
      const dx = c.x - w.x; const dy = c.y - w.y
      if (dx * dx + dy * dy < (c.size * 0.9 + 8) ** 2) return i
    }
    return null
  }

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current
    if (canvas === null || wrap === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const engine = new OceanEngine()
    // Same session ocean as the main scene: the pond is the same water
    // (tint + floor decor) the diver has been fishing in.
    engine.setOcean(oceanById(rollSessionOcean().id))
    engineRef.current = engine
    // v41: stock the school ONLY after the sprite bag settles (or a 1.5s
    // timeout races it). Previously creatures were stocked immediately and
    // wore the shared kind sprite until their own card art loaded — a
    // mid-session identity swap (user report: 金鳞龙神 was a turtle at
    // first, then "became" a dragon-whale). Holding the stock for the
    // sub-second local fetch means the FIRST paint already wears the right
    // art; stragglers degrade to the kind sprite only on real failures.
    const spriteBag = Promise.all([
      loadFaunaSprites().catch(() => new Map() as Awaited<ReturnType<typeof loadFaunaSprites>>),
      loadCardSprites(wallFish.map((c) => c.id))
        .catch(() => new Map() as Awaited<ReturnType<typeof loadCardSprites>>),
    ]).then(([kinds, cards]) => {
      const merged = new Map(kinds)
      for (const [k, v] of cards) merged.set(k, v)
      engine.setSprites(merged)
    })
    const settled = Promise.race([
      spriteBag,
      new Promise<void>((resolve) => { setTimeout(resolve, 1500) }),
    ])
    // Decor sprites (seaweed/kelp) share a module cache; load once on mount
    // so the pond's seabed items draw through the same paint path. v49:
    // surface sprites (island/boat) ride the same lazy-cache pattern.
    void loadDecorSprites().catch(() => {})
    void loadSurfaceSprites().catch(() => {})
    const applySize = (): void => {
      const rect = wrap.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.max(Math.round(rect.width * dpr), 1)
      canvas.height = Math.max(Math.round(rect.height * dpr), 1)
      engine.resize(rect.width, rect.height, dpr)
    }
    applySize()
    // School enters only after the sprite bag settles (or the 1.5s race
    // timeout) — see the v41 comment above.
    let stocked = false
    /** Snapshot of the pond-world geometry at the time of the last
     * restock — used to preserve the diver's relative camera position
     * when the viewport resizes (camera doesn't snap back to (0,0)). */
      const restock = (): void => {
      const { worldW, worldH } = pondWorldFor(wallFish.length, engine.w, engine.h)
      // v49: pannable range from pondCamBounds (center-anchored zoom — the
      // range can start NEGATIVE when zoomed in); preserved as a FRACTION
      // of that range so resizes keep the same relative view.
      const before = pondCamBounds(engine)
      const prevSpanX = Math.max(1, before.maxX - before.minX)
      const prevSpanY = Math.max(1, before.maxY - before.minY)
      const prevFracX = (engine.camX - before.minX) / prevSpanX
      const prevFracY = (engine.camY - before.minY) / prevSpanY
      engine.stockPond(pondStock(wallFish, worldW, worldH), worldW, worldH)
      // Re-apply the relative camera position so panning isn't reset by
      // every resize; new world bounds clamp automatically inside stockPond.
      if (stocked) {
        const after = pondCamBounds(engine)
        engine.panPond(
          (after.minX + prevFracX * (after.maxX - after.minX)) - engine.camX,
          (after.minY + prevFracY * (after.maxY - after.minY)) - engine.camY,
        )
      }
      // v46: keep the auto-tour flag glued to the engine across re-stocks
      // so resizes / card-list changes don't quietly disable wander.
      // wanderOnRef is a real useRef at component scope (kept in sync by
      // the toggle handler), so a mid-session toggle survives the next
      // resize-triggered restock.
      const pannable = wallFish.length > POND_PER_SCREEN
      engine.setPondWander(wanderOnRef.current && pannable)
    }
    void settled.then(() => { stocked = true; restock() })
    const ro = new ResizeObserver(() => {
      applySize()
      // Before the first (gated) stock there is nothing to re-lay-out;
      // after it, the same deterministic school re-lays out per size.
      if (stocked) restock()
    })
    ro.observe(wrap)
    // v47: wheel = pointer-anchored zoom. A NATIVE non-passive listener
    // is required — React's delegated onWheel is passive, so
    // preventDefault() there is ignored and the host page scrolls while
    // the pond zooms. Zoom pauses the auto-tour for the same 3s grace
    // window a drag gets (zooming INTO a fish shouldn't have the camera
    // cruise away mid-inspect); the grace timer lives at component
    // scope and is cleaned up on unmount like every other path.
    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault()
      const rect = canvas.getBoundingClientRect()
      engine.zoomPond(
        ev.clientX - rect.left, ev.clientY - rect.top,
        ev.deltaY < 0 ? 1.1 : 1 / 1.1,
      )
      setZoomUi(engine.pondZoom)
      if (wanderOnRef.current) {
        engine.setPondWander(false)
        armWanderGrace()
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    let raf = 0; let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05); last = now
      engine.step(dt)
      ctx.setTransform(engine.dpr, 0, 0, engine.dpr, 0, 0)
      engine.draw(ctx)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); engineRef.current = null
      canvas.removeEventListener('wheel', onWheel)
      // v46: clear the grace timer on unmount so a closed pond doesn't
      // re-arm wander on a torn-down engine.
      cancelWanderGrace()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallFish])

  /** v46: keep the engine's wander flag in sync with React state on every
   * change. The restock closure above also re-applies it (covers resize /
   * re-stock paths), this effect covers the toggle-button path. */
  useEffect(() => {
    const engine = engineRef.current
    if (engine === null) return
    engine.setPondWander(wanderOn && wallFish.length > POND_PER_SCREEN)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanderOn, wallFish.length])

  /** Cursor: grabbing while the pointer is pressed, grab when the world
   * is pannable, pointer when hovering a fish, default otherwise. */
  const isPannable = wallFish.length > POND_PER_SCREEN
  const cursor = dragRef.current !== null
    ? 'grabbing'
    : hover !== null ? 'pointer' : (isPannable ? 'grab' : 'default')

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 6, overflow: 'hidden', background: '#04101c',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* v46.1: a REAL toolbar strip at the window top (user: 不能把这些
        * 控制按钮都放在窗口顶部么) — every pond control lives on one solid
        * bar in normal flow, the canvas fills the rest below it. v47: the
        * strip moved to pond-toolbar.tsx (adding the zoom trio would have
        * pushed this file over the 500-line audit limit) and gained
        * ＋ / % (reset) / － zoom controls. */}
      <PondToolbar
        count={wallFish.length}
        oceanId={oceanId}
        onPickOcean={(nextId) => {
          const next = oceanById(nextId)
          setSessionOcean(next)
          setOceanId(next.id)
          engineRef.current?.setOcean(next)
          audioBus.setBgmOcean(next.id)
        }}
        isPannable={isPannable}
        wanderOn={wanderOn}
        onToggleWander={() => { setWanderOn((v) => !v) }}
        zoom={zoomUi}
        onZoomIn={() => {
          const eng = engineRef.current
          if (eng !== null) applyZoom(eng, () => { eng.zoomPond(eng.w / 2, eng.h / 2, 1.25) })
        }}
        onZoomOut={() => {
          const eng = engineRef.current
          if (eng !== null) applyZoom(eng, () => { eng.zoomPond(eng.w / 2, eng.h / 2, 1 / 1.25) })
        }}
        onZoomReset={() => {
          const eng = engineRef.current
          if (eng !== null) applyZoom(eng, () => { eng.setPondZoom(1) })
        }}
        muted={muted}
        onToggleMute={() => { setMuted(audioBus.toggleMute()) }}
        onClose={onClose}
        scene={props.scene ?? 'pond'}
        onScene={(next) => {
          if (props.onScene !== undefined) props.onScene(next)
          else onClose()
        }}
      />
      <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: '100%', height: '100%', display: 'block', cursor,
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            // Start a drag gesture; record the starting canvas coords
            // so the move handler can compute the pointer delta and
            // translate it into a world pan. Any subsequent movement
            // past a 5px threshold flips `moved` and suppresses the
            // tap-as-click at release time.
            const engine = engineRef.current
            if (engine === null) return
            // v46: a real drag pauses the auto-tour immediately. The
            // grace-window timer is set on pointerup so the camera
            // doesn't snap back the instant the finger lifts — the
            // diver usually wants to look at where they landed.
            cancelWanderGrace()
            engine.setPondWander(false)
            const rect = e.currentTarget.getBoundingClientRect()
            dragRef.current = {
              startX: e.clientX - rect.left,
              startY: e.clientY - rect.top,
              moved: false,
            }
            // Capture so the gesture survives the cursor leaving the canvas.
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (drag === null) {
              // Hover-only move: track which fish the cursor is over.
              const rect = e.currentTarget.getBoundingClientRect()
              const i = hitTest(e.clientX - rect.left, e.clientY - rect.top)
              const card = i === null ? null : (wallFish[i] ?? null)
              if (card === null) { setHover(null); return }
              setHover({ name: card.name, x: e.clientX - rect.left, y: e.clientY - rect.top })
              // v46: a hover-only move also bumps the 3s grace window so
              // the diver can look at a fish without the camera drifting
              // off it. Only armed while wanderOn is true — toggling the
              // tour off leaves the timer idle.
              if (wanderOn) armWanderGrace()
              return
            }
            const rect = e.currentTarget.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top
            const dx = x - drag.startX
            const dy = y - drag.startY
            if (!drag.moved && (dx * dx + dy * dy > 25)) drag.moved = true
            if (drag.moved) {
              // Natural "grab the map" semantics: when the pointer drags
              // right, content follows the finger (shifts right), so the
              // camera in world coords moves LEFT, revealing the world's
              // left side. Same on Y (drag down → content shifts down →
              // camera moves up). The React layer negates the screen
              // delta before passing to panPond, which adds it directly
              // to camX/camY (clamped to [0, world - viewport]).
              engineRef.current?.panPond(-dx, -dy)
              // Reset the drag anchor so subsequent moves are deltas
              // from the CURRENT pointer position (otherwise the camera
              // jumps on every frame by the full cumulative delta).
              drag.startX = x
              drag.startY = y
              setDraggedEver(true)
            }
          }}
          onPointerUp={(e) => {
            const drag = dragRef.current
            if (drag === null) return
            // Only release + clear when there was an actual captured
            // gesture. Releasing without a matching capture throws
            // NotFoundError on some browsers.
            dragRef.current = null
            e.currentTarget.releasePointerCapture(e.pointerId)
            // Only fire a click if the gesture never crossed the drag
            // threshold — a tiny jiggle on tap is fine, a real pan is not.
            if (!drag.moved) {
              const rect = e.currentTarget.getBoundingClientRect()
              const i = hitTest(e.clientX - rect.left, e.clientY - rect.top)
              const card = i === null ? null : (wallFish[i] ?? null)
              if (card !== null) setSelected(card)
            }
            // v46: re-arm the tour after a 3s grace window so the
            // diver can finish their look without the camera drifting
            // away. Skipped when the tour is toggled off — the timer
            // would just cancel itself again on the next pointerdown.
            if (wanderOn) armWanderGrace()
          }}
          onPointerCancel={() => {
            // The browser implicitly releases captured pointers on cancel,
            // so no explicit releasePointerCapture() here — and a stray
            // pointercancel without a matching pointerdown must not try.
            dragRef.current = null
            if (wanderOn) armWanderGrace()
          }}
          onMouseLeave={() => { setHover(null) }}
        />
        {/* Hover tooltip lives INSIDE the wrap (canvas) container: its
         * coordinates are canvas-relative, and since the toolbar now
         * sits above the canvas in flow, root-level absolute positioning
         * would be off by the toolbar height. */}
        {hover !== null && dragRef.current === null && (
          <div style={{
            position: 'absolute', left: hover.x + 10, top: hover.y - 26, zIndex: 3,
            background: 'rgba(6,20,34,.88)', color: '#cfe6fa', fontSize: 11,
            padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(120,180,230,.35)',
            pointerEvents: 'none', whiteSpace: 'nowrap',
          }}>{hover.name}</div>
        )}
      </div>
      {isPannable && !draggedEver && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)',
          zIndex: 2, pointerEvents: 'none',
          background: 'rgba(6,20,34,.72)', color: 'rgba(200,230,255,.85)', fontSize: 11,
          padding: '4px 12px', borderRadius: 999, border: '1px solid rgba(120,180,230,.25)',
          whiteSpace: 'nowrap', letterSpacing: 0.4,
          opacity: 0.85,
        }}>{tr('pond.dragHint')}</div>
      )}
      {selected !== null && <CardModal card={selected} onClose={() => { setSelected(null) }} />}
    </div>
  )
}
