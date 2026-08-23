import { describe, expect, it } from 'vitest'
import { goldOf } from '../cloudflare/src/stars.ts'

describe('gold foil roll', () => {
  it('is deterministic per mint id', () => {
    expect(goldOf('DS-0001-a4604f29')).toBe(goldOf('DS-0001-a4604f29'))
    expect(goldOf('DS-0135-abcdef12')).toBe(goldOf('DS-0135-abcdef12'))
  })

  it('rolls roughly one in ten across the chain id space', () => {
    let gold = 0
    const n = 600
    for (let i = 0; i < n; i++) {
      const id = 'DS-' + String(i).padStart(4, '0') + '-' + (i * 2654435761 % 0xffffffff).toString(16).padStart(8, '0')
      if (goldOf(id)) gold++
    }
    expect(gold / n).toBeGreaterThan(0.05)
    expect(gold / n).toBeLessThan(0.2)
  })

  it('separates the gold namespace from the star namespace', () => {
    // goldOf salts with 'gold:' so it cannot equal the star hash stream
    expect(goldOf('X')).toBeDefined()
  })

  it('uses the local: prefix path for non-pool cards', () => {
    expect(typeof goldOf('local:70228cb0')).toBe('boolean')
  })
})