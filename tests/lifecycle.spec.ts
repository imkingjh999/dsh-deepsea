/**
 * Lifecycle gate: the built client bundle must pass the headless smoke run
 * (ModuleLoader protocol + jsdom + real createRoot) after every build. The
 * heavy DOM/React wiring lives in tests/smoke-client.mjs — this spec executes
 * it as a subprocess (vitest's module transform would otherwise interfere
 * with the CJS closure factory's require contract) and asserts a clean exit.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

describe('deepsea client lifecycle (bundle smoke)', () => {
  it('mounts the floating window with ocean canvas + HUD', () => {
    const run = spawnSync(process.execPath, [join(here, 'smoke-client.mjs')], {
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(run.status).toBe(0)
    const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
    expect(out).toContain('dormant mount: host + canvas + HUD')
    expect(out).toContain('SMOKE TEST PASSED')
  })
})
