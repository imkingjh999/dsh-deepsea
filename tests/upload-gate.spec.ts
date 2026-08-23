/**
 * v4 anti-cheat upload gate — pure function coverage.
 *
 * The worker's /api/upload no longer writes anything: a card counts only
 * when (publicKey, mintId) exists in the server-adjudicated pow_wins
 * ledger. candidateMints is the batch-side filter that decides which
 * claims are even worth checking against the ledger — everything else is
 * silently dropped, so forged rarity/depth/name never reach a query.
 */
import { describe, expect, it } from 'vitest'
import { candidateMints } from '../cloudflare/src/upload-gate.ts'

const card = (mintId: string | undefined, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  mintId, id: 'c1', name: '斑点雀鲷', rarity: 'COMMON', depth: 0.4, zone: 'sunlit', createdAt: 1, ...extra,
})

describe('candidateMints — the only claims worth checking', () => {
  it('keeps well-formed mint ids', () => {
    expect(candidateMints([card('DS-0001-a4604f29') as never])).toEqual(['DS-0001-a4604f29'])
  })

  it('drops legacy cards without a mint (they verify as 0, no error)', () => {
    expect(candidateMints([card(undefined) as never, card('') as never])).toEqual([])
  })

  it('drops malformed mints: too long, wrong type', () => {
    expect(candidateMints([
      card('x'.repeat(41)) as never,
      card(42 as unknown as string) as never,
      card(null as unknown as string) as never,
    ])).toEqual([])
  })

  it('dedupes repeated mints — one ledger lookup per claim', () => {
    const many = Array.from({ length: 20 }, () => card('DS-0007-beef') as never)
    expect(candidateMints(many)).toEqual(['DS-0007-beef'])
  })

  it('never trusts the other fields — forged rarity/depth ride along but do not matter', () => {
    // A batch of "LEGENDARY depth=1" forgeries: only the mintIds are
    // candidates; the worker checks them against pow_wins where this
    // diver has no rows → verified 0, nothing written.
    const forged = [card('DS-FAKE-0001', { rarity: 'LEGENDARY', depth: 1 }) as never]
    expect(candidateMints(forged)).toEqual(['DS-FAKE-0001'])
  })
})
