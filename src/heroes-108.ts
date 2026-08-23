/**
 * The Water Margin 108 Stars of Destiny card set (三十六天罡 + 七十二地煞),
 * each hero reimagined as a deep-sea creature. Rarity follows seat rank
 * (Hearthstone 4-tier): 天罡 1-10 LEGENDARY, 11-36 EPIC, 地煞 37-72 RARE,
 * 73-108 COMMON. Zones spread each tier so every zone×rarity cell that
 * ZONE_WEIGHTS can roll stays stocked.
 *
 * Single source of truth for the roster: the mint script, the tests, and
 * the client wall (seat count) all import from here — never copy-paste a
 * second table.
 */
import type { Rarity } from './client/depth.ts'

export interface HeroCard {
  rank: number
  star: string
  epithet: string
  name: string
  rarity: Rarity
  zone: 'sunlit' | 'twilight' | 'midnight' | 'abyss'
}

interface Row { star: string, epithet: string, name: string }

// 36 天罡星 (ranks 1-36), canonical order.
const TIANGANG: readonly Row[] = [
  { star: '天魁星', epithet: '呼保义', name: '宋江' },
  { star: '天罡星', epithet: '玉麒麟', name: '卢俊义' },
  { star: '天机星', epithet: '智多星', name: '吴用' },
  { star: '天闲星', epithet: '入云龙', name: '公孙胜' },
  { star: '天勇星', epithet: '大刀', name: '关胜' },
  { star: '天雄星', epithet: '豹子头', name: '林冲' },
  { star: '天猛星', epithet: '霹雳火', name: '秦明' },
  { star: '天威星', epithet: '双鞭', name: '呼延灼' },
  { star: '天英星', epithet: '小李广', name: '花荣' },
  { star: '天贵星', epithet: '小旋风', name: '柴进' },
  { star: '天富星', epithet: '扑天雕', name: '李应' },
  { star: '天满星', epithet: '美髯公', name: '朱仝' },
  { star: '天孤星', epithet: '花和尚', name: '鲁智深' },
  { star: '天伤星', epithet: '行者', name: '武松' },
  { star: '天立星', epithet: '双枪将', name: '董平' },
  { star: '天捷星', epithet: '没羽箭', name: '张清' },
  { star: '天暗星', epithet: '青面兽', name: '杨志' },
  { star: '天祐星', epithet: '金枪手', name: '徐宁' },
  { star: '天空星', epithet: '急先锋', name: '索超' },
  { star: '天速星', epithet: '神行太保', name: '戴宗' },
  { star: '天异星', epithet: '赤发鬼', name: '刘唐' },
  { star: '天杀星', epithet: '黑旋风', name: '李逵' },
  { star: '天微星', epithet: '九纹龙', name: '史进' },
  { star: '天究星', epithet: '没遮拦', name: '穆弘' },
  { star: '天退星', epithet: '插翅虎', name: '雷横' },
  { star: '天寿星', epithet: '混江龙', name: '李俊' },
  { star: '天剑星', epithet: '立地太岁', name: '阮小二' },
  { star: '天平星', epithet: '船火儿', name: '张横' },
  { star: '天罪星', epithet: '短命二郎', name: '阮小五' },
  { star: '天损星', epithet: '浪里白条', name: '张顺' },
  { star: '天败星', epithet: '活阎罗', name: '阮小七' },
  { star: '天牢星', epithet: '病关索', name: '杨雄' },
  { star: '天慧星', epithet: '拼命三郎', name: '石秀' },
  { star: '天暴星', epithet: '两头蛇', name: '解珍' },
  { star: '天哭星', epithet: '双尾蝎', name: '解宝' },
  { star: '天巧星', epithet: '浪子', name: '燕青' },
]

// 72 地煞星 (ranks 37-108), canonical order.
const DISHA: readonly Row[] = [
  { star: '地魁星', epithet: '神机军师', name: '朱武' },
  { star: '地煞星', epithet: '镇三山', name: '黄信' },
  { star: '地勇星', epithet: '病尉迟', name: '孙立' },
  { star: '地杰星', epithet: '丑郡马', name: '宣赞' },
  { star: '地雄星', epithet: '井木犴', name: '郝思文' },
  { star: '地威星', epithet: '百胜将', name: '韩滔' },
  { star: '地英星', epithet: '天目将', name: '彭玘' },
  { star: '地奇星', epithet: '圣水将', name: '单廷珪' },
  { star: '地猛星', epithet: '神火将', name: '魏定国' },
  { star: '地文星', epithet: '圣手书生', name: '萧让' },
  { star: '地正星', epithet: '铁面孔目', name: '裴宣' },
  { star: '地阔星', epithet: '摩云金翅', name: '欧鹏' },
  { star: '地阖星', epithet: '火眼狻猊', name: '邓飞' },
  { star: '地强星', epithet: '锦毛虎', name: '燕顺' },
  { star: '地暗星', epithet: '锦豹子', name: '杨林' },
  { star: '地轴星', epithet: '轰天雷', name: '凌振' },
  { star: '地会星', epithet: '神算子', name: '蒋敬' },
  { star: '地佐星', epithet: '小温侯', name: '吕方' },
  { star: '地祐星', epithet: '赛仁贵', name: '郭盛' },
  { star: '地灵星', epithet: '神医', name: '安道全' },
  { star: '地兽星', epithet: '紫髯伯', name: '皇甫端' },
  { star: '地微星', epithet: '矮脚虎', name: '王英' },
  { star: '地慧星', epithet: '一丈青', name: '扈三娘' },
  { star: '地暴星', epithet: '丧门神', name: '鲍旭' },
  { star: '地然星', epithet: '混世魔王', name: '樊瑞' },
  { star: '地猖星', epithet: '毛头星', name: '孔明' },
  { star: '地狂星', epithet: '独火星', name: '孔亮' },
  { star: '地飞星', epithet: '八臂哪吒', name: '项充' },
  { star: '地走星', epithet: '飞天大圣', name: '李衮' },
  { star: '地巧星', epithet: '玉臂匠', name: '金大坚' },
  { star: '地明星', epithet: '铁笛仙', name: '马麟' },
  { star: '地进星', epithet: '出洞蛟', name: '童威' },
  { star: '地退星', epithet: '翻江蜃', name: '童猛' },
  { star: '地满星', epithet: '玉幡竿', name: '孟康' },
  { star: '地遂星', epithet: '通臂猿', name: '侯健' },
  { star: '地周星', epithet: '跳涧虎', name: '陈达' },
  { star: '地隐星', epithet: '白花蛇', name: '杨春' },
  { star: '地异星', epithet: '白面郎君', name: '郑天寿' },
  { star: '地理星', epithet: '九尾龟', name: '陶宗旺' },
  { star: '地俊星', epithet: '铁扇子', name: '宋清' },
  { star: '地乐星', epithet: '铁叫子', name: '乐和' },
  { star: '地捷星', epithet: '花项虎', name: '龚旺' },
  { star: '地速星', epithet: '中箭虎', name: '丁得孙' },
  { star: '地镇星', epithet: '小遮拦', name: '穆春' },
  { star: '地稽星', epithet: '操刀鬼', name: '曹正' },
  { star: '地魔星', epithet: '云里金刚', name: '宋万' },
  { star: '地妖星', epithet: '摸着天', name: '杜迁' },
  { star: '地幽星', epithet: '病大虫', name: '薛永' },
  { star: '地伏星', epithet: '金眼彪', name: '施恩' },
  { star: '地僻星', epithet: '打虎将', name: '李忠' },
  { star: '地空星', epithet: '小霸王', name: '周通' },
  { star: '地孤星', epithet: '金钱豹子', name: '汤隆' },
  { star: '地全星', epithet: '鬼脸儿', name: '杜兴' },
  { star: '地短星', epithet: '出林龙', name: '邹渊' },
  { star: '地角星', epithet: '独角龙', name: '邹润' },
  { star: '地囚星', epithet: '旱地忽律', name: '朱贵' },
  { star: '地藏星', epithet: '笑面虎', name: '朱富' },
  { star: '地平星', epithet: '铁臂膊', name: '蔡福' },
  { star: '地损星', epithet: '一枝花', name: '蔡庆' },
  { star: '地奴星', epithet: '催命判官', name: '李立' },
  { star: '地察星', epithet: '青眼虎', name: '李云' },
  { star: '地恶星', epithet: '没面目', name: '焦挺' },
  { star: '地丑星', epithet: '石将军', name: '石勇' },
  { star: '地数星', epithet: '小尉迟', name: '孙新' },
  { star: '地阴星', epithet: '母大虫', name: '顾大嫂' },
  { star: '地刑星', epithet: '菜园子', name: '张青' },
  { star: '地壮星', epithet: '母夜叉', name: '孙二娘' },
  { star: '地劣星', epithet: '活闪婆', name: '王定六' },
  { star: '地健星', epithet: '险道神', name: '郁保四' },
  { star: '地耗星', epithet: '白日鼠', name: '白胜' },
  { star: '地贼星', epithet: '鼓上蚤', name: '时迁' },
  { star: '地狗星', epithet: '金毛犬', name: '段景住' },
]

const LEG_ZONES = [
  'abyss', 'abyss', 'midnight', 'abyss', 'midnight',
  'abyss', 'twilight', 'abyss', 'midnight', 'sunlit',
] as const
const EPIC_ZONES = [
  'midnight', 'abyss', 'twilight', 'midnight', 'abyss',
  'midnight', 'twilight', 'abyss', 'midnight', 'sunlit',
  'twilight', 'abyss', 'midnight', 'twilight', 'abyss',
  'midnight', 'twilight', 'abyss', 'midnight', 'twilight',
  'abyss', 'midnight', 'twilight', 'abyss', 'midnight',
  'twilight'
] as const
const RARE_ZONES = [
  'sunlit', 'twilight', 'midnight', 'abyss', 'sunlit',
  'twilight', 'midnight', 'twilight', 'abyss', 'sunlit',
  'twilight', 'midnight', 'abyss', 'sunlit', 'twilight',
  'midnight', 'twilight', 'abyss', 'sunlit', 'twilight',
  'midnight', 'abyss', 'sunlit', 'twilight', 'midnight',
  'twilight', 'abyss', 'sunlit', 'twilight', 'midnight',
  'abyss', 'sunlit', 'twilight', 'midnight', 'twilight',
  'abyss'
] as const
const COMMON_ZONES = [
  'sunlit', 'twilight', 'sunlit', 'midnight', 'sunlit',
  'twilight', 'sunlit', 'abyss', 'sunlit', 'twilight',
  'sunlit', 'midnight', 'sunlit', 'twilight', 'sunlit',
  'sunlit', 'twilight', 'sunlit', 'midnight', 'sunlit',
  'twilight', 'sunlit', 'abyss', 'sunlit', 'twilight',
  'sunlit', 'midnight', 'sunlit', 'twilight', 'sunlit',
  'twilight', 'sunlit', 'midnight', 'sunlit', 'twilight',
  'sunlit'
] as const

const ZONE_LISTS: Record<Rarity, readonly string[]> = {
  LEGENDARY: LEG_ZONES, EPIC: EPIC_ZONES, RARE: RARE_ZONES, COMMON: COMMON_ZONES,
}

export const HEROES: readonly HeroCard[] = (() => {
  const out: HeroCard[] = []
  const cursors = new Map<Rarity, number>()
  const push = (row: Row, rank: number, rarity: Rarity): void => {
    const list = ZONE_LISTS[rarity]
    const i = cursors.get(rarity) ?? 0
    cursors.set(rarity, i + 1)
    const zone = list[i % list.length] ?? 'sunlit'
    out.push({ rank, ...row, rarity, zone: zone as HeroCard['zone'] })
  }
  TIANGANG.forEach((row, i) => {
    const rank = i + 1
    push(row, rank, rank <= 10 ? 'LEGENDARY' : 'EPIC')
  })
  DISHA.forEach((row, i) => {
    const rank = i + 37
    push(row, rank, rank <= 72 ? 'RARE' : 'COMMON')
  })
  return out
})()

/** Every zone×rarity cell the weight table can roll must have a card. */
export function heroPlanGaps(weights: Array<Record<string, number>>): string[] {
  const have = new Set(HEROES.map((h) => h.zone + ':' + h.rarity))
  const gaps: string[] = []
  weights.forEach((w, z) => {
    const zone = ['sunlit', 'twilight', 'midnight', 'abyss'][z] ?? 'sunlit'
    for (const [rarity, weight] of Object.entries(w)) {
      if (weight > 0 && !have.has(zone + ':' + rarity)) gaps.push(zone + ':' + rarity)
    }
  })
  return gaps
}
