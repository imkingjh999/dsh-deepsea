/**
 * The ocean: a canvas column of four marine zones. The session's context
 * occupancy drives the claw depth; creatures wander in depth-appropriate
 * bands. The claw drifts, sways and rides the current on its own; the
 * player CLICKS to snap it shut — a creature inside the claw radius is
 * reeled up and the host pipeline mints a card. All per-frame state lives
 * on an imperative engine; React only sees throttled HUD values and card
 * lifecycle events.
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { rarityMeta, zoneIndexOf, zoneOf, type CardRecord } from './depth.ts'
import { OceanEngine } from './engine.ts'
import { groupCardSpiritsByKind, loadCardSprites, loadFaunaSprites } from './fauna.ts'
import { loadDecorSprites } from './decor.ts'
import type { SessionsRef } from './index.tsx'
import { fetchNextCatch, listCards } from './api.ts'
import { audioBus } from './audio.ts'
import { CardWall } from './cards.tsx'
import { CardReveal } from './reveal-fx.tsx'
import { FishPond } from './pond.tsx'
import { Leaderboard } from './leaderboard.tsx'
import { fitAspect } from './aspect.ts'
import { oceanById, rollSessionOcean, setSessionOcean } from './oceans.ts'
import { OceanHud, OceanToolbar, StatusBanner, usePopStyle } from './ocean-hud.tsx'
import type { SceneId } from './scene-toggle.tsx'
import {
  runCatchFlow, useSessionFeed, type OceanStatus, type RollInfo,
} from './ocean-flow.ts'

/** Flavor picker now lives in ocean-flow.ts (next to the catch pipeline
 * that calls it); re-exported here because the locale-pools spec imports
 * it from './ocean.tsx'. */
export { pickFlavor } from './ocean-flow.ts'

export function OceanApp(props: { sessionsRef: SessionsRef, visible?: boolean }): ReactNode {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /** v46.1: the flex-1 scene box below the top toolbar. applySize measures
    * THIS (not the root wrap) so the engine viewport matches the canvas
    * pixels exactly — the toolbar strip would otherwise leave the engine
    * ~30px taller than the visible water. */
  const sceneRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<OceanEngine | null>(null)
  const [hud, setHud] = useState<{ occ: number | null, used: number | null, win: number | null }>({ occ: null, used:
     null, win: null })
  const [status, setStatus] = useState<OceanStatus>('idle')
  /** Minutes until the diver may catch again (shown in the too-soon hint). */
  const [tooSoonMin, setTooSoonMin] = useState(10)
  const [cards, setCards] = useState<CardRecord[]>([])
  const [reveal, setReveal] = useState<CardRecord | null>(null)
  const [wallOpen, setWallOpen] = useState(false)
  const [pondOpen, setPondOpen] = useState(false)
  const [rankOpen, setRankOpen] = useState(false)
  const [muted, setMuted] = useState(audioBus.muted)
  /** Roll-theater detail row: flavor line + the local tail we rolled +
    * the server's advertised target + the hex char currently rendered.
    * `shown` animates while `flavor`/`mine`/`target` are locked for the
    * whole roll. Null outside the roll window. (Type lives in
    * ocean-flow.ts; the roll theater itself runs in runCatchFlow.) */
  const [rollInfo, setRollInfo] = useState<RollInfo | null>(null)
  /** Picked-once flavor for the wriggled banner (re-renders would otherwise
    * re-roll it). Empty until the wriggled branch fires. */
  const [wrigFlavor, setWrigFlavor] = useState('')
  /** The session's ocean — rolled once per page load, shared with the pond.
    * v46: it is now stateful so the HUD's OceanSwitcher can mutate it in
    * place; the initial value is still `rollSessionOcean()` so the very
    * first paint keeps the same memoized roll as before. The card-wall
    * and fish-pond overlays ALSO update the same module-level memo
    * (setSessionOcean) — when the diver closes either overlay, the
    * overlay-sync effect below re-aligns this state with the latest
    * module value (engine + BGM too) so the main scene never shows the
    * old ocean with the new BGM. */
  const [ocean, setOcean] = useState(() => rollSessionOcean())

  // Alt+M = mute toggle, global like the boss key: the DSH chat input
  // (contenteditable) holds focus most of the time, and a modifier combo
  // is a hotkey, not typing — preventDefault keeps 'µ' out of the field.
  // We judge by ev.code (physical KeyM) rather than ev.key, because on
  // macOS Alt+M produces ev.key === 'µ' (the option-key substitution) —
  // only the code survives across keyboard layouts and modifier
  // permutations.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.code !== 'KeyM' || !ev.altKey || ev.ctrlKey || ev.metaKey) return
      ev.preventDefault()
      setMuted(audioBus.toggleMute())
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])
  const busyRef = useRef(false)
  const nextAllowedRef = useRef(0)
  const lastZoneRef = useRef(0)
  /** True while ANY overlay masks the ocean (card reveal, card wall, fish
    * pond, or a card-detail modal inside them) — freezes the world so
    * fishing (hook drift + collision catches) fully stops. Derived from
    * state so no imperative write can leave it stale. */
  const pausedRef = useRef(false)
  useEffect(() => {
    pausedRef.current = reveal !== null || wallOpen || pondOpen || rankOpen
  }, [reveal, wallOpen, pondOpen, rankOpen])
  /** False while the float window itself is minimized (children-as-function
    * visible flag from the shell) — hold the world still and mute the BGM. */
  const visibleRef = useRef(true)
  useEffect(() => {
    visibleRef.current = props.visible !== false
    audioBus.setHidden(!visibleRef.current)
  }, [props.visible])

  // Engine + canvas loop (mount once).
  useEffect(() => {
    const canvas = canvasRef.current; const wrap = sceneRef.current
    if (canvas === null || wrap === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const engine = new OceanEngine()
    // Session ocean first, so the initial populate() draws its fauna mix
    // and the water tint from the very first frame (memoized module-wide,
    // so the pond later rolls the same ocean). Its own BGM loop rides
    // along: pacific reefs, atlantic kelp currents, indian glass beds,
    // arctic ice drift, southern deep swells.
    const ocean = rollSessionOcean()
    engine.setOcean(ocean)
    audioBus.setBgmOcean(ocean.id)
    // MiniMax-painted fauna sprites load in the background; until then (and
    // for any kind that fails) the engine keeps its procedural drawing.
    void loadFaunaSprites().then((sprites) => { engine.setSprites(sprites) }).catch(() => {})
    // Same pattern for the seaweed/kelp decor sprites — the engine draws
    // them procedurally unless a MiniMax sprite has loaded into the
    // shared module cache (see decor.ts → loadDecorSprites).
    void loadDecorSprites().catch(() => {})
    engineRef.current = engine
    // Opt the engine into hands-free auto-catch (default OFF in tests).
    // The first automatic grab fires ~40s later — long enough to not
    // race the player's manual attempts while still keeping the world
    // alive when nobody is steering.
    engine.enableAutoCatch()
    audioBus.attach()
    // Prime the diver's catch cooldown from the worker on load — a blocked
    // diver then sees the minutes hint immediately on a bite instead of the
    // "generating card" tease followed by a rejection.
    void fetchNextCatch().then((ms) => {
      if (ms > 1000) {
        nextAllowedRef.current = Date.now() + ms
        setTooSoonMin(Math.max(1, Math.ceil(ms / 60000)))
      }
    }).catch(() => {})
    engine.onCatchStart = (depth, zoneIdx, auto) => {
      if (busyRef.current) { engine.resume(); return }
      if (Date.now() < nextAllowedRef.current) {
        // Automatic grabs stay quiet during the cooldown — a hands-free
        // attempt every minute must not spam the too-soon banner. Manual
        // attempts still surface the wait hint so the player knows why
        // nothing happened.
        if (!auto) {
          const remainMin = Math.max(1, Math.ceil((nextAllowedRef.current - Date.now()) / 60000))
          setTooSoonMin(remainMin)
          setStatus('toosoon')
          setTimeout(() => { setStatus((s) => s === 'toosoon' ? 'idle' : s); engine.resume() }, 2500)
          return
        }
        engine.resume()
        return
      }
      busyRef.current = true
      // "碰到" — the claw just snapped shut on a creature. Show the touch
      // hint immediately; the screenshot already implies the catch attempt.
      setStatus('touch')
      audioBus.sfx('bite')
      // The catch pipeline (API call → roll theater → mint/miss dispatch)
      // lives in ocean-flow.ts → runCatchFlow; extracted verbatim.
      void runCatchFlow({
        depth, zoneIdx, auto, engine, busyRef, nextAllowedRef,
        setStatus, setTooSoonMin, setRollInfo, setWrigFlavor, setCards, setReveal,
      })
    }
    // Lock the ocean to its INITIAL aspect ratio: fit the largest
    // same-ratio rect inside the wrap (letterbox, centered on the dark
    // wrap background). The world only ever zooms uniformly, so hook and
    // fish control feel never stretches when the window is resized.
    let aspect = 0
    const applySize = (): void => {
      const rect = wrap.getBoundingClientRect()
      // Defensive: when the float window is minimized the wrap collapses
      // to 0 height. Skip the canvas resize + engine.resize call entirely;
      // engine.resize has its own guard, but here we also avoid setting
      // canvas backing store to 1×1 and skipping aspect-lock initialization.
      // A collapsed content box means the panel is invisible — either the
      // float window itself is minimized OR the host hid the panel via
      // display:none — so stop the BGM too (audioBus is module-scoped and
      // outlives React; visibleRef's effect only catches the visible-prop
      // path and would miss a host-side hide).
      if (rect.width <= 0 || rect.height <= 0) { audioBus.setHidden(true); return }
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (rect.width > 0 && rect.height > 0 && aspect <= 0) aspect = rect.width / rect.height
      const fit = fitAspect(rect.width, rect.height, aspect)
      canvas.style.width = Math.max(Math.round(fit.w), 1) + 'px'
      canvas.style.height = Math.max(Math.round(fit.h), 1) + 'px'
      canvas.width = Math.max(Math.round(fit.w * dpr), 1)
      canvas.height = Math.max(Math.round(fit.h * dpr), 1)
      engine.resize(fit.w, fit.h, dpr)
      // Sync BGM to the panel's effective visibility on every (re)size: the
      // float window's `visible` prop path is handled by the visibleRef
      // effect, but if the host simply hides us via display:none the rect
      // collapses (early-return above); when it un-hides, resume here.
      // setHidden is idempotent (true repeats just pause; false respects
      // muted/arm semantics), so calling it on every resize is safe.
      audioBus.setHidden(!visibleRef.current)
    }
    applySize()
    const ro = new ResizeObserver(applySize); ro.observe(wrap)
    let raf = 0; let last = performance.now()
    const loop = (now: number): void => {
      if (pausedRef.current || !visibleRef.current) {
        // Modal open: hold the world still (dt would snowball otherwise).
        last = now
      } else {
        const dt = Math.min((now - last) / 1000, 0.05); last = now
        engine.step(dt)
        ctx.setTransform(engine.dpr, 0, 0, engine.dpr, 0, 0)
        engine.draw(ctx)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); engineRef.current = null
      // audioBus is a module-scoped singleton that outlives React — when
      // the host closes the panel entirely (not just minimizes) this
      // effect's cleanup fires without ever passing through `visible=false`,
      // so the BGM would keep playing behind a torn-down component. Stop
      // it on the way out; the next mount re-attaches on its first user
      // gesture.
      audioBus.setHidden(true)
    }
  }, [])

  // Stable callback bag for the session feed.
  const feedCb = useRef({
    occ: (o: number | null, pressure?: { projectedTokens?: number, pressureTokens?: number, contextWindow?:
       number }) => {
      engineRef.current?.setDepth(o ?? 0)
      const zi = zoneIndexOf(o ?? 0)
      if (zi !== lastZoneRef.current) { lastZoneRef.current = zi; engineRef.current?.retune(zi) }
      if (pressure?.contextWindow !== undefined && pressure.contextWindow > 0) {
        setHud((prev) => ({
          occ: o,
          used: pressure.projectedTokens ?? pressure.pressureTokens ?? prev.used,
          win: pressure.contextWindow ?? null,
        }))
      } else {
        setHud((prev) => ({ ...prev, occ: o }))
      }
    },
    // Answers no longer auto-bite: cards pop only on physical hook contact
    // (engine collision, cooldown-gated). The running edge is kept for future
    // use (e.g. nudging the drift), so the subscription stays.
    edge: () => { },
  })
  useSessionFeed(props.sessionsRef, feedCb)

  useEffect(() => { void listCards().then(setCards) }, [])

  /** v46: overlay-sync. The card-wall and fish-pond overlays both have
    * their own OceanSwitcher / mute buttons — when the diver mutates the
    * session ocean (or toggles mute) from inside one of them, the main
    * scene's local `ocean` state and `muted` state stay stale until the
    * overlay closes. This effect re-aligns BOTH on every overlay-state
    * change: pull the latest module-level ocean, push it into the engine
    * (which re-seeds fauna + decor for the new profile in ocean mode)
    * and re-arm the BGM playlist so the soundtrack matches the visible
    * water. The engine reference is read via the existing ref because
    * the engine itself is mounted by the per-mount effect above. */
  useEffect(() => {
    const cur = rollSessionOcean()
    if (cur.id !== ocean.id) {
      setOcean(cur)
      const engine = engineRef.current
      if (engine !== null) engine.setOcean(cur)
      audioBus.setBgmOcean(cur.id)
    }
    setMuted(audioBus.muted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallOpen, pondOpen, rankOpen])

  /** v40: ocean fish wear card spirits. Whenever the loaded card list
    * changes, recompute the per-kind pool and ask the engine to re-dress
    * its current fauna (already-spawned creatures pick up the new
    * spriteKey on the same tick). Then load the card sprite bitmaps in
    * the background and merge into engine.setSprites — same pattern as
    * the pond (fauna sprites load first; per-card sprites layer on top).
    * An empty list is fine: setCardSpirits with an empty map clears any
    * previous wear, and fauna sprites alone still cover the kind fallback. */
  useEffect(() => {
    const engine = engineRef.current
    if (engine === null) return
    const pool = groupCardSpiritsByKind(cards)
    engine.setCardSpirits(pool)
    const ids = new Set<string>()
    for (const list of pool.values()) for (const id of list) ids.add(id)
    if (ids.size === 0) return
    void loadCardSprites(Array.from(ids))
      .then((cardSprites) => {
        const cur = engineRef.current
        if (cur === null) return
        const merged = new Map(cur.sprites ?? [])
        for (const [k, v] of cardSprites) merged.set(k, v)
        cur.setSprites(merged)
      })
      .catch(() => {})
  }, [cards])

  // Banner pop keyframe injection (see ocean-hud.tsx → usePopStyle).
  usePopStyle()

  /** v49 scene model (user: 把海洋 卡墙 鱼池 弄成一个 toggle): one
    * derived scene id + one switcher that replaces the old
    * wall→pond→wall back-chain. rankOpen stays a wall overlay — the
    * toggle closes it whenever the scene leaves the wall. */
  const scene: SceneId = pondOpen ? 'pond' : wallOpen ? 'wall' : 'ocean'
  const goScene = (next: SceneId): void => {
    setWallOpen(next !== 'ocean')
    setPondOpen(next === 'pond')
    if (next !== 'wall') setRankOpen(false)
  }

  const occPct = hud.occ === null ? null : Math.round(hud.occ * 100)
  const zone = hud.occ === null ? null : zoneOf(hud.occ)
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: '#02060f',
      display: 'flex', flexDirection: 'column' }}>
      <OceanToolbar
        cardsCount={cards.length}
        muted={muted}
        oceanId={ocean.id}
        scene={scene}
        onScene={goScene}
        onToggleMute={() => { setMuted(audioBus.toggleMute()) }}
        onPickOcean={(nextId) => {
          const next = oceanById(nextId)
          setSessionOcean(next)
          setOcean(next)
          const engine = engineRef.current
          if (engine !== null) engine.setOcean(next)
          audioBus.setBgmOcean(next.id)
        }}
      />
      <div ref={sceneRef} style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <canvas ref={canvasRef} style={{
        display: 'block', position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)', width: '100%', height: '100%',
      }}
        onPointerDown={(e) => {
          // Snap the claw shut on click. Manual catch: the player drives
          // every grab, the engine no longer auto-catches on collision.
          // Feed the click to pointerTo() first so a bare tap (no prior
          // move event — common on touch) initializes manual steering
          // and closeClaw()'s aim-snap judges the grab at the tap point
          // instead of wherever the patrol happens to be.
          e.preventDefault()
          const engine = engineRef.current
          if (engine !== null) {
            const rect = e.currentTarget.getBoundingClientRect()
            engine.pointerTo(e.clientX - rect.left, e.clientY - rect.top)
          }
          // Catch the closeClaw() verdict so we can label an EMPTY clap
          // during the post-win 5-minute lock. closeClaw() returns false on
          // an empty grab (or any short-circuited gate); the engine's own
          // 75s markCatch() lock makes the silent-empty-claw window fall
          // here while nextAllowedRef is still warm. Fresh session
          // (nextAllowedRef=0) stays silent — that's the anti-spam dry
          // spell window, not a cooldown complaint.
          const grabbed = engineRef.current?.closeClaw() === true
          if (!grabbed && Date.now() < nextAllowedRef.current) {
            const remainMs = nextAllowedRef.current - Date.now()
            setTooSoonMin(Math.max(1, Math.ceil(remainMs / 60000)))
            setStatus('toosoon')
            setTimeout(() => setStatus((s) => s === 'toosoon' ? 'idle' : s), 2500)
          }
        }}
        onPointerMove={(e) => {
          // Steer the hook: pointer position (canvas-relative) → engine.
          const engine = engineRef.current
          if (engine === null) return
          const rect = e.currentTarget.getBoundingClientRect()
          engine.pointerTo(e.clientX - rect.left, e.clientY - rect.top)
        }}
        onTouchMove={(e) => {
          const engine = engineRef.current
          if (engine === null) return
          const touch = e.touches[0]
          if (touch === undefined) return
          const rect = e.currentTarget.getBoundingClientRect()
          engine.pointerTo(touch.clientX - rect.left, touch.clientY - rect.top)
        }} />
      <OceanHud occPct={occPct} zone={zone} used={hud.used} win={hud.win} />
      <StatusBanner status={status} tooSoonMin={tooSoonMin} rollInfo={rollInfo} wrigFlavor={wrigFlavor} />
      {/* The v46.1 toolbar above replaced this bottom bar (user: 也要统一):
       * buttons moved to the top strip, the ocean name rides inside the
       * switcher, and the zone text was redundant with the top-left
       * status overlay. */}
      </div>
      {reveal !== null && <CardReveal card={reveal} onClose={() => { setReveal(null) }} />}
      {wallOpen && !pondOpen && !rankOpen && <CardWall cards={cards} onClose={() => { setWallOpen(false) }}
        onPond={() => { setPondOpen(true) }}
        onRank={() => { setRankOpen(true) }}
        scene={scene}
        onScene={goScene} />}
      {pondOpen && <FishPond cards={cards} onClose={() => { setPondOpen(false) }}
        scene={scene}
        onScene={goScene} />}
      {rankOpen && <Leaderboard onClose={() => { setRankOpen(false) }} />}
    </div>
  )
}
