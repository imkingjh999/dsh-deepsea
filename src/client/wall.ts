/**
 * The 108-seat collection album model behind the card wall.
 *
 * Pure logic, no React/DOM: split the player's obtained cards into the
 * fixed star-seat table (matched by CardRecord.starRank) plus a defensive
 * overflow list. The seat count comes from the single roster source of
 * truth (src/heroes-108.ts) so the wall can never drift from the mint
 * plan. Locked seats render as black placeholders in the UI — only the
 * seat rank lives here, hero identity is never exposed for uncaught
 * seats.
 */
import type { CardRecord, Rarity } from './depth.ts'
import { HEROES } from '../heroes-108.ts'

/** Total seats on the wall — the roster length (108 by canon). */
export const SEAT_COUNT: number = HEROES.length

/** Display weight per rarity — bigger = rarer = further DOWN the wall. */
export const RARITY_WEIGHT: Record<Rarity, number> = { COMMON: 0, RARE: 1, EPIC: 2, LEGENDARY: 3 }

/**
 * Seat ranks in wall display order: least rare first (top of the grid),
 * rarest last (bottom), rank ascending within a tier. Derived from the
 * roster so it can never drift from the mint plan.
 */
export const SEAT_DISPLAY_ORDER: readonly number[] = HEROES
  .slice()
  .sort((a, b) => RARITY_WEIGHT[a.rarity] - RARITY_WEIGHT[b.rarity] || a.rank - b.rank)
  .map((h) => h.rank)

/** One claimed seat: the representative card plus how many copies of it
 * the diver owns — duplicates FOLD INTO their seat (the wall always shows
 * at most 108 cards; extra copies render as a ×N badge on the card). */
export interface SeatCard {
  card: CardRecord
  /** Copies owned of this seat's card, the representative being the
   * newest catch (the host serves cards newest-first). */
  count: number
}

/** Result of partitioning the player's obtained cards onto the seats. */
export interface WallAlbum {
  /** Index 0 = star seat rank 1. Undefined = seat not obtained (locked). */
  readonly seats: ReadonlyArray<SeatCard | undefined>
  /**
   * Cards that could not claim ANY seat: no valid starRank (0/absent/out
   * of range, e.g. offline on-demand catches). Extra copies do NOT land
   * here — they fold into their seat's count. Still player-owned, so the
   * wall renders these in a small overflow row instead of hiding them.
   */
  readonly unseated: readonly CardRecord[]
  /** Distinct seats obtained — the X in the "X/108" header. */
  readonly obtained: number
  /** Total copies across all seats (for the header total, optional). */
  readonly copies: number
}

/** A starRank actually addresses a seat on the wall. */
export function isSeatedRank(rank: number | undefined): rank is number {
  return typeof rank === 'number' && Number.isInteger(rank) && rank >= 1 && rank <= SEAT_COUNT
}

/**
 * Partition obtained cards onto the 108 seats. The host serves cards
 * newest-first, so the FIRST card seen for a seat claims it (newest catch
 * shown) and every later duplicate increments that seat's count — no
 * player-owned card is ever dropped, and the wall stays ≤ 108 cards.
 */
export function buildWallAlbum(cards: readonly CardRecord[]): WallAlbum {
  const seats: Array<SeatCard | undefined> = new Array<SeatCard | undefined>(SEAT_COUNT).fill(undefined)
  const unseated: CardRecord[] = []
  let obtained = 0
  let copies = 0
  for (const card of cards) {
    const rank = card.starRank
    if (!isSeatedRank(rank)) {
      unseated.push(card)
      continue
    }
    const seat = seats[rank - 1]
    if (seat === undefined) {
      seats[rank - 1] = { card, count: 1 }
      obtained += 1
      copies += 1
    } else {
      seat.count += 1
      copies += 1
    }
  }
  return { seats, unseated, obtained, copies }
}

/** Target card width (px) for the adaptive wall grid — the average case a
 * desktop layout settles into. Used as the divisor of wallGrid(). */
const WALL_TARGET = 130

/** Gap (px) between columns / rows of the wall grid. */
export const WALL_GAP = 10

/** Minimum / maximum columns the adaptive grid may render — narrower than
 * 2 reads as a stripped layout (cards become enormous), wider than 8
 * crushes each card below its readable size. */
const WALL_COLS_MIN = 2
const WALL_COLS_MAX = 8

/** Card width bounds (px). Below 96 the name plate truncates unhelpfully;
 * above 170 the cards feel out of proportion with the panel chrome. */
const WALL_CARD_W_MIN = 96
const WALL_CARD_W_MAX = 170

/** Safe defaults used when the caller passes a non-positive container
 * width (mount race, hidden host, etc.). 4 columns at 118px matches the
 * historical fixed layout, so a briefly collapsed frame falls back to
 * the v36 look before the ResizeObserver settles. */
const WALL_SAFE: { cols: number, cardW: number } = { cols: 4, cardW: 118 }

/**
 * Adaptive column count + card width for the card wall given the actual
 * horizontal pixels of the scroll container. Wide windows fan out (more
 * columns, slightly larger cards), narrow windows collapse to two columns
 * instead of overflowing horizontally. Pure / deterministic — the React
 * side passes the current `clientWidth` and re-renders the grid template.
 */
export function wallGrid(containerW: number): { cols: number, cardW: number } {
  if (!(containerW > 0)) return WALL_SAFE
  const rawCols = Math.floor((containerW + WALL_GAP) / (WALL_TARGET + WALL_GAP))
  const cols = Math.min(Math.max(rawCols, WALL_COLS_MIN), WALL_COLS_MAX)
  const rawW = Math.floor((containerW - (cols - 1) * WALL_GAP) / cols)
  const cardW = Math.min(Math.max(rawW, WALL_CARD_W_MIN), WALL_CARD_W_MAX)
  return { cols, cardW }
}
