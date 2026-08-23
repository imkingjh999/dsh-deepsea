/**
 * Pure pool-card wire format — no Worker/D1/R2 types, safe for any
 * tsconfig (the client-side test suite imports this directly).
 */
import { starOf, starRankOf, starRankOfStar, goldOf } from './stars.ts'

export function poolCardJson(row: {
  mint_id: string, block_height: number, name: string, species: string, story: string,
  rarity: string, zone: string, caught_at: number | null, star: string | null,
}, diverKey?: string): {
  mintId: string, height: number, name: string, species: string, story: string,
  rarity: string, zone: string, caughtAt: number | null,
  star: string, starRank: number, gold: boolean,
  assets: { art: string, holo: string, mask: string },
} {
  return {
    mintId: row.mint_id, height: row.block_height, name: row.name, species: row.species,
    story: row.story, rarity: row.rarity, zone: row.zone, caughtAt: row.caught_at,
    star: row.star ?? starOf(row.name), starRank: row.star !== null
      ? starRankOfStar(row.star) : starRankOf(row.name),
    // Gold is rolled PER WINNER: when a diver claims a card the foil hash
    // mixes their key, so among the winners of one release some hold gold
    // and others plain. Previews (no diver key) show the plain face.
    gold: diverKey !== undefined ? goldOf(row.mint_id + ':' + diverKey) : false,
    assets: {
      art: `/assets/cards/${row.mint_id}/art.png`,
      holo: `/assets/cards/${row.mint_id}/holo.png`,
      mask: `/assets/cards/${row.mint_id}/mask.png`,
    },
  }
}
