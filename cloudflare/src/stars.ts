/**
 * Worker-side 108 star table — a pure naming system for cards, decoupled
 * from the Water Margin roster: every card name (creature or otherwise)
 * maps to a star by FNV-1a hash, nothing else. The client bundle carries
 * NO star data: stars are assigned at mint time (stored per-card in D1),
 * served with draws, and /api/star names on-demand creatures.
 */
export const STARS: readonly string[] = [
  "天魁星",
  "天罡星",
  "天机星",
  "天闲星",
  "天勇星",
  "天雄星",
  "天猛星",
  "天威星",
  "天英星",
  "天贵星",
  "天富星",
  "天满星",
  "天孤星",
  "天伤星",
  "天立星",
  "天捷星",
  "天暗星",
  "天祐星",
  "天空星",
  "天速星",
  "天异星",
  "天杀星",
  "天微星",
  "天究星",
  "天退星",
  "天寿星",
  "天剑星",
  "天平星",
  "天罪星",
  "天损星",
  "天败星",
  "天牢星",
  "天慧星",
  "天暴星",
  "天哭星",
  "天巧星",
  "地魁星",
  "地煞星",
  "地勇星",
  "地杰星",
  "地雄星",
  "地威星",
  "地英星",
  "地奇星",
  "地猛星",
  "地文星",
  "地正星",
  "地阔星",
  "地阖星",
  "地强星",
  "地暗星",
  "地轴星",
  "地会星",
  "地佐星",
  "地祐星",
  "地灵星",
  "地兽星",
  "地微星",
  "地慧星",
  "地暴星",
  "地然星",
  "地猖星",
  "地狂星",
  "地飞星",
  "地走星",
  "地巧星",
  "地明星",
  "地进星",
  "地退星",
  "地满星",
  "地遂星",
  "地周星",
  "地隐星",
  "地异星",
  "地理星",
  "地俊星",
  "地乐星",
  "地捷星",
  "地速星",
  "地镇星",
  "地稽星",
  "地魔星",
  "地妖星",
  "地幽星",
  "地伏星",
  "地僻星",
  "地空星",
  "地孤星",
  "地全星",
  "地短星",
  "地角星",
  "地囚星",
  "地藏星",
  "地平星",
  "地损星",
  "地奴星",
  "地察星",
  "地恶星",
  "地丑星",
  "地数星",
  "地阴星",
  "地刑星",
  "地壮星",
  "地劣星",
  "地健星",
  "地耗星",
  "地贼星",
  "地狗星",
]


function hashOf(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic star for any card name — pure hash, decoupled from the
 * Water Margin roster: the 108 star names are just a naming system. */
export function starOf(name: string): string {
  return STARS[hashOf(name) % STARS.length] ?? STARS[0] ?? ''
}

export function starRankOf(name: string): number {
  return STARS.indexOf(starOf(name)) + 1
}

/** Rank (1-108) of a star name; 0 when unknown. */
export function starRankOfStar(star: string): number {
  return STARS.indexOf(star) + 1
}

/** Gold-foil roll, deterministic in the card's chain id (~1 in 10 cards).
 * Server-decided like the star: mint/draw responses carry it, the client
 * only renders. Non-pool cards use the same hash on 'local:' + id. */
export function goldOf(mintId: string): boolean {
  return hashOf('gold:' + mintId) % 10 === 0
}
