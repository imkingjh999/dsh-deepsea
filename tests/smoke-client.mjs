/**
 * Headless smoke test for the dsh-deepsea client bundle.
 * Loads lib/client.js through the ModuleLoader protocol with jsdom globals,
 * then asserts: bundle id, static inject, floating window host mounts on
 * body, canvas + HUD render, dormant path (no sessions) stays clean.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// The harness checkout sits next to the dsh-plugins workspace; resolve it
// relatively so no machine-specific home path is baked into the repo.
const here = dirname(fileURLToPath(import.meta.url))
const PNPM = join(here, '../../../deepseek-harness/node_modules/.pnpm') + '/'
const reactRequire = createRequire(`${PNPM}react@18.3.1/node_modules/react/index.js`)
const React = reactRequire('react')
const { act } = reactRequire('react')
const { createRoot } =
  createRequire(`${PNPM}react-dom@18.3.1_react@18.3.1/node_modules/react-dom/client.js`)('react-dom/client')
const jsxRuntime = reactRequire('react/jsx-runtime')
const jsdomRequire = createRequire(`${PNPM}jsdom@29.1.1/node_modules/jsdom/package.json`)
const { JSDOM } = jsdomRequire('jsdom')

const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { pretendToBeVisual: true, url: 'http://127.0.0.1:3148/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
try { globalThis.navigator = dom.window.navigator } catch { /* readonly */ }
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb }
  observe(el) { queueMicrotask(() => this.cb([{ target: el }])) }
  unobserve() {}
  disconnect() {}
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, value: { cards: [] } }) })

let exports_
const loader = {
  load({ id, factory }) {
    if (id === 'dsh-deepsea') {
      exports_ = factory((spec) => {
        if (spec === 'react') return React
        if (spec === 'react/jsx-runtime') return jsxRuntime
        if (spec === 'react-dom/client') return { createRoot }
        throw new Error(`unexpected module "${spec}"`)
      })
    }
  },
}
globalThis.__ModuleLoader__ = loader
dom.window.__ModuleLoader__ = loader

await import('../lib/client.js')

if (exports_ === undefined) throw new Error('bundle never registered')
if (exports_.apply === undefined) throw new Error('exports.apply missing')
console.error('bundle exports ok (apply present, static inject:',
  String(exports_.inject), ')')

// apply with NO services (sessions fiber never fires) — must not throw.
exports_.apply({ effect(fn) { fn(); return () => {} }, inject() { return { dispose() {} } } })
await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
const host = document.querySelector('[data-dsh-deepsea]')
if (host === null) throw new Error('floating window host not mounted')
const html = document.body.textContent ?? ''
if (!html.includes('深海垂爪')) throw new Error('shell title missing')
if (document.querySelector('canvas') === null) throw new Error('ocean canvas missing')
if (!html.includes('暂无上下文数据') && !html.includes('no context data')) throw new Error('HUD empty-state missing')
console.error('dormant mount: host + canvas + HUD ✓')

// Alt+M must toggle mute even while a text field holds focus (the DSH
// chat input is contenteditable and focused most of the time) — the
// hotkey is a modifier combo, global like the boss key.
const soundBtn = () => document.querySelector('[aria-label="deepsea-sound"]')
if (soundBtn() === null) throw new Error('sound button missing')
const iconBefore = soundBtn().textContent
const field = document.createElement('input')
document.body.appendChild(field)
field.focus()
field.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
  key: 'µ', code: 'KeyM', altKey: true, bubbles: true, cancelable: true,
}))
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const iconAfter = soundBtn().textContent
if (iconBefore === iconAfter) throw new Error('Alt+M did not flip the mute icon from a focused input')
console.error('Alt+M global mute ✓ (input focused, icon flipped)')
console.error('SMOKE TEST PASSED')
process.exit(0)
