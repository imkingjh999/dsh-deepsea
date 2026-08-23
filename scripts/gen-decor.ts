/**
 * gen-decor.ts — have MiniMax redraw the seabed plants as real sprites.
 *
 * For each vertical plant the engine draws procedurally today (seaweed,
 * kelp):
 *   1. image-01 paints it as a TALL game sprite on a pure black bg
 *      (the inverse of gen-fauna: this time the height must be at
 *      least 1.5× the width, root at the bottom, leaves up)
 *   2. scripts/fauna_alpha.py cuts the black to transparency + crops
 *   3. the result is uploaded to R2 as decor/<kind>.png (served by
 *      GET /assets/decor/<kind>.png)
 *
 * The client falls back to the procedural drawing while/unless a sprite
 * loads, so this is strictly additive.
 *
 * Usage: pnpm dlx tsx scripts/gen-decor.ts [--only seaweed,kelp]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** PNG IHDR dims — generated plant sprites must be TALL (root down). */
function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
import { generateImage, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const OUT_DIR = '/tmp/deepsea-decor'
const BUCKET = 'deepsea-cards'

const STYLE = '深海植物游戏装饰素材，严格垂直竖构图（画面高度至少是宽度的1.5倍），根部在画面下端、叶尖朝上，生物荧光点缀，纯黑背景，无文字无水印'

const PROMPTS: Record<string, string> = {
  seaweed: '一片墨绿色的深海短海藻，半透明叶片丛生，柔顺地随水流摇曳，叶缘带一点生物荧光。' + STYLE,
  kelp: '一棵高大的巨型海带，主茎粗壮向上延伸，沿主茎两侧生长出宽大的带状叶片，叶片微微卷曲，整株在水流中轻轻摆动，幽绿荧光。' + STYLE,
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
        if (dims.h >= dims.w * 1.15) break
        if (dims.w * dims.h >= bestW * bestH) { bestW = dims.w; bestH = dims.h }
        process.stdout.write(kind + ' attempt ' + attempt + ' too wide (' + dims.w + 'x' + dims.h + '), retrying')
      }
      // npx resolves the broken global wrangler here; use the project-local one.
      const put = spawnSync('./node_modules/.bin/wrangler',
        ['r2', 'object', 'put', BUCKET + '/decor/' + kind + '.png', '--file', out,
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
