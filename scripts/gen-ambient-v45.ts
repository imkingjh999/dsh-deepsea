/**
 * gen-ambient-v45.ts — v45 ambient fauna. The v44 procedural zoo
 * (hand-coded shrimp / crab silhouette + old "fish" sprite with
 * hue-rotate) was too rough (user: 虾蟹鳝鱼, 还有土壤, 都比较粗糙).
 * This script mints four MiniMax sprites, side-view, head-RIGHT
 *   - minnow     : 细长银蓝小鲦鱼
 *   - shrimp     : 粉白半透明小虾
 *   - crab       : 橙红小螃蟹, 侧视行走
 *   - swamp_eel  : 黄绿色鳝鱼（田鳝）
 * and uploads each to deepsea-cards/fauna/<kind>.png (served by
 * https://deepsea.openclawd.qzz.io/assets/fauna/<kind>.png?v=4).
 *
 * The prompt explicitly says "头朝右" but image-01 drifts ~14% of
 * the time, so after generation we run classifySpriteHeading on each
 * PNG and PIL-mirror the LEFT-facing ones. The mirror is in-place
 * (mirror_png.py) then the R2 put overwrites the LEFT version. The
 * per-kind heading verdict is printed for the report (GLM does the
 * manual eye check on the remaining ~14% it might still miss).
 *
 * Composition assertion (per kind, sideways in fauns world):
 *   minnow  / shrimp / crab / swamp_eel : w >= h * 1.2
 * (crab/shrimp/eel can be near-square when their legs/feelers stick
 * out, so we keep the threshold gentle at 1.2x — strict 1.5x would
 * reject too many valid frames.)
 *
 * Usage: pnpm dlx tsx scripts/gen-ambient-v45.ts [--only minnow,shrimp,crab,swamp_eel]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** PNG IHDR dims. */
function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
import { classifySpriteHeading, generateImage, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const OUT_DIR = '/tmp/deepsea-ambient-v45'
const BUCKET = 'deepsea-cards'

const COMMON_BG = '深海生物游戏精灵图，严格水平横构图（画面宽度至少是高度的1.2倍），生物身体完全水平、头朝右（画布右侧）、尾朝左，侧视全身，生物荧光点缀，纯黑背景，无文字无水印无气泡'

const PROMPTS: Record<string, string> = {
  minnow: '一条细长的深海小鲦鱼（鱼群饵鱼），银蓝色鳞片反光，体型瘦长流线，眼睛清晰，流线型的小背鳍与叉形尾鳍，群游姿态。' + COMMON_BG,
  shrimp: '一只粉白色的深海小虾，半透明甲壳，长长的触须向头部前方（画面右侧）伸出，弯曲的腹部与扇形尾鳍，腿足收拢贴身，侧视全身。' + COMMON_BG,
  crab: '一只橙红色小螃蟹，严格侧视图（从身体左侧平视，像横版游戏的侧面剪影），身体侧对镜头，只看到近侧的两条腿和一只大钳，钳子朝画面右侧，圆背壳，小眼柄。' + COMMON_BG,
  swamp_eel: '一条黄绿色的田鳝（沼泽鳝鱼），细长蛇形身体（侧视全长），头朝右，背鳍沿身体延伸，颜色由头部黄绿渐变到尾部深褐，皮肤有光泽。' + COMMON_BG,
}

/** Side-view aspect: w/h ≥ 1.2 (loose for the leg/feeler frames). */
const WIDE = (w: number, h: number): boolean => w >= h * 1.2

function mirror(path: string): void {
  const r = spawnSync('python3', ['scripts/mirror_png.py', path], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('mirror failed: ' + String(r.stderr))
}

function r2put(kind: string, out: string): void {
  const put = spawnSync('./node_modules/.bin/wrangler',
    ['r2', 'object', 'put', BUCKET + '/fauna/' + kind + '.png', '--file', out,
      '--remote', '--content-type', 'image/png'],
    { cwd: 'cloudflare', encoding: 'utf8' })
  if (put.status !== 0) throw new Error('r2 put failed: ' + String(put.stderr))
}

interface Report { kind: string, dims: string, heading: string, mirrored: boolean, uploaded: boolean, error?: string }
const reports: Report[] = []

async function genAndUpload(kind: string, prompt: string, mm: MiniMaxConfig): Promise<void> {
  const raw = resolve(OUT_DIR, kind + '-raw.png')
  const out = resolve(OUT_DIR, kind + '.png')
  let accepted = false
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const bytes = await generateImage(mm, prompt)
    await writeFile(raw, bytes)
    const py = spawnSync('python3', ['scripts/fauna_alpha.py', raw, out], { encoding: 'utf8' })
    if (py.status !== 0) throw new Error('alpha failed: ' + String(py.stderr))
    const dims = pngDims(out)
    if (WIDE(dims.w, dims.h)) {
      accepted = true
      process.stdout.write(kind + ' attempt ' + attempt + ' ok (' + dims.w + 'x' + dims.h + ')\n')
      break
    }
    process.stdout.write(kind + ' attempt ' + attempt + ' too tall (' + dims.w + 'x' + dims.h + '), retrying\n')
  }
  if (!accepted) throw new Error('aspect assertion failed after 3 attempts')
  // Heading classification (single classify call — same noise rate as
  // fix-sprite-heading.ts, the report flags them for GLM eye check).
  const b64 = (await readFile(out)).toString('base64')
  const heading = await classifySpriteHeading(mm, b64)
  let mirrored = false
  if (heading === 'LEFT') {
    mirror(out)
    mirrored = true
    process.stdout.write(kind + ': LEFT -> mirrored\n')
  } else {
    process.stdout.write(kind + ': ' + heading + ' (keep)\n')
  }
  r2put(kind, out)
  const dims = pngDims(out)
  reports.push({ kind, dims: dims.w + 'x' + dims.h, heading, mirrored, uploaded: true })
}

async function main(): Promise<void> {
  const onlyFlag = process.argv.indexOf('--only')
  const only = onlyFlag >= 0 ? (process.argv[onlyFlag + 1] ?? '').split(',').filter(Boolean) : []
  const kinds = only.length > 0 ? only : Object.keys(PROMPTS)
  await mkdir(OUT_DIR, { recursive: true })
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  for (const kind of kinds) {
    const prompt = PROMPTS[kind]
    if (prompt === undefined) { process.stdout.write('unknown kind: ' + kind + '\n'); continue }
    try {
      await genAndUpload(kind, prompt, mm)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      reports.push({ kind, dims: '?', heading: '?', mirrored: false, uploaded: false, error: msg })
      process.stdout.write(kind + ' FAILED ' + msg + '\n')
    }
  }
  // Final structured report: easy to grep / paste into the v45 task report.
  process.stdout.write('\n--- gen-ambient-v45 report ---\n')
  for (const r of reports) {
    process.stdout.write(JSON.stringify(r) + '\n')
  }
  const failed = reports.filter((r) => r.error !== undefined || !r.uploaded)
  process.stdout.write('done: ' + (reports.length - failed.length) + ' minted, ' + failed.length + ' failed\n')
  if (failed.length > 0) process.exitCode = 1
}

void main()
