/**
 * gen-fauna.ts — have MiniMax redraw the ocean fauna as real sprites.
 *
 * For each of the 9 creature kinds the engine draws procedurally today:
 *   1. image-01 paints it as a side-view game sprite on a pure black bg
 *   2. scripts/fauna_alpha.py cuts the black to transparency + crops
 *   3. the result is uploaded to R2 as fauna/<kind>.png (served by
 *      GET /assets/fauna/<kind>.png)
 *
 * The client falls back to the procedural drawing while/unless a sprite
 * loads, so this is strictly additive.
 *
 * Usage: pnpm dlx tsx scripts/gen-fauna.ts [--only fish,turtle]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** PNG IHDR dims — generated sprites must be WIDE (head points right), a
 * tall composition means the model drew a vertical subject again. */
function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
import { generateImage, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const OUT_DIR = '/tmp/deepsea-fauna'
const BUCKET = 'deepsea-cards'

const STYLE = '深海生物游戏精灵图，严格水平横构图（画面宽度至少是高度的1.5倍），生物身体完全水平、头朝右、尾朝左，侧视全身，生物荧光点缀，纯黑背景，无文字无水印无气泡'

const PROMPTS: Record<string, string> = {
  fish: '一条优雅的深海鱼，流线型身体，飘逸的长鳍与尾鳍，蓝绿色荧光条纹沿身体流动。' + STYLE,
  turtle: '一只远古深海海龟，厚重发光纹路的龟壳，四肢舒展划水，蓝金色调。' + STYLE,
  hatchet: '一条银斧鱼，高侧扁的银色身体形如斧头，体侧一排细密发光器，银蓝荧光。' + STYLE,
  jelly: '一只半透明深海水母，伞状身体拖曳飘逸发光触须，紫色与青色荧光，梦幻。' + STYLE,
  viper: '一条蝰鱼，长獠牙大口，细长身体，体侧一串发光器，凶悍的深海捕食者，蓝紫荧光。' + STYLE,
  squid: '一只深海鱿鱼，锥形外套膜与十只收拢的触腕，皮肤发光斑点，红铜与蓝色荧光。' + STYLE,
  angler: '一条鮟鱇鱼，大头大口利齿，头顶弯杆挂一盏明亮的发光灯笼诱饵，暗褐身体配金色光晕。' + STYLE,
  octopus: '一只深海章鱼，圆头与八条弯曲腕足，吸盘细节清晰，皮肤发光斑点，暗红与青色。' + STYLE,
  eel: '一条深海鳗鱼，细长蛇形身体呈波状，连续背鳍，幽蓝荧光沿身体流动。' + STYLE,
}

async function main(): Promise<void> {
  const onlyFlag = process.argv.indexOf('--only')
  const only = onlyFlag >= 0 ? (process.argv[onlyFlag + 1] ?? '').split(',').filter(Boolean) : []
  const kinds = only.length > 0 ? only : Object.keys(PROMPTS)
  await mkdir(OUT_DIR, { recursive: true })
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  let done = 0
  const failed: string[] = []
  for (const kind of kinds) {
    const prompt = PROMPTS[kind]
    if (prompt === undefined) { process.stdout.write('unknown kind: ' + kind + '\n'); continue }
    const raw = resolve(OUT_DIR, kind + '-raw.png')
    const out = resolve(OUT_DIR, kind + '.png')
    try {
      let bestW = 0
      let bestH = 0
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const bytes = await generateImage(mm, prompt)
        await writeFile(raw, bytes)
        const py = spawnSync('python3', ['scripts/fauna_alpha.py', raw, out], { encoding: 'utf8' })
        if (py.status !== 0) throw new Error('alpha failed: ' + String(py.stderr))
        const dims = pngDims(out)
        if (dims.w >= dims.h * 1.15) break
        if (dims.w * dims.h >= bestW * bestH) { bestW = dims.w; bestH = dims.h }
        process.stdout.write(kind + ' attempt ' + attempt + ' too tall (' + dims.w + 'x' + dims.h + '), retrying')
      }
      // npx resolves the broken global wrangler here; use the project-local one.
      const put = spawnSync('./node_modules/.bin/wrangler',
        ['r2', 'object', 'put', BUCKET + '/fauna/' + kind + '.png', '--file', out,
          '--remote', '--content-type', 'image/png'],
        { cwd: 'cloudflare', encoding: 'utf8' })
      if (put.status !== 0) throw new Error('r2 put failed: ' + String(put.stderr))
      done += 1
      process.stdout.write(kind + ' -> ok\n')
    } catch (err) {
      failed.push(kind)
      process.stdout.write(kind + ' FAILED ' + (err instanceof Error ? err.message : String(err)) + '\n')
    }
  }
  process.stdout.write('done: ' + done + ' minted, ' + failed.length + ' failed\n')
  if (failed.length > 0) process.exitCode = 1
}

void main()
