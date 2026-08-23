/**
 * ocean-flow.ts — the ocean app's non-UI plumbing, carved out of ocean.tsx:
 * the session context-pressure subscription hook, the flavor-pool picker
 * used by the banners, and the async catch pipeline (API call → roll
 * theater → card mint / miss dispatch). No JSX and no engine timing live
 * here — these helpers only shuttle values between React state, the
 * engine and the API.
 */
import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { ZONES, occupancyOf, type CardRecord } from './depth.ts'
import { OceanEngine } from './engine.ts'
import type { SessionsRef, SessionLike } from './index.tsx'
import { catchCard, rollChallenge } from './api.ts'
import { tr } from './locale.ts'

/** Hex alphabet used by the roll-theater animation (one char per tick). */
const HEXCHARS = '0123456789abcdef'

/** Roll-theater + banner pacing (v47, user: 掷骰过程要长一点，结果要
 * 看得清才消失). All timings live here so future tuning is one edit. */
/** Dice-spin tick while the roll is "tumbling" (fast phase). */
const ROLL_TICK_FAST_MS = 70
/** Dice-spin tick while the roll is "settling" (slow phase) — the
 * visible deceleration that reads as the die coming to rest. */
const ROLL_TICK_SLOW_MS = 140
/** Fast tumbling phase length. */
const ROLL_FAST_MS = 900
/** Settling phase length (after ROLL_FAST_MS). Total roll window =
 * ROLL_FAST_MS + ROLL_SLOW_MS = 1400ms (was a flat 420ms). */
const ROLL_SLOW_MS = 500
/** How long the LOCKED tail (mine vs target) stays readable before the
 * roll row clears (was 650ms — too fast to read the result). */
const ROLL_HOLD_MS = 1600
/** The "抓到了" beat between the roll result and the card-reveal modal
 * (was 900ms). */
const GRAB_BEAT_MS = 1500
/** How long wriggled / too-soon / fail banners linger before hiding
 * (was 2500ms). */
const BANNER_LINGER_MS = 4000

/** Pick a random line from a `|`-separated flavor pool. Falls back to the
 * original string when the pool is empty or the split yields nothing
 * — a defensive safety net so a missing/blank translation key never
 * produces a blank banner. Exported for the locale-pools spec. */
export function pickFlavor(pool: string): string {
  if (typeof pool !== 'string' || pool === '') return pool
  const parts = pool.split('|').filter((p) => p !== '')
  if (parts.length === 0) return pool
  return parts[Math.floor(Math.random() * parts.length)] ?? pool
}

/** The banner status machine driven by the catch pipeline — OceanApp's
 * `status` state type, shared with the StatusBanner prop. */
export type OceanStatus = 'idle' | 'touch' | 'roll' | 'grabbed' | 'wriggled' | 'toosoon' | 'fail'

/** Roll-theater detail row: flavor line + the local tail we rolled + the
 * server's advertised target + the hex char currently rendered. Null
 * outside the roll window. */
export type RollInfo = { flavor: string, mine: string, target: string, shown: string }

/**
 * Subscribe to the current session's contextPressure face + running flag.
 * `cbRef.current` is a stable bag of callbacks so the subscription survives
 * re-renders without resubscribing.
 *
 * Subscription discipline (fixed the page-freeze bug): the sessions.list
 * store is zustand vanilla — its notification forEach visits listeners added
 * DURING iteration. Subscribing to `list` from inside a `list` notification
 * therefore loops forever (each new callback re-arms another). So the list
 * subscription here is created ONCE for the effect's lifetime and never
 * re-armed; it only rebinds the session-level observers when the current
 * session id actually changes.
 */
export function useSessionFeed(ref: SessionsRef, cbRef: { current: { occ: (o: number | null, pressure?:
  { projectedTokens?: number, pressureTokens?: number, contextWindow?: number }) => void, edge: () => void } }): void {
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let listOff: (() => void) | undefined
    let boundId: string | undefined
    const sessionOffs: Array<() => void> = []

    const dropSession = (): void => { for (const off of sessionOffs.splice(0)) off() }

    const bind = (): void => {
      if (stopped) return
      const sessions = ref.get()
      const id = sessions?.list.getSnapshot().current
      if (id === boundId && sessionOffs.length > 0) return
      if (sessions === undefined || id === undefined) { timer = setTimeout(bind, 1500); return }
      const session: SessionLike | undefined = sessions.binding(id)?.session
      if (session === undefined) { timer = setTimeout(bind, 1500); return }
      dropSession()
      boundId = id
      let prevRunning: boolean | undefined
      const read = (): void => {
        const pressure = session.projections?.faceOf('contextPressure')?.getSnapshot() as
          | { projectedTokens?: number, pressureTokens?: number, contextWindow?: number } | undefined
        cbRef.current.occ(occupancyOf(pressure), pressure)
        const running = session.getSnapshot().running === true
        if (prevRunning === true && !running) cbRef.current.edge()
        prevRunning = running
      }
      read()
      sessionOffs.push(session.subscribe(read))
      const face = session.projections?.faceOf('contextPressure')
      if (face !== undefined) sessionOffs.push(face.subscribe(read))
    }

    const start = (): void => {
      if (stopped) return
      const sessions = ref.get()
      if (sessions === undefined) { timer = setTimeout(start, 1500); return }
      if (typeof sessions.list.subscribe === 'function') {
        listOff = sessions.list.subscribe(() => {
          // list changed (session opened/switched/list refreshed): rebind only
          // when the current id moved. Never subscribe during this notification.
          const id = ref.get()?.list.getSnapshot().current
          if (id !== boundId) bind()
        })
      }
      bind()
    }
    start()
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      listOff?.()
      dropSession()
    }
  }, [ref])
}

/** One catch attempt, theater and all: call the API, run the roll theater
 * when the server advertises a challenge, then dispatch the mint / escape
 * / fail state transitions. Extracted verbatim from the engine-mount
 * effect's async IIFE — the gates (busy flag, cooldown) stay in ocean.tsx
 * and only call this after they pass. */
export async function runCatchFlow(opts: {
  depth: number
  zoneIdx: number
  auto: boolean
  engine: OceanEngine
  busyRef: { current: boolean }
  nextAllowedRef: { current: number }
  setStatus: Dispatch<SetStateAction<OceanStatus>>
  setTooSoonMin: Dispatch<SetStateAction<number>>
  setRollInfo: Dispatch<SetStateAction<RollInfo | null>>
  setWrigFlavor: Dispatch<SetStateAction<string>>
  setCards: Dispatch<SetStateAction<CardRecord[]>>
  setReveal: Dispatch<SetStateAction<CardRecord | null>>
}): Promise<void> {
  const { depth, zoneIdx, auto, engine, busyRef, nextAllowedRef } = opts
  const { setStatus, setTooSoonMin, setRollInfo, setWrigFlavor, setCards, setReveal } = opts
  try {
    let result = await catchCard(depth, ZONES[zoneIdx]?.id ?? 'sunlit', auto)
    if (result.reason === 'too-soon') {
      // Fallback mirrors the current server interval (5 min) — only
      // used if the 429 somehow lacks retryAfterMs.
      const waitMs = result.retryAfterMs ?? 300000
      nextAllowedRef.current = Date.now() + waitMs
      setTooSoonMin(Math.max(1, Math.ceil(waitMs / 60000)))
      setStatus('toosoon')
      setTimeout(() => setStatus('idle'), BANNER_LINGER_MS)
      return
    }
    // Reveal theater: one local WebCrypto hash of the server challenge,
    // purely for the roll display — the server already adjudicated.
    if (result.challenge !== '') {
      setStatus('roll')
      const local = await rollChallenge(result.challenge)
      // Compare as many tail chars as the server's target advertises
      // (difficulty-aware; 1 is the new default).
      const n = result.targetTail.length > 0 ? result.targetTail.length : 1
      if (local !== '' && local.slice(-n) !== result.tail) {
        // Tamper/mismatch guard: trust the server's tail for display.
        result = { ...result, tail: local.slice(-n) }
      }
      // Lock the flavor + tail comparison for the whole roll window.
      // mine mirrors the existing display rule: prefer the local hash's
      // tail slice when available, otherwise fall back to whatever the
      // server advertised (defensive — result.tail is always present).
      const mine = local !== '' ? local.slice(-n) : result.tail
      const target = result.targetTail
      const flavor = pickFlavor(tr('hud.rollpool'))
      setRollInfo({ flavor, mine, target, shown: '·' })
      // Dice-roll theater (v47 pacing): tumble FAST (70ms ticks) for
      // 900ms, then settle SLOW (140ms ticks) for 500ms so the roll
      // visibly decelerates to rest — total 1400ms, ~3.3× the old flat
      // 420ms spin. The intervals are cleared before the next await so
      // they never leak into the post-roll window — React 18's setState
      // on unmounted components is a no-op, so no teardown hook needed.
      const spinShown = (): void => {
        setRollInfo((p) => p === null
          ? p
          : { ...p, shown: HEXCHARS[Math.floor(Math.random() * HEXCHARS.length)] ?? p.shown })
      }
      const spinFast = setInterval(spinShown, ROLL_TICK_FAST_MS)
      await new Promise((r) => setTimeout(r, ROLL_FAST_MS))
      clearInterval(spinFast)
      const spinSlow = setInterval(spinShown, ROLL_TICK_SLOW_MS)
      await new Promise((r) => setTimeout(r, ROLL_SLOW_MS))
      clearInterval(spinSlow)
      setRollInfo((p) => p === null ? p : { ...p, shown: p.mine })
      // Hold the locked tail visible long enough to read the result
      // (v47: 1600ms — the user needs to SEE mine vs target before it
      // disappears), then clear.
      await new Promise((r) => setTimeout(r, ROLL_HOLD_MS))
      setRollInfo(null)
    }
    if (result.escaped || result.card === undefined) {
      // Server rejected this attempt — release the local grab gate so
      // the next click can fire immediately (no card minted ⇒ no wait).
      engine.markMiss()
      // Pick the wriggle flavor BEFORE setStatus — reading it from
      // render-time would re-roll on every re-render.
      setWrigFlavor(pickFlavor(tr('hud.wrigpool')))
      setStatus('wriggled')
      setTimeout(() => setStatus('idle'), BANNER_LINGER_MS)
      return
    }
    // "抓到了" — a card was actually minted: arms the local cooldown,
    // primes the too-soon hint, and shows the celebratory beat before
    // the reveal. Only path that touches nextAllowedRef.
    engine.markCatch()
    // Server-side 5-minute per-diver gate (win-only) — keep locally so
    // the next bite shows the hint instead of the "generating card"
    // tease. Pull the canonical cooldown from the worker's win response
    // (currently 5min) — never hard-code on the client side.
    const cooldownMs = result.retryAfterMs ?? 300000
    nextAllowedRef.current = Date.now() + cooldownMs
    setStatus('grabbed')
    const card = result.card
    setTimeout(() => {
      setCards((prev) => [card, ...prev])
      setReveal(card)
      setStatus('idle')
    }, GRAB_BEAT_MS)
  } catch {
    // Network failure (no card minted) — release the grab gate so the
    // player can retry right away.
    engine.markMiss()
    setStatus('fail')
    setTimeout(() => setStatus('idle'), BANNER_LINGER_MS)
  } finally {
    busyRef.current = false
    engine.resume()
  }
}
