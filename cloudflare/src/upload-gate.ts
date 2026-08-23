/**
 * v4 anti-cheat upload gate — pure functions, no Worker/D1 types (safe
 * for the root tsconfig and vitest, cf. pow-core.ts).
 *
 * /api/upload no longer writes anything: a card counts only when
 * (publicKey, mintId) exists in the server-adjudicated pow_wins ledger.
 * candidateMints is the batch-side filter deciding which claims are even
 * worth a ledger lookup — everything else is silently dropped, so forged
 * rarity/depth/name values never reach a query.
 */
export interface UploadCard {
  /** The mint the diver claims to have won — the only trusted claim. */
  mintId?: string
  id: string
  name: string
  rarity: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY'
  depth: number
  zone: string
  createdAt: number
}

/** Extract deduped, well-formed mint ids from an upload batch. */
export function candidateMints(cards: UploadCard[]): string[] {
  const out = new Set<string>()
  for (const c of cards) {
    if (typeof c?.mintId === 'string' && c.mintId.length > 0 && c.mintId.length <= 40) out.add(c.mintId)
  }
  return [...out]
}
