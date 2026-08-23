/**
 * regen-all-card-sprites.ts — full-card regen with per-species anchoring.
 * The v41b turtle regen proved that hardcoding a species-shape anchor into
 * the prompt stops image-01 from drifting into the most common pond sprite
 * (a fish). This script extends that trick to every card: each card's
 * `cardKindOf(name, zoneIndex, species)` decides which shape anchor is
 * spliced into the prompt, so a viper stays a viper, a jelly stays a
 * jelly, and so on. Threshold per kind matches the bug-fix template:
 * turtles relax 1.5 → 1.2 (their boxy shell can't hit 1.5 reliably),
 * everything else stays at 1.5; fauna_alpha.py's 1.15 acceptance gate
 * remains unchanged so a too-tall result still retries up to 3 times.
 *
 * Idempotent: rm -f sprite.png + sprite-raw.png before regenerating, so
 * re-running always redoes every targeted card. Positional args are an
 * id allowlist (same semantics as regen-turtle-sprites) — handy for a
 * targeted retry after a partial failure:
 *
 *   pnpm dlx tsx scripts/regen-all-card-sprites.ts                # all 220+
 *   pnpm dlx tsx scripts/regen-all-card-sprites.ts 914587be 7a9763a6 # subset
 *
 * Per-card progress appends to /tmp/regen-all-progress.log so a parent
 * orchestrator can tail this run without re-grepping the giant stdout.
 *
 * Out of scope (intentionally): card.json / art.png / holo.png / mask.png
 * are not touched; sprites are not uploaded to R2 here (the host serves
 * local card sprites directly with no-store, and the rebuild is a local
 * card patch, not a fauna kind rename).
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, openSync, closeSync } from 'node:fs'
import { readFileSync, existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySpriteHeading, generateImageWithRef, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'
import { cardKindOf, type Creature } from '../src/client/fauna.ts'
import { ZONES } from '../src/client/depth.ts'

const ROOT = process.env.DEEPSEA_CARDS ?? join(process.env.HOME ?? '.', '.dsh', 'deepsea', 'cards')
const PROGRESS_LOG = '/tmp/regen-all-progress.log'

/** Shape anchors per `Creature['kind']` — the species-anchoring vocabulary
 * that the v41b turtle prompt proved effective. image-01 with a subject
 * reference tends to "complete" the creature into the most-likely pond
 * sprite (a fish); spelling the silhouette up front locks it back to the
 * card's own species. Add new kinds here, not in the prompt. */
const KIND_ANCHOR: Record<Creature['kind'], string> = {
  turtle: '标准海龟形态：圆润的龟壳、四只鳍状肢、短颈圆头',
  angler: '标准鮟鱇鱼形态：巨大头部、宽嘴利齿、头顶弯杆挂着发光灯笼诱饵、圆润身体',
  viper: '标准蝰鱼形态：细长身体、巨大獠牙长口、体侧一排发光器、背鳍棘刺',
  eel: '标准鳗鱼形态：极细长的蛇形身体、连续背鳍、尖长头部',
  squid: '标准鱿鱼形态：锥形外套膜、十只触腕收拢在前、眼大',
  octopus: '标准章鱼形态：圆头、八条弯曲腕足铺开、吸盘清晰',
  jelly: '标准水母形态：半透明伞状钟体、飘逸的长触须',
  hatchet: '标准斧鱼形态：高侧扁的银色身体形如斧头、体侧发光器、小尾',
  fish: '标准鱼类形态：流线型身体、背鳍胸鳍尾鳍齐全、体侧可能有发光条纹',
}

/** Per-kind horizontal-ratio floor for the prompt. Turtle relaxes to 1.2
 * because their shell is squarer than the long-bodied kinds — 1.5 made
 * the model retry-loop forever (v41b). Other kinds stay at the gen-card
 * default. The acceptance gate in fauna_alpha (≥1.15) is the actual
 * fail/retry line; this number is just the prompt hint. */
const RATIO_HINT: Record<Creature['kind'], number> = {
  turtle: 1.2,
  angler: 1.5,
  viper: 1.5,
  eel: 1.5,
  squid: 1.5,
  octopus: 1.5,
  jelly: 1.5,
  hatchet: 1.5,
  fish: 1.5,
}

interface CardRecord {
  id?: string
  name?: string
  species?: string
  zone?: string
}

function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function rmIfExists(path: string): void {
  if (existsSync(path)) spawnSync('rm', ['-f', path])
}

function zoneIndexOf(zoneId: string): number {
  const zi = ZONES.findIndex((z) => z.id === zoneId)
  return zi >= 0 ? zi : 0
}

function buildPrompt(name: string, species: string, kind: Creature['kind']): string {
  const anchor = KIND_ANCHOR[kind]
  const ratio = RATIO_HINT[kind]
  const prefix = `参考图中的深海生物「${name}」（${species}），保持其配色、花纹与发光特征与参考图完全一致。生物必须是${anchor}，`
  const suffix = `严格水平横构图（画面宽度至少是高度的${ratio}倍），生物身体完全水平、头朝右、尾朝左，侧视全身，纯黑背景，无文字无水印无气泡`
  return prefix + suffix
}

async function main(): Promise<void> {
  // Positional args = id allowlist (same semantics as regen-turtle-sprites).
  // With no args the script processes every dir under ROOT that has art.png.
  // Filtering happens BEFORE rm/regen, so a partial invocation only touches
  // the listed cards (typing 'pnpm dlx tsx scripts/regen-all-card-sprites.ts
  // <id1> <id2>' redoes exactly those two).
  const explicit = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const allowed = new Set(explicit)
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  const allDirs = (await readdir(ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => allowed.size === 0 || allowed.has(id))
    .sort()
  // Filter to dirs that actually have art.png — otherwise we'd try to read
  // a missing reference and waste an API call. 7a9763a6 is the known
  // artless dir (host created the card but art generation failed upstream);
  // skip it silently so a future card with no art doesn't blow up the run.
  const dirs: string[] = []
  for (const id of allDirs) {
    if (existsSync(join(ROOT, id, 'art.png'))) dirs.push(id)
  }
  if (dirs.length === 0) {
    process.stderr.write('no card dirs matched: ' + explicit.join(',') + '\n')
    process.exit(2)
  }
  // Reset the progress log so this run starts clean — re-running the
  // script shouldn't pollute the prior run's tail.
  closeSync(openSync(PROGRESS_LOG, 'w'))
  process.stdout.write('regen-all: ' + dirs.length + ' cards'
    + (allowed.size > 0 ? ' (allowlist=' + explicit.join(',') + ')' : '') + '\n')
  const startMs = Date.now()
  let done = 0
  let skipped = 0
  const failed: { id: string, err: string }[] = []
  for (const id of dirs) {
    const dir = join(ROOT, id)
    const art = join(dir, 'art.png')
    const raw = join(dir, 'sprite-raw.png')
    const sprite = join(dir, 'sprite.png')
    let name = ''
    let species = ''
    let zoneStr = ''
    let kind: Creature['kind'] = 'fish'
    try {
      const card = JSON.parse(await readFile(join(dir, 'card.json'), 'utf8')) as CardRecord
      name = typeof card.name === 'string' ? card.name : ''
      species = typeof card.species === 'string' ? card.species : ''
      zoneStr = typeof card.zone === 'string' ? card.zone : ''
      kind = cardKindOf(name, zoneIndexOf(zoneStr), species)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id, err: 'card.json read: ' + msg })
      process.stdout.write(id + ' FAILED card.json read: ' + msg + '\n')
      appendFileSync(PROGRESS_LOG, id + '\tfail\t' + msg + '\n')
      continue
    }
    // Idempotency: delete the stale sprite outputs first so a re-run
    // always regenerates. fauna_alpha runs on sprite-raw.png → sprite.png,
    // so both must be cleared to drop the old cached result.
    rmIfExists(raw)
    rmIfExists(sprite)
    try {
      const ref = (await readFile(art)).toString('base64')
      const prompt = buildPrompt(name, species, kind)
      let lastDims = { w: 0, h: 0 }
      let lastHead: 'LEFT' | 'RIGHT' | 'OTHER' | 'UNKNOWN' = 'UNKNOWN'
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const bytes = await generateImageWithRef(mm, prompt, ref)
        await writeFile(raw, bytes)
        const py = spawnSync('python3', ['scripts/fauna_alpha.py', raw, sprite], { encoding: 'utf8' })
        if (py.status !== 0) throw new Error('alpha failed: ' + String(py.stderr))
        lastDims = pngDims(sprite)
        if (lastDims.w >= lastDims.h * 1.15) break
        process.stdout.write(id + ' attempt ' + attempt + ' too tall ('
          + lastDims.w + 'x' + lastDims.h + '), retrying\n')
      }
      // Head-direction normalization: the prompt asks for head-right but
      // image-01 drifts; a head-left sprite swims backwards once the
      // renderer flips it for leftward motion. Mirror in place when
      // classified LEFT (mirroring the regen-turtle-sprites.ts flow).
      lastHead = await classifySpriteHeading(mm, (await readFile(sprite)).toString('base64'))
      if (lastHead === 'LEFT') {
        const mr = spawnSync('python3', ['scripts/mirror_png.py', sprite], { encoding: 'utf8' })
        if (mr.status !== 0) throw new Error('mirror failed: ' + String(mr.stderr))
      }
      done += 1
      process.stdout.write(id + ' ' + name + ' kind=' + kind + ' -> ok '
        + lastDims.w + 'x' + lastDims.h + ' head=' + lastHead + '\n')
      appendFileSync(PROGRESS_LOG, id + '\tok\t' + kind + '\t' + lastDims.w + 'x' + lastDims.h + '\t' + lastHead + '\n')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id, err: msg })
      process.stdout.write(id + ' ' + name + ' kind=' + kind + ' FAILED ' + msg + '\n')
      appendFileSync(PROGRESS_LOG, id + '\tfail\t' + kind + '\t' + msg + '\n')
    }
    // Light progress heartbeat so a parent tailing stdout knows we're alive
    if ((done + failed.length + skipped) % 10 === 0) {
      process.stdout.write('-- progress: ' + (done + failed.length) + '/' + dirs.length
        + ' (' + done + ' ok, ' + failed.length + ' fail)\n')
    }
  }
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1)
  process.stdout.write('done: ' + done + ' sprites, ' + skipped + ' skipped, '
    + failed.length + ' failed, ' + elapsed + 's\n')
  if (failed.length > 0) {
    process.stdout.write('failed ids: ' + failed.map((f) => f.id).join(',') + '\n')
    for (const f of failed) process.stdout.write('  ' + f.id + ': ' + f.err + '\n')
    process.exitCode = 1
  }
}

void main()
