/**
 * Rarity roll + card lore spec — pure and unit-testable.
 *
 * Rarity is depth-weighted: the abyss can mint anything (and UR lives there),
 * the sunlit band tops out at SR. The roll is a plain weighted pick so tests
 * can pin the distribution.
 */
import type { Rarity } from './client/depth.ts'

export interface RarityWeights { COMMON: number; RARE: number; EPIC: number; LEGENDARY: number }

/** Per-zone weight tables (index = zone 0..3), Hearthstone-ish pack odds. */
export const ZONE_WEIGHTS: readonly RarityWeights[] = [
  { COMMON: 72, RARE: 23, EPIC: 4, LEGENDARY: 1 }, // sunlit
  { COMMON: 48, RARE: 36, EPIC: 13, LEGENDARY: 3 }, // twilight
  { COMMON: 24, RARE: 37, EPIC: 29, LEGENDARY: 10 }, // midnight
  { COMMON: 6, RARE: 24, EPIC: 40, LEGENDARY: 30 }, // abyss
]

export function rollRarity(zoneIdx: number, random: () => number = Math.random): Rarity {
  const table = ZONE_WEIGHTS[Math.min(Math.max(zoneIdx, 0), ZONE_WEIGHTS.length - 1)] as RarityWeights
  const entries = Object.entries(table) as Array<[Rarity, number]>
  const total = entries.reduce((sum, [, w]) => sum + w, 0)
  let pick = random() * total
  for (const [rarity, w] of entries) {
    pick -= w
    if (pick < 0) return rarity
  }
  return 'COMMON'
}

export interface LoreSpec {
  name: string
  species: string
  story: string
  imagePrompt: string
}

const ZONE_FLAVOR: ReadonlyArray<Record<string, string>> = [
  { zh: '阳光灿烂的珊瑚礁浅海', fauna: '珊瑚礁鱼群、海龟、发光水母等浅海生物' },
  { zh: '微光斜照的暮光层', fauna: '银斧鱼、灯笼鱼、半透明水母等暮光生物' },
  { zh: '永夜漆黑的午夜带', fauna: '蝰鱼、发光鱿鱼、深海鮟鱇等高压生物' },
  { zh: '万米之下的深渊海沟', fauna: '深渊鮟鱇、吞噬鳗、小飞象章鱼等极端生物' },
]

/** Build the M3 prompt pair; returns [system, user]. */
export function lorePrompts(zoneIdx: number, rarity: Rarity): [string, string] {
  const zone = ZONE_FLAVOR[Math.min(Math.max(zoneIdx, 0), 3)] as Record<string, string>
  const rarityHint: Record<Rarity, string> = {
    COMMON: '外形平凡但惹人喜爱',
    RARE: '有明显特征标记或罕见配色',
    EPIC: '带有奇妙发光器官或华丽形态，气势不凡',
    LEGENDARY: '近乎神话的绚烂形态，如身覆星图、带神性光环',
  }
  const system = [
    '你是一款钓鱼收集游戏的生物图鉴作者。为一次海钓战利品创作一张收集卡的资料。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。字段：',
    '"name": 中文生物名，2-6 字，独特有记忆点；',
    '"species": 中文类群名（如"深渊鮟鱇""发光鱿鱼"）；',
    '"story": 90-140 字的生物志，文学化、有细节、符合其水层生态，结尾一句留韵味；',
    '"imagePrompt": 英文绘画提示词，描述一张竖版收集卡插画：该生物为主体，' +
    '符合水层光照与色彩，卡片插画风格（收集卡立绘、细腻、微光背景），' +
    '不出现文字框。',
  ].join('\n')
  const user = [
    `水层设定：${zone.zh}。候选类群：${zone.fauna}。`,
    `稀有度：${rarity}（${rarityHint[rarity]}）。`,
    '请创作并只输出 JSON。',
  ].join('\n')
  return [system, user]
}

/** Parse the model output into a LoreSpec; tolerates fences and trailing text. */
export function parseLore(raw: string): LoreSpec {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence !== null && fence[1] !== undefined) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('lore JSON 未找到')
  let obj: Partial<LoreSpec>
  try {
    obj = JSON.parse(text.slice(start, end + 1)) as Partial<LoreSpec>
  } catch {
    throw new Error('lore JSON 解析失败')
  }
  const name = typeof obj.name === 'string' && obj.name.trim() !== '' ? obj.name.trim() : null
  const species = typeof obj.species === 'string' && obj.species.trim() !== '' ? obj.species.trim() : null
  const story = typeof obj.story === 'string' && obj.story.trim() !== '' ? obj.story.trim() : null
  const imagePrompt = typeof obj.imagePrompt === 'string' && obj.imagePrompt.trim() !== '' ? obj.imagePrompt.trim() :
     null
  if (name === null || species === null || story === null || imagePrompt === null) {
    throw new Error('lore JSON 字段缺失')
  }
  return { name, species, story, imagePrompt }
}
