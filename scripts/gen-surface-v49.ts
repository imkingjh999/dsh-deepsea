/**
 * gen-surface-v49.ts — MiniMax-paint the pond's SURFACE props (user:
 * 让minimax生成一下岛屿和船只,丰富水面): a rim-lit island silhouette
 * and a small glowing boat, both drawn with a FLAT HORIZONTAL BASELINE so
 * they sit on the water line (pond-bg.ts draws them bobbing on the wave
 * crest with 'lighter' blending, so the black background vanishes).
 * Uploaded to R2 deepsea-cards/surface/{island,boat}.png and served from
 * the worker like the decor sprites.
 *
 * Usage: pnpm dlx tsx scripts/gen-surface-v49.ts [--only island,boat]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { generateImage, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const OUT_DIR = '/tmp/deepsea-surface-v49'
const BUCKET = 'deepsea-cards'

const COMMON = '横版剪影装饰图，画面最底部是一条水平基线（物体坐在这条线上，基线以下留黑），'
  + '轮廓边缘有冷蓝绿色荧光描边（rim light），中心偏暗，纯黑背景，无文字无水印无倒影'

const PROMPTS: Record<string, string> = {
  island: '一座远处的深海小岛剪影：低缓的火山岛轮廓带一点尖峰，基线以上是岛屿侧面剪影，'
    + '边缘荧光描边，宽扁构图（宽度至少是高度的2.5倍）。' + COMMON,
  boat: '一只小小的深海渔船剪影：平底的船体、短桅杆、一点风帆和一盏暖色小灯，'
    + '侧视，坐在水平基线上，边缘荧光描边，宽扁构图（宽度至少是高度的1.5倍）。' + COMMON,
}

function r2put(kind: string, out: string): void {
  const put = spawnSync('./node_modules/.bin/wrangler',
    ['r2', 'object', 'put', BUCKET + '/surface/' + kind + '.png', '--file', out,
      '--remote', '--content-type', 'image/png'],
    { cwd: 'cloudflare', encoding: 'utf8' })
  if (put.status !== 0) throw new Error('r2 put failed: ' + String(put.stderr))
}

async function main(): Promise<void> {
  const onlyFlag = process.argv.indexOf('--only')
  const only = onlyFlag >= 0 ? (onlyFlag >= 0 ? (process.argv[onlyFlag + 1] ?? '').split(',').filter(Boolean) : []) : []
  const kinds = only.length > 0 ? only : Object.keys(PROMPTS)
  await mkdir(OUT_DIR, { recursive: true })
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  let failed = 0
  for (const kind of kinds) {
    const prompt = PROMPTS[kind]
    if (prompt === undefined) { process.stdout.write('unknown kind: ' + kind + '\n'); failed += 1; continue }
    try {
      const bytes = await generateImage(mm, prompt, { w: 1024, h: 512 })
      const out = OUT_DIR + '/' + kind + '.png'
      await writeFile(out, bytes)
      const b = readFileSync(out)
      const dims = b.readUInt32BE(16) + 'x' + b.readUInt32BE(20)
      r2put(kind, out)
      process.stdout.write(kind + ': ok ' + dims + ' uploaded\n')
    } catch (err) {
      failed += 1
      process.stdout.write(kind + ': FAILED ' + (err instanceof Error ? err.message : String(err)) + '\n')
    }
  }
  if (failed > 0) process.exitCode = 1
}

void main()
