// @vitest-environment jsdom
//
// Consumer-level regression for the "minimized deepsea window cannot be
// recovered" bug: dsh-float-window 0.1.0 gave panels and launchers the same
// hardcoded z-index, so with two plugin windows installed (deepsea +
// shorts-wall) the minimized launcher ended up underneath the other window's
// panel — invisible and unclickable. These specs pin the shipped dependency's
// guarantees: launchers live in a z band above every panel, restoring raises
// the window above its sibling, and two minimized launchers stack on offset
// slots instead of the same pixel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FloatWindow } from 'dsh-float-window'
import type { FloatWindowLabels } from 'dsh-float-window'

const LABELS: FloatWindowLabels = {
  openTitle: '打开', expandTitle: '展开', minimizeTitle: '最小化',
  modeToggleTip: '切换', floatText: '浮动', bossKeyText: '老板键 {key}',
}

interface Mounted { host: HTMLDivElement, root: Root }

const mounted: Mounted[] = []

function mountFloat(storageKey: string): Mounted {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(createElement(FloatWindow, {
      storageKey,
      title: storageKey,
      accent: '#7fc4ff',
      labels: LABELS,
      children: createElement('p', null, 'content'),
    }))
  })
  const entry: Mounted = { host, root }
  mounted.push(entry)
  return entry
}

const panelOf = (m: Mounted): HTMLElement =>
  m.host.querySelector('[data-shell-panel]') as HTMLElement
const launcherOf = (m: Mounted): HTMLElement | null =>
  m.host.querySelector('[data-shell-launcher]')
const minBtnOf = (m: Mounted): HTMLElement =>
  m.host.querySelector('[data-shell-minimize]') as HTMLElement
const zOf = (el: HTMLElement): number => Number.parseInt(getComputedStyle(el).zIndex, 10)
const click = (el: HTMLElement): void => {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

beforeEach(() => {
  localStorage.clear()
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  delete (window as unknown as { __dshFloatWindows?: unknown }).__dshFloatWindows
})

afterEach(() => {
  for (const m of mounted) {
    act(() => { m.root.unmount() })
    m.host.remove()
  }
  mounted.length = 0
})

describe('dsh-float-window multi-window guarantees (installed dependency)', () => {
  it('keeps a minimized launcher above another plugin window', () => {
    const a = mountFloat('deepsea-spec:a')
    const b = mountFloat('deepsea-spec:b')

    click(minBtnOf(a))

    const launcher = launcherOf(a)
    expect(launcher).not.toBeNull()
    expect(zOf(launcher as HTMLElement)).toBeGreaterThan(zOf(panelOf(b)))
  })

  it('restores a minimized window above its sibling', () => {
    const a = mountFloat('deepsea-spec:a')
    const b = mountFloat('deepsea-spec:b')
    click(minBtnOf(a))

    click(launcherOf(a) as HTMLElement)

    expect(getComputedStyle(panelOf(a)).visibility).toBe('visible')
    expect(zOf(panelOf(a))).toBeGreaterThan(zOf(panelOf(b)))
  })

  it('offsets two minimized launchers instead of stacking on one pixel', () => {
    const a = mountFloat('deepsea-spec:a')
    const b = mountFloat('deepsea-spec:b')
    click(minBtnOf(a))
    click(minBtnOf(b))

    expect(getComputedStyle(launcherOf(a) as HTMLElement).bottom).toBe('18px')
    expect(getComputedStyle(launcherOf(b) as HTMLElement).bottom).toBe('70px')
  })

  it('gives the second window its own boss key (installed dep >= 0.2)', () => {
    const a = mountFloat('deepsea-spec:a')
    const b = mountFloat('deepsea-spec:b')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 's', code: 'KeyS', altKey: true, bubbles: true, cancelable: true,
      }))
    })

    // Alt+S toggles the first window only; the sibling answers to Alt+X.
    expect(getComputedStyle(panelOf(a)).visibility).toBe('hidden')
    expect(getComputedStyle(panelOf(b)).visibility).toBe('visible')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'x', code: 'KeyX', altKey: true, bubbles: true, cancelable: true,
      }))
    })
    expect(getComputedStyle(panelOf(b)).visibility).toBe('hidden')
  })
})
