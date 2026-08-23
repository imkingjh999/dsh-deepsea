/**
 * Game audio bus: a per-ocean BGM playlist (rotates through several
 * tracks instead of looping one forever) plus one-shot sfx and rarity
 * voice lines, all streamed from the Worker R2 bucket. Browsers gate
 * autoplay behind a user gesture, so the bus arms itself on the first
 * pointerdown inside the window; the mute toggle persists.
 */

const BASE = 'https://deepsea.openclawd.qzz.io/assets/audio/'
const V = 6 // cache-bust version for the immutable R2 audio

export type VoiceKey = 'rare' | 'epic' | 'legendary' | 'gold' | 'goldlegend'

/** Voice line for a reveal: RARE and above announce their rarity; gold
 * cards announce the foil first, and a gold LEGENDARY gets the full
 * 金色传说 call. Plain COMMON cards stay silent. */
export function voiceClipFor(rarity: string, gold: boolean, en: boolean): VoiceKey | null {
  if (gold && rarity === 'LEGENDARY') return 'goldlegend'
  if (gold) return 'gold'
  if (rarity === 'LEGENDARY') return 'legendary'
  if (rarity === 'EPIC') return 'epic'
  if (rarity === 'RARE') return 'rare'
  return null
}

function clipUrl(name: string): string {
  return BASE + name + '.mp3?v=' + V
}

const MUTE_KEY = 'deepsea.audio.muted'

/** Per-ocean BGM playlists. Each ocean rotates through its own catalog so
 * the soundtrack keeps moving instead of looping one track forever. The
 * Worker route only accepts keys matching `^[a-z0-9_]+$`, so every entry
 * here MUST stay lowercase ASCII with digits / underscores only — any
 * drift breaks the routing on the R2 mirror. */
export const OCEAN_BGM = {
  pacific: ['bgm_pacific_dawn', 'bgm_pacific_turtle', 'bgm_pacific_coral'],
  atlantic: ['bgm_atlantic', 'bgm_atlantic_current', 'bgm_atlantic_abyss'],
  indian: ['bgm_indian', 'bgm_indian_monsoon', 'bgm_indian_route', 'bgm_indian_garden'],
  southern: ['bgm_southern', 'bgm_southern_iceberg', 'bgm_southern_gyre'],
  arctic: ['bgm_arctic', 'bgm_arctic_aurora'],
} as const satisfies Record<string, readonly string[]>

/** Classic shared loop — the pre-ocean fallback for unknown ids. */
const DEFAULT_OCEAN_BGM: readonly string[] = ['bgm']

/** Resolve an ocean id to its BGM playlist. Never empty: unknown ids fall
 * back to the shared `['bgm']` loop. The lookup table is cast to a wide
 * `Record` so a runtime string key yields `readonly string[] | undefined`
 * under `noUncheckedIndexedAccess` — the `??` handles the miss. */
export function oceanBgmList(ocean: string): readonly string[] {
  const list = (OCEAN_BGM as Record<string, readonly string[]>)[ocean]
  return list ?? DEFAULT_OCEAN_BGM
}

/** Pick a random starting track inside `list`. Returns 0 for an empty list
 * so callers always get a valid (if degenerate) cursor. */
export function pickStartIndex(list: readonly string[]): number {
  if (list.length === 0) return 0
  return Math.floor(Math.random() * list.length)
}

/** Advance the playlist cursor with wrap-around. */
export function nextIndex(list: readonly string[], current: number): number {
  if (list.length === 0) return 0
  return (current + 1) % list.length
}

/** True when a keydown originated inside a text field — hotkeys must not
 * fire while the user is typing (the DSH chat input lives on the page). */
export function isTypingTarget(t: EventTarget | null | undefined): boolean {
  const el = t as { tagName?: string, isContentEditable?: boolean } | null
  if (el === null || el === undefined) return false
  const tag = (el.tagName ?? '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
}

class AudioBus {
  private bgm: HTMLAudioElement | null = null
  /** The session ocean's BGM playlist + cursor. Defaults to the shared
   * 'bgm' fallback so the bus is safe to instantiate in environments
   * with no Audio (node tests) — nothing plays until `setBgmOcean` /
   * `attach` wire up a real element. */
  private bgmList: readonly string[] = DEFAULT_OCEAN_BGM
  private bgmIndex = 0
  private sfxPool = new Map<string, HTMLAudioElement[]>()
  private sfxAt = new Map<string, number>()
  private voiceEl: HTMLAudioElement | null = null
  private attached = false
  /** Sticky window-hidden flag (float window minimized / boss key). Every
   * play entry point checks it: setHidden(true) only pauses what is already
   * playing, so without remembering the state the first-pointerdown arm
   * listener (a window-level listener that fires on ANY GUI click), the
   * unmute hotkey, or a queued track-end could restart the BGM while the
   * window stays minimized — the browser tab would keep its "playing"
   * indicator with no visible source. */
  private hidden = false
  muted = false

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1' } catch { this.muted = false }
  }

  /** Pick the session ocean's BGM playlist (called once per session, right
   * after the ocean roll). The bus chooses a random starting track so the
   * same ocean feels different on replay; when the current track ends,
   * the bus hops to the next one (wrap around). Unknown oceans fall back
   * to the shared `['bgm']` loop. If audio is already armed and the
   * playlist / cursor actually moved, the old element is torn down and a
   * new one is started immediately (preserves the wasPlaying-then-
   * restart rule). */
  setBgmOcean(ocean: string): void {
    const list = oceanBgmList(ocean)
    const startIndex = pickStartIndex(list)
    if (list === this.bgmList && startIndex === this.bgmIndex) return
    this.bgmList = list
    this.bgmIndex = startIndex
    if (this.bgm !== null) {
      const wasPlaying = !this.bgm.paused && !this.muted
      this.detachBgm()
      if (wasPlaying) this.startBgm()
    }
  }

  /** Arm on the first user gesture: unlock + start the BGM loop. */
  attach(): void {
    if (this.attached) return
    this.attached = true
    const arm = (): void => {
      this.startBgm()
      window.removeEventListener('pointerdown', arm)
    }
    window.addEventListener('pointerdown', arm)
    // A click that happened before attach (rare) can still unlock via play().
  }

  private startBgm(): void {
    if (typeof Audio === 'undefined') return // jsdom/headless: no audio env
    if (this.hidden) return // minimized: never (re)start the BGM hidden
    if (this.bgm === null) {
      const track = this.bgmList[this.bgmIndex]
      if (track === undefined) return // empty list: nothing to play
      const el = new Audio(clipUrl(track))
      el.loop = false
      el.volume = 0.32
      el.preload = 'auto'
      el.addEventListener('ended', this.onBgmEnded)
      this.bgm = el
    }
    if (this.muted) return
    void this.bgm.play().catch(() => { /* still gated; retried on next sfx */ })
  }

  /** Tear down the current BGM element (release the ended listener +
   * pause). Pure GC / disposal helper — does not touch the playlist
   * cursor, so callers can resume later with `startBgm`. */
  private detachBgm(): void {
    const el = this.bgm
    if (el === null) return
    el.removeEventListener('ended', this.onBgmEnded)
    el.pause()
    this.bgm = null
  }

  /** Advance through the playlist when the current track finishes.
   * Suppressed while muted or hidden so a paused / muted element can never
   * fire a phantom ended that would silently auto-play the next track under
   * the user's preference or behind a minimized window. */
  private onBgmEnded = (): void => {
    if (this.muted || this.hidden) return
    const next = nextIndex(this.bgmList, this.bgmIndex)
    if (next === this.bgmIndex) {
      // Single-track ocean (or degenerate list): the natural 'replay from
      // the top' behavior of an endless loop, but done explicitly because
      // the element's own `loop` is false.
      const el = this.bgm
      if (el === null) return
      el.currentTime = 0
      void el.play().catch(() => {})
      return
    }
    this.bgmIndex = next
    this.detachBgm()
    this.startBgm()
  }

  /** One-shot sound effect (bite, open, gold sting). Never throws. */
  sfx(name: 'bite' | 'open' | 'gold'): void {
    if (this.muted || this.hidden || typeof Audio === 'undefined') return
    if (this.bgm !== null && this.bgm.paused) void this.bgm.play().catch(() => {})
    let pool = this.sfxPool.get(name)
    if (pool === undefined) {
      pool = [new Audio(clipUrl('sfx_' + name)), new Audio(clipUrl('sfx_' + name))]
      for (const el of pool) { el.preload = 'auto'; el.volume = 0.8 }
      this.sfxPool.set(name, pool)
    }
    const at = this.sfxAt.get(name) ?? 0
    const el = pool[at % pool.length] ?? null
    this.sfxAt.set(name, at + 1)
    if (el === null) return
    el.currentTime = 0
    void el.play().catch(() => {})
  }

  /** Voice line; the latest call wins (interrupts a stale announcement). */
  voice(key: VoiceKey, en: boolean): void {
    if (this.muted || this.hidden || typeof Audio === 'undefined') return
    if (this.voiceEl !== null) { this.voiceEl.pause() }
    const el = new Audio(clipUrl('voice_' + (en ? 'en' : 'zh') + '_' + key))
    el.volume = 1
    this.voiceEl = el
    void el.play().catch(() => {})
  }

  /** Window hidden (minimized/boss key): pause the BGM and any live voice
   * line without touching the mute preference — and remember the state so
   * no later play path (arm, unmute, track advance) can restart audio
   * behind the minimized window. Restoring resumes the BGM. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden
    if (hidden) {
      this.bgm?.pause()
      this.voiceEl?.pause()
    } else if (!this.muted) {
      this.startBgm()
    }
  }

  /** Toggle mute; stops/starts the BGM accordingly. Returns the new state. */
  toggleMute(): boolean {
    this.muted = !this.muted
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0') } catch { /* private mode */ }
    if (this.muted) {
      this.bgm?.pause()
      this.voiceEl?.pause()
    } else {
      this.startBgm()
    }
    return this.muted
  }
}

export const audioBus = new AudioBus()
