/**
 * gen-card-sprites.ts — redraw every local card's creature as a pond
 * sprite using the card art itself as the MiniMax image-02 subject
 * reference, so the pond fish looks exactly like the card. Output is a
 * horizontal head-right transparent sprite saved next to the art as
 * sprite.png (served by the host via /deepsea/assets/<id>/sprite.png).
 *
 * Usage: pnpm dlx tsx scripts/gen-card-sprites.ts [--only <id>]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySpriteHeading, generateImageWithRef, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const ROOT = process.env.DEEPSEA_CARDS ?? join(process.env.HOME ?? '.', '.dsh', 'deepsea', 'cards')

const PROMPT = '参考图中的深海生物，保持其物种、形态、配色与发光特征与参考图完全一致，把它画成一只游戏精灵：'
  + '严格水平横构图（画面宽度至少是高度的1.5倍），生物身体完全水平、头朝右、尾朝左，侧视全身，纯黑背景，无文字无水印无气泡'

function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

async function main(): Promise<void> {
  const onlyFlag = process.argv.indexOf('--only')
  const only = onlyFlag >= 0 ? (process.argv[onlyFlag + 1] ?? '') : ''
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  const dirs = (await readdir(ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((id) => (only === '' ? true : id === only))
  let done = 0
  let skipped = 0
  const failed: string[] = []
  for (const id of dirs) {
    const art = join(ROOT, id, 'art.png')
    const sprite = join(ROOT, id, 'sprite.png')
    if (!existsSync(art)) { skipped += 1; continue }
    if (existsSync(sprite)) { skipped += 1; continue }
    try {
      const ref = (await readFile(art)).toString('base64')
      let lastDims = { w: 0, h: 0 }
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const bytes = await generateImageWithRef(mm, PROMPT, ref)
        const raw = join(ROOT, id, 'sprite-raw.png')
        await writeFile(raw, bytes)
        const py = spawnSync('python3', ['scripts/fauna_alpha.py', raw, sprite], { encoding: 'utf8' })
        if (py.status !== 0) throw new Error('alpha failed: ' + String(py.stderr))
        lastDims = pngDims(sprite)
        if (lastDims.w >= lastDims.h * 1.15) break
        process.stdout.write(id + ' attempt ' + attempt + ' too tall ('
          + lastDims.w + 'x' + lastDims.h + '), retrying' + String.fromCharCode(10))
      }
      // Head-direction normalization: prompts ask for head-right but the
      // model drifts; a head-left sprite swims backwards once the renderer
      // mirrors it for leftward motion. Mirror in place when classified LEFT.
      const head = await classifySpriteHeading(mm, (await readFile(sprite)).toString('base64'))
      if (head === 'LEFT') {
        const mr = spawnSync('python3', ['scripts/mirror_png.py', sprite], { encoding: 'utf8' })
        if (mr.status !== 0) throw new Error('mirror failed: ' + String(mr.stderr))
      }
      done += 1
      process.stdout.write(id + ' -> ok ' + lastDims.w + 'x' + lastDims.h + ' head=' + head + String.fromCharCode(10))
    } catch (err) {
      failed.push(id)
      process.stdout.write(id + ' FAILED '
        + (err instanceof Error ? err.message : String(err)) + String.fromCharCode(10))
    }
  }
  process.stdout.write('done: ' + done + ' sprites, ' + skipped + ' skipped, '
    + failed.length + ' failed' + String.fromCharCode(10))
  if (failed.length > 0) process.exitCode = 1
}

void main()
