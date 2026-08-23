/**
 * regen-turtle-sprites.ts — redraw the 16 turtle cards' sprites with a
 * species-anchored prompt. The generic gen-card-sprites.ts prompt drifted
 * turtles into fish / eels for ~10% of cards (e.g. df872b4a's 琥珀斑玳瑁
 * came out as a long blue fish instead of a sea turtle). Root cause: the
 * generic prompt only said "深海生物"; the model defaulted to the most
 * common pond sprite (fish). This script hardcodes the 16 affected IDs
 * and uses a turtle-specific prompt that names the species, anchors the
 * shell/flippers/head shape, and relaxes the horizontal ratio threshold
 * from 1.5 to 1.2 (turtles are squarer than fish, so the original prompt
 * asked for an aspect ratio the model can't easily deliver → retry loops).
 *
 * Idempotent: each card's sprite.png + sprite-raw.png are deleted before
 * regeneration, so re-running the script always redoes every targeted
 * card. For partial retries pass the failed IDs as positional args:
 *
 *   pnpm dlx tsx scripts/regen-turtle-sprites.ts                # all 16
 *   pnpm dlx tsx scripts/regen-turtle-sprites.ts 914587be 0b62dd4e # subset
 *
 * Out of scope (intentionally): card.json / art.png / holo.png / mask.png
 * are not touched; sprites are not uploaded to R2 here (the host serves
 * local card sprites directly with no-store, and the turtle rebuild is a
 * local card patch, not a fauna kind rename).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySpriteHeading, generateImageWithRef, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const ROOT = process.env.DEEPSEA_CARDS ?? join(process.env.HOME ?? '.', '.dsh', 'deepsea', 'cards')

// Hardcoded by the v41b bug report: the 16 turtle cards whose sprites
// drifted under the generic prompt. Keep this list stable; if a future
// card needs the same treatment, append the id here.
const TURTLE_IDS = [
  '914587be',
  '0b62dd4e',
  '9ce8512a',
  'cc32f563',
  'bb2e78d2',
  '49bc1dbc',
  'a28f738a',
  'cb4996a1',
  'df872b4a',
  '08b68876',
  'f43cfaf5',
  '49e9c981',
  '5af27004',
  '5dcb88e2',
  '36580717',
  'ed92b38a',
] as const

// Turtle-specific prompt prefix: naming the species + shape anchors the
// subject_reference behavior so image-01 stays close to the source creature
// instead of paraphrasing it into the most likely pond sprite (a fish).
const PROMPT_PREFIX = '参考图中的深海海龟，保持其配色、壳纹与发光特征与参考图一致，生物必须是标准海龟形态：圆润的龟壳、四只鳍状肢、短颈圆头，'
// 风格后缀：横构图阈值从 1.5 放宽到 1.2（海龟比鱼方正），其它构图要
// 求（水平、头朝右、纯黑背景、无文字水印气泡）保持不变。fauna_alpha.py
// 内部以 ≥1.15 通过验收，所以 1.2 的提示下界仍然高于验收线。
const PROMPT_SUFFIX = '严格水平横构图（画面宽度至少是高度的1.2倍），海龟身体完全水平、头朝右、尾朝左，侧视全身，纯黑背景，无文字无水印无气泡'
const PROMPT = PROMPT_PREFIX + PROMPT_SUFFIX

function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

function rmIfExists(path: string): void {
  if (existsSync(path)) spawnSync('rm', ['-f', path])
}

async function main(): Promise<void> {
  // Positional args are an allowlist of ids to (re)generate. With no args
  // the script processes every hardcoded TURTLE_ID. Filtering happens
  // BEFORE rm/regen, so a partial invocation only touches the listed cards.
  const explicit = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const allowed = new Set(explicit)
  const ids = TURTLE_IDS.filter((id) => allowed.size === 0 || allowed.has(id))
  if (ids.length === 0) {
    process.stderr.write('no turtle ids matched: ' + explicit.join(',') + '\n')
    process.exit(2)
  }
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  // Sanity: warn (but don't fail) if a directory has no art.png — the
  // host creates card directories lazily; if a user passed a typo'd id
  // we want a visible diagnostic rather than silent skip.
  for (const id of ids) {
    if (!existsSync(join(ROOT, id))) {
      process.stderr.write(id + ': directory missing under ' + ROOT + '\n')
    }
  }
  let done = 0
  let skipped = 0
  const failed: { id: string, err: string }[] = []
  for (const id of ids) {
    const dir = join(ROOT, id)
    const art = join(dir, 'art.png')
    const raw = join(dir, 'sprite-raw.png')
    const sprite = join(dir, 'sprite.png')
    if (!existsSync(art)) { skipped += 1; process.stdout.write(id + ': missing art.png, skipped\n'); continue }
    // Idempotency: delete the stale sprite outputs first so a re-run
    // always regenerates. fauna_alpha runs on sprite-raw.png → sprite.png,
    // so both must be cleared to drop the old cached result.
    rmIfExists(raw)
    rmIfExists(sprite)
    try {
      const ref = (await readFile(art)).toString('base64')
      let lastDims = { w: 0, h: 0 }
      let lastHead: 'LEFT' | 'RIGHT' | 'OTHER' | 'UNKNOWN' = 'UNKNOWN'
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const bytes = await generateImageWithRef(mm, PROMPT, ref)
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
      // classified LEFT (mirroring the gen-card-sprites.ts flow).
      lastHead = await classifySpriteHeading(mm, (await readFile(sprite)).toString('base64'))
      if (lastHead === 'LEFT') {
        const mr = spawnSync('python3', ['scripts/mirror_png.py', sprite], { encoding: 'utf8' })
        if (mr.status !== 0) throw new Error('mirror failed: ' + String(mr.stderr))
      }
      done += 1
      process.stdout.write(id + ' -> ok ' + lastDims.w + 'x' + lastDims.h + ' head=' + lastHead + '\n')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push({ id, err: msg })
      process.stdout.write(id + ' FAILED ' + msg + '\n')
    }
  }
  process.stdout.write('done: ' + done + ' sprites, ' + skipped + ' skipped, ' + failed.length + ' failed\n')
  if (failed.length > 0) {
    process.stdout.write('failed ids: ' + failed.map((f) => f.id).join(',') + '\n')
    for (const f of failed) process.stdout.write('  ' + f.id + ': ' + f.err + '\n')
    process.exitCode = 1
  }
}

void main()
