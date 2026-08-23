/**
 * Mint the Water Margin 108 heroes as deep-sea creature cards. Each hero is
 * reimagined as a creature of their assigned zone: M3 writes the fused lore
 * (hero legend + deep-sea biology), image-01 paints the card art, holo.py
 * bakes the foil layers, /admin/mint chains it. Idempotent-ish: --only
 * accepts ranks to retry individual failures.
 */
import { spawnSync } from 'node:child_process'
const NL = String.fromCharCode(10)
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chat, generateImage, resolveApiKey } from '../src/minimax.ts'
import { parseLore } from '../src/lore.ts'
import { HEROES, type HeroCard } from '../src/heroes-108.ts'

const WORKER_DEFAULT = 'https://deepsea.openclawd.qzz.io'
const TOKEN_DEFAULT = join(homedir(), '.dsh', 'deepsea', 'mint-token')

const ZONE_FLAVOR: Record<string, string> = {
  sunlit: '阳光灿烂的珊瑚礁浅海（珊瑚鱼群、海龟、发光水母）',
  twilight: '微光斜照的暮光层（银斧鱼、灯笼鱼、半透明水母）',
  midnight: '永夜漆黑的午夜带（蝰鱼、发光鱿鱼、深海鮟鱇）',
  abyss: '万米之下的深渊海沟（深渊鮟鱇、吞噬鳗、小飞象章鱼）',
}

const RARITY_HINT: Record<string, string> = {
  COMMON: '朴实无华但憨态可掬',
  RARE: '带有英雄印记的罕见配色或斑纹',
  EPIC: '身覆华彩、带发光器官，气势不凡',
  LEGENDARY: '近乎神话的绚烂形态，自带神性光环，如星宿下凡',
}

function heroPrompts(h: HeroCard): [string, string] {
  const system = [
    '你是一款钓鱼收集游戏的生物图鉴作者。现在要把水浒传一百单八将之一具象化为一只深海生物收藏卡。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。字段：',
    JSON.stringify('name') + ': 中文卡名，格式「绰号·姓名」（如「浪里白条·张顺」）；',
    JSON.stringify('species') + ': 中文深海生物类群名（如「深渊鮟鱇」「银斧鱼」），须与水层匹配；',
    JSON.stringify('story') + ': 90-140 字生物志：把英雄的性情、绰号意象、水浒事迹融入这只深海生物的生态描写，结尾一句留韵味；',
    JSON.stringify('imagePrompt') + ': 英文绘画提示词：竖版收集卡插画，该深海生物为主体，
      造型或纹样暗合英雄绰号与兵器意象（颜色、斑纹、饰羽等隐喻，不要画人、不要文字），
      符合水层光照与色彩，收集卡立绘风格。',
  ].join(String.fromCharCode(10))
  const user = [
    '英雄：第' + h.rank + '席，' + h.star + '，绰号「' + h.epithet + '」，姓名' + h.name + '。',
    '水层设定：' + (ZONE_FLAVOR[h.zone] ?? '') + '。',
    '稀有度：' + h.rarity + '（' + (RARITY_HINT[h.rarity] ?? '') + '）。',
    '请创作并只输出 JSON。',
  ].join(String.fromCharCode(10))
  return [system, user]
}

async function mintHero(h: HeroCard, mm: Parameters<typeof chat>[0], token: string, worker: string,
  pythonBin: string, dry: boolean): Promise<void> {
  const label = '#' + String(h.rank).padStart(3, '0') + ' ' + h.star + ' ' + h.epithet + '·' + h.name
  const [system, user] = heroPrompts(h)
  const lore = parseLore(await chat(mm, system, user, 1400))
  const art = await generateImage(mm, lore.imagePrompt)
  const dir = join(tmpdir(), 'deepsea-hero-' + h.rank + '-' + Date.now())
  await mkdir(dir, { recursive: true })
  try {
    const artPath = join(dir, 'art.png')
    await writeFile(artPath, art)
    const run = spawnSync(pythonBin, [join(process.cwd(), 'scripts', 'holo.py'), artPath,
      join(dir, 'holo.png'), join(dir, 'mask.png')])
    if (run.status !== 0) throw new Error('holo.py exit ' + run.status)
    if (dry) { process.stdout.write('[dry] ' + label + ' ' + lore.name + ' ' + lore.species + NL); return }
    const body = {
      name: lore.name, species: lore.species, story: lore.story,
      rarity: h.rarity, zone: h.zone,
      artB64: (await readFile(join(dir, 'art.png'))).toString('base64'),
      holoB64: (await readFile(join(dir, 'holo.png'))).toString('base64'),
      maskB64: (await readFile(join(dir, 'mask.png'))).toString('base64'),
    }
    const res = await fetch(worker + '/admin/mint', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    })
    const data = JSON.parse(await res.text()) as { ok: boolean, value?: { mintId: string }, error?: unknown }
    if (!data.ok) throw new Error('mint rejected: ' + JSON.stringify(data.error))
    process.stdout.write(label + ' ' + lore.name + ' ' + lore.species + ' ' + (data.value?.mintId ?? '') + NL)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dry = argv.includes('--dry')
  const onlyIdx = argv.indexOf('--only')
  const only = onlyIdx >= 0 ? (argv[onlyIdx + 1] ?? '').split(',').map((s) => Number.parseInt(s, 10)).filter((n) =>
     !Number.isNaN(n)) : []
  const startIdx = argv.indexOf('--from')
  const from = startIdx >= 0 ? Number.parseInt(argv[startIdx + 1] ?? '1', 10) : 1
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm = { baseURL: 'https://api.minimaxi.com/v1', apiKey, model: 'MiniMax-M3', imageModel: 'image-01' }
  const token = dry ? '' : (await readFile(TOKEN_DEFAULT, 'utf8')).trim()
  const pythonBin = process.env.DEEPSEA_PYTHON ?? 'python3'
  let failed = 0
  for (const h of HEROES) {
    if (h.rank < from) continue
    if (only.length > 0 && !only.includes(h.rank)) continue
    try {
      await mintHero(h, mm, token, WORKER_DEFAULT, pythonBin, dry)
    } catch (err) {
      failed += 1
      console.error(h.name, 'FAILED:', err instanceof Error ? err.message : String(err))
    }
  }
  process.stdout.write('done, failures: ' + failed + NL)
  if (failed > 0) process.exitCode = 1
}

void main()
