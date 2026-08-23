/**
 * Batch card minter — pre-generates the deepsea card pool with MiniMax and
 * uploads each card to the cloud ledger (POST /admin/mint). The catch path
 * then draws from this pool instead of generating on demand.
 *
 * Usage (run from the repo root):
 *   pnpm dlx tsx scripts/mint.ts [--n-per-cell N] [--zone all|sunlit|...]
 *                                [--worker URL] [--token-file PATH] [--dry]
 *
 * Rarity mix per zone mirrors ZONE_WEIGHTS (C-heavy, UR-scarce); --dry runs
 * the whole pipeline but skips the upload.
 */
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chat, generateImage, resolveApiKey } from '../src/minimax.ts'
import { lorePrompts, parseLore, ZONE_WEIGHTS } from '../src/lore.ts'
import type { Rarity } from '../src/client/depth.ts'

const WORKER_DEFAULT = 'https://deepsea.openclawd.qzz.io'
const TOKEN_DEFAULT = join(homedir(), '.dsh', 'deepsea', 'mint-token')
const RARITIES: readonly Rarity[] = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY']

interface Args { nPerCell: number, zone: string, worker: string, tokenFile: string, dry: boolean, limit: number }

function parseArgs(argv: string[]): Args {
  const args: Args = { nPerCell: 2, zone: 'all', worker: WORKER_DEFAULT,
    tokenFile: TOKEN_DEFAULT, dry: false, limit: 0 }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--n-per-cell') args.nPerCell = Number.parseInt(argv[i + 1] ?? '2', 10)
    else if (a === '--zone') args.zone = argv[i + 1] ?? 'all'
    else if (a === '--worker') args.worker = argv[i + 1] ?? WORKER_DEFAULT
    else if (a === '--token-file') args.tokenFile = argv[i + 1] ?? TOKEN_DEFAULT
    else if (a === '--dry') args.dry = true
    else if (a === '--limit') args.limit = Number.parseInt(argv[i + 1] ?? '0', 10)
  }
  return args
}

/**
 * Scale the zone's rarity weights into a per-cell card count. Weight 0 stays
 * 0: rollRarity can never draw that cell, so pre-minting it would only burn
 * image-01 quota on unreachable inventory.
 */
export function planForZone(weights: { COMMON: number, RARE: number, EPIC: number, LEGENDARY: number },
  nPerCell: number): Array<{ rarity: Rarity, count: number }> {
  return RARITIES
    .map((rarity) => ({
      rarity,
      count: weights[rarity] === 0
        ? 0
        : Math.max(1, Math.round((weights[rarity] / 100) * nPerCell * RARITIES.length)),
    }))
    .filter((cell) => cell.count > 0)
}

/** Generate one fresh creature lore, steering away from taken names. */
async function genLore(mm: Parameters<typeof chat>[0], zoneIdx: number, rarity: Rarity,
  avoid: ReadonlySet<string>): Promise<{ name: string, species: string, story: string, imagePrompt: string }> {
  const [system, user] = lorePrompts(zoneIdx, rarity)
  const used = [...avoid].slice(0, 400).join('/')
  const avoidClause = used === '' ? '' : `

existing-card-names (never reuse ANY of these, not even minor variants): ${used}`
  return parseLore(await chat(mm, system, user + avoidClause, 1400))
}

async function mintOne(mm: Parameters<typeof chat>[0], zoneIdx: number, rarity: Rarity, pythonBin: string,
  avoid: ReadonlySet<string>):
  Promise<{ name: string, species: string, story: string, artB64: string, holoB64: string, maskB64: string }> {
  // Every card must be one of a kind: if the model repeats a taken name,
  // regenerate (up to 3 times) BEFORE spending an image-01 call.
  let lore = await genLore(mm, zoneIdx, rarity, avoid)
  for (let attempt = 0; attempt < 3 && avoid.has(lore.name); attempt += 1) {
    lore = await genLore(mm, zoneIdx, rarity, avoid)
  }
  if (avoid.has(lore.name)) throw new Error('could not invent a fresh creature name after 3 tries')
  const art = await generateImage(mm, lore.imagePrompt)
  const dir = join(tmpdir(), `deepsea-mint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  await mkdir(dir, { recursive: true })
  try {
    const artPath = join(dir, 'art.png')
    const holoPath = join(dir, 'holo.png')
    const maskPath = join(dir, 'mask.png')
    await writeFile(artPath, art)
    const run = spawnSync(pythonBin, [join(process.cwd(), 'scripts', 'holo.py'), artPath, holoPath, maskPath])
    if (run.status !== 0) throw new Error(`holo.py exit ${run.status}: ${String(run.stderr)}`)
    const [artB64, holoB64, maskB64] = await Promise.all([
      readFile(artPath).then((b) => b.toString('base64')),
      readFile(holoPath).then((b) => b.toString('base64')),
      readFile(maskPath).then((b) => b.toString('base64')),
    ])
    return { name: lore.name, species: lore.species, story: lore.story, artB64, holoB64, maskB64 }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}


async function fetchUsedNames(worker: string, token: string): Promise<Set<string>> {
  const res = await fetch(`${worker}/admin/names`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`fetch used names failed: HTTP ${res.status}`)
  const raw = await res.text()
  let data: { ok: boolean, value?: string[] }
  try {
    data = JSON.parse(raw) as { ok: boolean, value?: string[] }
  } catch {
    throw new Error(`fetch used names non-JSON (HTTP ${res.status}): ${raw.slice(0, 120)}`)
  }
  return new Set(data.value ?? [])
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm = { baseURL: 'https://api.minimaxi.com/v1', apiKey, model: 'MiniMax-M3', imageModel: 'image-01' }
  const token = args.dry ? '' : (await readFile(args.tokenFile, 'utf8')).trim()
  const pythonBin = process.env.DEEPSEA_PYTHON ?? 'python3'
  const zoneNames = ['sunlit', 'twilight', 'midnight', 'abyss'] as const
  // Uniqueness budget: every name ever minted is off-limits for new cards.
  const avoid = new Set<string>()
  if (!args.dry) {
    for (const name of await fetchUsedNames(args.worker, token)) avoid.add(name)
    process.stdout.write(`uniqueness: ${avoid.size} existing names loaded` + String.fromCharCode(10))
  }

  let minted = 0
  let failed = 0
  for (let zoneIdx = 0; zoneIdx < zoneNames.length; zoneIdx += 1) {
    const zone = zoneNames[zoneIdx]
    if (args.zone !== 'all' && args.zone !== zone) continue
    const plan = planForZone(ZONE_WEIGHTS[zoneIdx] ?? { COMMON: 0, RARE: 0, EPIC: 0, LEGENDARY: 0 }, args.nPerCell)
    for (const cell of plan) {
      for (let i = 0; i < cell.count; i += 1) {
        const label = `${zone}/${cell.rarity} #${i + 1}/${cell.count}`
        try {
          const card = await mintOne(mm, zoneIdx, cell.rarity, pythonBin, avoid)
          if (args.dry) {
            process.stdout.write(`[dry] ${label}: ${card.name} (${card.species}) ok` + String.fromCharCode(10))
          } else {
            const res = await fetch(`${args.worker}/admin/mint`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
              body: JSON.stringify({ zone, rarity: cell.rarity, ...card }),
            })
            const data = JSON.parse(await res.text()) as
              { ok: boolean, value?: { mintId: string }, error?: { error?: string } }
            if (!data.ok) throw new Error(`mint rejected: ${JSON.stringify(data.error)}`)
            process.stdout.write(`${label}: ${card.name} -> ${data.value?.mintId}` + String.fromCharCode(10))
          }
          avoid.add(card.name)
          minted += 1
          if (args.limit > 0 && minted >= args.limit) {
            process.stdout.write('limit reached: ' + minted + String.fromCharCode(10))
            process.stdout.write('done: ' + minted + ' minted, ' + failed + ' failed' + String.fromCharCode(10))
            return
          }
        } catch (err) {
          failed += 1
          console.error(`${label}: FAILED ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }
  }
  process.stdout.write(`done: ${minted} minted, ${failed} failed` + String.fromCharCode(10))
  if (failed > 0) process.exitCode = 1
}

void main()
