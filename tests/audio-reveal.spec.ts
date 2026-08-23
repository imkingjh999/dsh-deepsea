import { describe, expect, it, beforeEach, afterAll } from 'vitest'
import {
  audioBus,
  voiceClipFor,
  isTypingTarget,
  OCEAN_BGM,
  oceanBgmList,
  pickStartIndex,
  nextIndex,
} from '../src/client/audio.ts'
import { revealPlan } from '../src/client/reveal-fx.tsx'

describe('typing-target guard for the mute hotkey', () => {
  const asTarget = (o: object): EventTarget => o as unknown as EventTarget

  it('blocks input, textarea, select and contenteditable targets', () => {
    expect(isTypingTarget(asTarget({ tagName: 'INPUT' }))).toBe(true)
    expect(isTypingTarget(asTarget({ tagName: 'textarea' }))).toBe(true)
    expect(isTypingTarget(asTarget({ tagName: 'SELECT' }))).toBe(true)
    expect(isTypingTarget(asTarget({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('lets plain keys through and tolerates null', () => {
    expect(isTypingTarget(asTarget({ tagName: 'SPAN' }))).toBe(false)
    expect(isTypingTarget(asTarget({ isContentEditable: false }))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget(undefined)).toBe(false)
  })
})

describe('voice clip selection', () => {
  it('stays silent for plain common cards', () => {
    expect(voiceClipFor('COMMON', false, false)).toBeNull()
  })

  it('announces rarity from rare upward', () => {
    expect(voiceClipFor('RARE', false, false)).toBe('rare')
    expect(voiceClipFor('EPIC', false, false)).toBe('epic')
    expect(voiceClipFor('LEGENDARY', false, false)).toBe('legendary')
  })

  it('gold foil wins over the rarity line, golden legendary is the max', () => {
    expect(voiceClipFor('COMMON', true, false)).toBe('gold')
    expect(voiceClipFor('EPIC', true, false)).toBe('gold')
    expect(voiceClipFor('LEGENDARY', true, false)).toBe('goldlegend')
  })

  it('shares the mapping across locales', () => {
    expect(voiceClipFor('LEGENDARY', true, true)).toBe('goldlegend')
    expect(voiceClipFor('RARE', false, true)).toBe('rare')
  })
})

describe('reveal spectacle plan', () => {
  it('scales strictly with rarity', () => {
    const c = revealPlan('COMMON', false).level
    const r = revealPlan('RARE', false).level
    const e = revealPlan('EPIC', false).level
    const l = revealPlan('LEGENDARY', false).level
    expect(c).toBe(0)
    expect(r).toBeGreaterThan(c)
    expect(e).toBeGreaterThan(r)
    expect(l).toBeGreaterThan(e)
  })

  it('reserves level 4 + rainbow for the golden legendary', () => {
    const plan = revealPlan('LEGENDARY', true)
    expect(plan.level).toBe(4)
    expect(plan.rainbow).toBe(true)
    expect(plan.shake).toBe(true)
    expect(plan.particles).toBeGreaterThan(revealPlan('LEGENDARY', false).particles)
  })

  it('keeps commons minimal but lets gold commons shine', () => {
    expect(revealPlan('COMMON', false).particles).toBe(0)
    expect(revealPlan('COMMON', false).shake).toBe(false)
    expect(revealPlan('COMMON', true).particles).toBe(8) // a few gold sparks
    expect(revealPlan('COMMON', true).level).toBe(0)
  })
})

describe('ocean BGM playlist catalog', () => {
  const REQUIRED_OCEANS = ['pacific', 'atlantic', 'indian', 'southern', 'arctic'] as const

  it('binds every required ocean to a non-empty playlist', () => {
    for (const ocean of REQUIRED_OCEANS) {
      const list = oceanBgmList(ocean)
      expect(list.length).toBeGreaterThan(0)
    }
  })

  it('emits only worker-route-friendly keys (^[a-z0-9_]+$)', () => {
    // The Worker R2 route only accepts lowercase ASCII keys — any drift
    // here silently 404s the BGM mirror, so the regex guard is intentional.
    for (const list of Object.values(OCEAN_BGM)) {
      for (const key of list) {
        expect(key).toMatch(/^[a-z0-9_]+$/)
      }
    }
  })

  it('has every key distinct across the whole catalog (no cross-ocean reuse)', () => {
    const seen = new Set<string>()
    for (const list of Object.values(OCEAN_BGM)) {
      for (const key of list) {
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('falls back to the classic ["bgm"] loop for unknown oceans (case-sensitive)', () => {
    expect(oceanBgmList('')).toEqual(['bgm'])
    expect(oceanBgmList('mystery')).toEqual(['bgm'])
    // Case matters: "PACIFIC" is not a known id, so it must NOT match the
    // pacific playlist.
    expect(oceanBgmList('PACIFIC')).toEqual(['bgm'])
  })
})

describe('BGM playlist cursor helpers', () => {
  it('pickStartIndex lands inside the list bounds', () => {
    const list = ['a', 'b', 'c']
    for (let i = 0; i < 50; i++) {
      const idx = pickStartIndex(list)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(list.length)
    }
  })

  it('pickStartIndex of an empty list returns 0 (safe degenerate cursor)', () => {
    expect(pickStartIndex([])).toBe(0)
  })

  it('nextIndex wraps around at the end of the playlist', () => {
    const list = ['a', 'b', 'c']
    expect(nextIndex(list, 0)).toBe(1)
    expect(nextIndex(list, 1)).toBe(2)
    expect(nextIndex(list, 2)).toBe(0) // wrap
  })

  it('nextIndex of an empty list returns 0 (no advance on degenerate cursor)', () => {
    expect(nextIndex([], 0)).toBe(0)
  })
})

describe('hidden-window playback gate (tab "playing" indicator)', () => {
  /** Minimal HTMLAudioElement stand-in: records creation order, tracks the
   * paused flag, and can fire the 'ended' listeners the bus registers. */
  class FakeAudio {
    static created: FakeAudio[] = []
    static reset(): void { FakeAudio.created = [] }
    paused = true
    currentTime = 0
    volume = 1
    loop = false
    preload = ''
    private endedFns: (() => void)[] = []
    constructor(public src: string) { FakeAudio.created.push(this) }
    play(): Promise<void> { this.paused = false; return Promise.resolve() }
    pause(): void { this.paused = true }
    addEventListener(type: string, fn: () => void): void {
      if (type === 'ended') this.endedFns.push(fn)
    }
    removeEventListener(type: string, fn: () => void): void {
      if (type === 'ended') this.endedFns = this.endedFns.filter((f) => f !== fn)
    }
    fireEnded(): void { for (const fn of [...this.endedFns]) fn() }
  }

  // The bus is a singleton with private state — poke it through a cast so
  // each case starts from a clean slate.
  const bus = audioBus as unknown as {
    bgm: FakeAudio | null
    voiceEl: FakeAudio | null
    hidden: boolean
    muted: boolean
  }
  const g = globalThis as unknown as { Audio?: unknown }
  const prevAudio = g.Audio

  beforeEach(() => {
    g.Audio = FakeAudio
    FakeAudio.reset()
    bus.bgm = null
    bus.voiceEl = null
    bus.hidden = false
    bus.muted = false
  })
  afterAll(() => {
    if (prevAudio === undefined) delete g.Audio
    else g.Audio = prevAudio
  })

  it('starts nothing while hidden: the unmute/sfx/voice paths stay silent', () => {
    audioBus.setHidden(true)
    // The unmute hotkey (window-level Alt+M) fires while minimized — the
    // old bus restarted the BGM here and the tab kept its 🔊 indicator.
    audioBus.toggleMute()
    audioBus.toggleMute()
    audioBus.sfx('bite')
    audioBus.voice('rare', false)
    expect(FakeAudio.created).toHaveLength(0)
    expect(bus.bgm).toBeNull()
  })

  it('resumes the BGM when the window becomes visible again', () => {
    audioBus.setHidden(true)
    audioBus.setHidden(false)
    expect(FakeAudio.created).toHaveLength(1)
    expect(FakeAudio.created[0]?.paused).toBe(false)
  })

  it('minimizing pauses both the BGM and a live voice line', () => {
    audioBus.setHidden(false) // BGM starts
    audioBus.voice('gold', false) // a reveal line talks over it
    expect(bus.bgm?.paused).toBe(false)
    expect(bus.voiceEl?.paused).toBe(false)
    audioBus.setHidden(true)
    expect(bus.bgm?.paused).toBe(true)
    expect(bus.voiceEl?.paused).toBe(true)
  })

  it('a track ending while hidden does not auto-advance the playlist', () => {
    audioBus.setBgmOcean('pacific')
    audioBus.setHidden(false)
    const el = bus.bgm
    expect(el).not.toBeNull()
    audioBus.setHidden(true)
    el?.fireEnded()
    expect(FakeAudio.created).toHaveLength(1) // no next-track element
    expect(bus.bgm).toBe(el) // same element, still parked
  })
})