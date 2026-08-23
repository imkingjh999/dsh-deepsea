/**
 * fix-sprite-heading.ts — normalize generated sprites to head-RIGHT.
 * Generation prompts ask for head-right, but image models drift; a
 * head-LEFT sprite swims backwards once the renderer mirrors it for
 * leftward motion (user-visible as head-right fish moving left).
 * Classify each sprite with the vision chat model and PIL-mirror the
 * LEFT-facing ones. Kinds are re-uploaded to R2; card sprites are
 * fixed in place (host serves them with no-store).
 *
 * Usage: pnpm dlx tsx scripts/fix-sprite-heading.ts [--kinds] [--cards]
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySpriteHeading, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const FAUNA_DIR = '/tmp/deepsea-fauna'
const CARD_ROOT = join(process.env.HOME ?? '.', '.dsh', 'deepsea', 'cards')
const KINDS = ['fish', 'turtle', 'hatchet', 'jelly', 'viper', 'squid', 'angler', 'octopus', 'eel']

function mirror(path: string): void {
  const r = spawnSync('python3', ['scripts/mirror_png.py', path], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('mirror failed: ' + String(r.stderr))
}

function r2put(kind: string): void {
  const r = spawnSync('./node_modules/.bin/wrangler',
    ['r2', 'object', 'put', 'deepsea-cards/fauna/' + kind + '.png',
      '--file', join(FAUNA_DIR, kind + '.png'), '--remote', '--content-type', 'image/png'],
    { cwd: 'cloudflare', encoding: 'utf8' })
  if (r.status !== 0) throw new Error('r2 put failed: ' + String(r.stderr))
}

async function fix(label: string, path: string, mm: MiniMaxConfig, upload: boolean): Promise<void> {
  try {
    const b64 = (await readFile(path)).toString('base64')
    const heading = await classifySpriteHeading(mm, b64)
    if (heading === 'LEFT') {
      mirror(path)
      if (upload) r2put(label)
      process.stdout.write(label + ': LEFT -> mirrored' + (upload ? ' + uploaded' : '') + String.fromCharCode(10))
    } else {
      process.stdout.write(label + ': ' + heading + ' (keep)' + String.fromCharCode(10))
    }
  } catch (err) {
    process.stdout.write(label + ': ERROR '
      + (err instanceof Error ? err.message : String(err)) + String.fromCharCode(10))
  }
}

async function main(): Promise<void> {
  const wantKinds = process.argv.includes('--kinds')
  const wantCards = process.argv.includes('--cards')
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  if (wantKinds) {
    for (const kind of KINDS) {
      const p = join(FAUNA_DIR, kind + '.png')
      if (existsSync(p)) await fix(kind, p, mm, true)
    }
  }
  if (wantCards) {
    const dirs = (await readdir(CARD_ROOT, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    for (const id of dirs) {
      const p = join(CARD_ROOT, id, 'sprite.png')
      if (existsSync(p)) await fix(id, p, mm, false)
    }
  }
  process.stdout.write('heading fix done' + String.fromCharCode(10))
}

void main()
