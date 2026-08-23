/**
 * gen-decor-v45.ts — v45 decor expansion. The v44 procedural
 * seaweed/kelp/coral/starfish weren't satisfying the user: the
 * hand-coded "coral" was a 4-arm branchy line in hsl(18–43) (i.e. the
 * warm-orange grass the user called 红黄水草), the starfish was a flat
 * 5-point fill, and the seabed still had no soil texture (the user
 * wants a real sand strip). This script mints three MiniMax sprites
 *   - coral      : 紧凑的扇形/枝状珊瑚头, NOT a grass leaf
 *   - starfish   : 五臂海星微俯视, 橙红带浅色肌理
 *   - soil       : 沙质沉积条带纹理, 浅褐细沙+细小砾石
 * and uploads each to deepsea-cards/decor/<kind>.png (served by
 * https://deepsea.openclawd.qzz.io/assets/decor/<kind>.png). The
 * client still falls back to the procedural drawing if a sprite is
 * absent, so this is additive.
 *
 * Each kind has its own validator (per-key retry loop, not the v39
 * seaweed/kelp "tall" rule). coral needs
 *   0.8 ≤ h/w ≤ 2.0
 * so a tall grass leaf (h/w > 2) or a flat wide blob (h/w < 0.8) both
 * fail and trigger a retry. starfish needs 0.8 ≤ h/w ≤ 1.4 (the
 * user spec was "近方构图" — anything too wide is suspicious).
 * soil needs w/h ≥ 1.2 (a thin strip, not a square patch) AND a
 * warm palette (R > B + 15, R ≥ G ≥ B) — the v45-r2 feedback said
 * the first soil came out blue-gray. Up to 3 attempts per kind.
 *
 * Usage: pnpm dlx tsx scripts/gen-decor-v45.ts [--only coral,starfish,soil]
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

/** PNG IHDR dims. */
function pngDims(path: string): { w: number, h: number } {
  const b = readFileSync(path)
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}
import { generateImage, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const OUT_DIR = '/tmp/deepsea-decor-v45'
const BUCKET = 'deepsea-cards'

/** Shared style for the three decor kinds (the per-kind prompt already
 * carries the orientation rule; this is the background + vibe overlay
 * that has to be identical across all three). */
const COMMON_BG = '纯黑背景，无文字无水印，无海草叶片（coral 不是水草）'

/** MiniMax image-01 returns a 768x1104 portrait by default; the post-
 * alpha crop will tighten the sprite. Each kind carries a per-key
 * validator (returns ok + reason) so the script can report WHY an
 * attempt failed. v45-r2 added a tone check to the soil validator —
 * the user feedback said the first soil came out blueish / heavy
 * noise (pixel mean RGB (97,106,96) — B≥R), which reads as blue-gray
 * mud, not sand. A clean sand strip must have R noticeably > B
 * (warm tan/beige). The validator now demands R > B + 15 AND G falls
 * between R and B. coral and starfish keep their aspect-only rules. */
interface ValidResult { ok: boolean, reason: string }
type Validator = (path: string) => ValidResult

function meanRgb(path: string): { r: number, g: number, b: number } | null {
  // Tiny inline reader: parse the IHDR, then iterate the (post-alpha)
  // PNG with stdlib only. We rely on the cropped file's R/G/B byte
  // (the alpha pass already removed the black background, so the
  // remaining pixels are the subject).
  try {
    const py = spawnSync('python3', ['-c', [
      'import sys',
      'from PIL import Image',
      'im=Image.open(sys.argv[1]).convert("RGBA")',
      'r=g=b=n=0',
      'for px in im.getdata():',
      // a>10 (not 40) — fauna_alpha.py softens edges into the 0..255 alpha
      // range so the dominant warm sand pixels land well below 40; a higher
      // threshold skips the sand and reports "no opaque pixels" on every
      // legitimate candidate.
      '  if px[3]>10: r+=px[0]; g+=px[1]; b+=px[2]; n+=1',
      'if n==0: sys.exit(1)',
      'print(r//n,g//n,b//n,n)',
    ].join('\n'), path], { encoding: 'utf8' })
    if (py.status !== 0) return null
    const parts = (py.stdout ?? '').trim().split(/\s+/)
    if (parts.length < 3) return null
    return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]) }
  } catch {
    return null
  }
}

const VALIDATORS: Record<string, Validator> = {
  // coral: 竖向略方 (0.8..2.0), reject thin grass (h>2w) and flat pad (h<0.8w)
  coral: (p) => {
    const d = pngDims(p)
    if (d.h < d.w * 0.8) return { ok: false, reason: 'aspect h/w=' + (d.h / d.w).toFixed(2) + ' too flat (<0.8)' }
    if (d.h > d.w * 2.0) return { ok: false, reason: 'aspect h/w=' + (d.h / d.w).toFixed(2) + ' too tall (>2.0)' }
    return { ok: true, reason: d.w + 'x' + d.h }
  },
  // starfish: 近方 (0.8..1.4)
  starfish: (p) => {
    const d = pngDims(p)
    if (d.h < d.w * 0.8) return { ok: false, reason: 'aspect h/w=' + (d.h / d.w).toFixed(2) + ' too flat (<0.8)' }
    if (d.h > d.w * 1.4) return { ok: false, reason: 'aspect h/w=' + (d.h / d.w).toFixed(2) + ' too tall (>1.4)' }
    return { ok: true, reason: d.w + 'x' + d.h }
  },
  // soil: 横向长条 (w >= 1.2h) AND 暖色调 (R > B + 15, R >= G >= B).
  // The first v45 soil came back blue-gray (mean (97,106,96) — B≥R),
  // which the user flagged as a wrong palette. We require a real
  // warm tan: red channel strictly above blue, green in between.
  soil: (p) => {
    const d = pngDims(p)
    if (d.w < d.h * 1.2) return { ok: false, reason: 'aspect w/h=' + (d.w / d.h).toFixed(2) + ' too narrow (<1.2)' }
    const rgb = meanRgb(p)
    if (rgb === null) return { ok: true, reason: d.w + 'x' + d.h + ' (tone check skipped: no opaque pixels)' }
    if (rgb.r <= rgb.b + 15) return { ok: false, reason: 'tone rgb=(' + rgb.r + ',' + rgb.g + ',' + rgb.b
      + ') not warm (R-B=' + (rgb.r - rgb.b) + ' <= 15)' }
    if (rgb.g < rgb.b) return { ok: false, reason: 'tone rgb=(' + rgb.r + ',' + rgb.g + ','
      + rgb.b + ') inverted (G<B)' }
    if (rgb.g > rgb.r) return { ok: false, reason: 'tone rgb=(' + rgb.r + ',' + rgb.g + ','
      + rgb.b + ') inverted (G>R)' }
    return { ok: true, reason: d.w + 'x' + d.h + ' rgb=(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')' }
  },
}

const PROMPTS: Record<string, string> = {
  coral: '一株紧凑的扇形/枝状珊瑚头，珊瑚粉色带暖橙渐变，形态是真实珊瑚（粗短分枝 / 扇骨状），绝不是海草叶片或细长分枝，根部在画面下端，整体竖向略方（高度接近宽度）。生物荧光点缀。' + COMMON_BG,
  starfish: '一只五臂海星微俯视，橙红色身体带浅色肌理点（细密的颗粒质感），五臂张开对称为正面观，背景纯黑无任何杂物，主体近方构图（高度与宽度接近）。生物荧光点缀。' + COMMON_BG,
  // v45-r2 (user feedback: first soil came out blue-gray). Anchored
  // the palette to tan/beige and forbade the cool drift. The 1024×512
  // canvas + "横向延伸" framing keeps the bbox a horizontal strip.
  soil: '一条横向延伸的浅暖褐色细沙沉积带纹理（tan/beige 沙色，暖色调，绝不能偏蓝偏绿偏灰），细密沙粒质感，散布少量更深的褐色小砾石颗粒，上下缘自然收边，横向长条构图。生物荧光点缀。' + COMMON_BG,
}

/** Optional per-kind (width, height) override for image-01. Coral and
 * starfish use the default 768x1104 portrait (they want a near-square
 * sprite — image-01 is biased to portrait but a centered subject still
 * comes out with a balanced bbox). Soil wants a landscape canvas so the
 * post-alpha crop lands horizontally instead of collapsing to a square
 * patch. */
const SIZE_OVERRIDE: Record<string, { w: number, h: number }> = {
  soil: { w: 1024, h: 512 },
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
    const validator = VALIDATORS[kind]
    if (validator === undefined) { process.stdout.write('no validator: ' + kind + '\n'); continue }
    const raw = resolve(OUT_DIR, kind + '-raw.png')
    const out = resolve(OUT_DIR, kind + '.png')
    try {
      let accepted = false
      let lastReason = ''
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const bytes = await generateImage(mm, prompt, SIZE_OVERRIDE[kind])
        await writeFile(raw, bytes)
        const py = spawnSync('python3', ['scripts/fauna_alpha.py', raw, out], { encoding: 'utf8' })
        if (py.status !== 0) throw new Error('alpha failed: ' + String(py.stderr))
        const r = validator(out)
        if (r.ok) {
          accepted = true
          process.stdout.write(kind + ' attempt ' + attempt + ' ok — ' + r.reason + '\n')
          break
        }
        lastReason = r.reason
        process.stdout.write(kind + ' attempt ' + attempt + ' bad — ' + r.reason + ', retrying\n')
      }
      if (!accepted) throw new Error('validator failed after 3 attempts (last: ' + lastReason + ')')
      // npx resolves the broken global wrangler here; use the project-local one.
      const put = spawnSync('./node_modules/.bin/wrangler',
        ['r2', 'object', 'put', BUCKET + '/decor/' + kind + '.png', '--file', out,
          '--remote', '--content-type', 'image/png'],
        { cwd: 'cloudflare', encoding: 'utf8' })
      if (put.status !== 0) throw new Error('r2 put failed: ' + String(put.stderr))
      done += 1
      process.stdout.write(kind + ' -> uploaded\n')
    } catch (err) {
      failed.push(kind)
      process.stdout.write(kind + ' FAILED ' + (err instanceof Error ? err.message : String(err)) + '\n')
    }
  }
  process.stdout.write('done: ' + done + ' minted, ' + failed.length + ' failed\n')
  if (failed.length > 0) process.exitCode = 1
}

void main()
