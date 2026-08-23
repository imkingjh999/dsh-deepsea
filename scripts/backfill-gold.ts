/** One-shot: stamp the deterministic gold roll onto every local card so
 * the wall/reveal render it immediately (new draws carry gold from the
 * Worker already). Usage: pnpm dlx tsx scripts/backfill-gold.ts [--dry] */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { goldOf } from '../cloudflare/src/stars.ts'

const dry = process.argv.includes('--dry')
const root = join(homedir(), '.dsh', 'deepsea', 'cards')
let stamped = 0; let gold = 0; let skipped = 0
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const p = join(root, entry.name, 'card.json')
  if (!existsSync(p)) { skipped++; continue }
  try {
    const card = JSON.parse(await readFile(p, 'utf8')) as { id?: string, mintId?: string, gold?: boolean }
    if (card.id === undefined) { skipped++; continue }
    const g = goldOf(card.mintId ?? 'local:' + card.id)
    if (card.gold === g) { skipped++; continue }
    card.gold = g
    if (!dry) await writeFile(p, JSON.stringify(card, null, 2), 'utf8')
    stamped++; if (g) gold++
  } catch { skipped++ }
}
process.stdout.write('backfill-gold: stamped ' + stamped + ' (gold ' + gold + '), unchanged '
  + skipped + (dry ? ' [dry]' : '') + String.fromCharCode(10))