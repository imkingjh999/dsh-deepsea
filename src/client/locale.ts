/** Minimal locale service re-statement (same shape dsh-shorts-wall uses). */
export interface LocaleService {
  register(ns: string, localeId: string, dict: Record<string, string>): () => void
  getLocale(): string | { id?: string, locale?: string }
  subscribe(fn: () => void): () => void
}

export const NS = 'deepsea.window'

export const zh: Record<string, string> = {
  'shell.title': '深海摸鱼',
  'shell.open': '打开深海摸鱼',
  'shell.stick': '贴边（吸右缘）',
  'shell.float': '浮窗模式',
  'shell.minimize': '最小化',
  'shell.expand': '展开深海摸鱼',
  'shell.modeToggle': '切换 浮动 / 停靠',
  'shell.floatText': '浮动',
  'shell.bossKey': '老板键 {key}',
  'shell.maximize': '最大化',
  'shell.restore': '还原',
  'hud.depth': '深度',
  'hud.tokens': 'tokens',
  'hud.noproject': '暂无上下文数据',
  'hud.touch': '摸到了！',
  'hud.grabbed': '摸鱼成功！正在生成卡片！',
  'hud.wriggled': '被挣脱了',
  'hud.genfail': '卡片生成失败',
  'hud.wall': '卡墙',
  'hud.pond': '鱼池',
  'pond.title': '鱼池',
  'pond.back': '返回卡墙',
  'pond.dragHint': '拖动查看鱼池不同区域 · 滚轮缩放',
  'pond.wander': '巡游',
  'scene.ocean': '海洋',
  'scene.wall': '卡墙',
  'scene.pond': '鱼池',
  'pond.zoomIn': '放大',
  'pond.zoomOut': '缩小',
  'pond.zoomReset': '复位缩放',
  'hud.upload': '上传战绩',
  'hud.uploaded': '已上传',
  'hud.uploadfail': '上传失败',
  'wall.close': '关闭卡墙',
  'wall.unseated': '未入座',
  'wall.copies': '张',
  'card.story': '生物志',
  'card.date': '摸鱼于',
  'card.loading': '深海孕育中…',
  'reveal.tap': '点击任意处收起',
  'hud.sound': 'Alt+M 静音',
  'hud.goldSeal': '金卡',
  'hud.roll': '掷签中…尾部对上才算摸到',
  'hud.rollpool': '签筒摇响，深海屏息|洋流推着签打转|鲸歌低语着一串数字|气泡排成一列卦象|万米深渊传来回响|签尖挑起一粒星沙',
  'hud.wrigpool': '鳞光一闪，它溜了|尾巴一甩，溅你一脸墨|差半寸，指尖只摸到水|它冲你吐了个泡泡',
  'hud.rollmine': '你的签尾',
  'hud.rolltarget': '目标',
  'hud.toosoon': '算力冷却中，稍后再试',
  'hud.toosoonwait': '刚摸到一张卡，约 {m} 分钟后再摸',
  'hud.steer': '🖐 摸鱼手跟随鼠标，点击出手',
  'ocean.pacific': '太平洋',
  'ocean.atlantic': '大西洋',
  'ocean.indian': '印度洋',
  'ocean.arctic': '北冰洋',
  'ocean.southern': '南大洋',
  'rank.title': '全球排行榜',
  'rank.refresh': '刷新',
  'rank.close': '关闭',
  'rank.loading': '正在拉取全球战绩…',
  'rank.empty': '还没有人上传战绩',
  'rank.login': '登录 GitHub 上榜',
  'rank.diver': '潜水员',
  'rank.catches': '捕获',
  'rank.rarest': '最稀有',
  'rank.me': '你',
  'wall.rank': '排行榜',
}

export const en: Record<string, string> = {
  'shell.title': 'Deep-Sea Slacking',
  'shell.open': 'Open Deep-Sea Slacking',
  'shell.stick': 'Stick to edge',
  'shell.float': 'Float mode',
  'shell.minimize': 'Minimize',
  'shell.expand': 'Expand Deep-Sea Slacking',
  'shell.modeToggle': 'Toggle float / dock',
  'shell.floatText': 'float',
  'shell.bossKey': 'Boss key {key}',
  'shell.maximize': 'Maximize',
  'shell.restore': 'Restore',
  'hud.depth': 'depth',
  'hud.tokens': 'tokens',
  'hud.noproject': 'no context data yet',
  'hud.touch': 'Touched!',
  'hud.grabbed': 'Got the fish! Generating card…',
  'hud.wriggled': 'It wriggled free!',
  'hud.genfail': 'card generation failed',
  'hud.wall': 'Card wall',
  'hud.pond': 'fish pond',
  'pond.title': 'Pond',
  'pond.back': 'back to wall',
  'pond.dragHint': 'drag to look around · wheel to zoom',
  'pond.wander': 'auto tour',
  'scene.ocean': 'Ocean',
  'scene.wall': 'Wall',
  'scene.pond': 'Pond',
  'pond.zoomIn': 'zoom in',
  'pond.zoomOut': 'zoom out',
  'pond.zoomReset': 'reset zoom',
  'hud.upload': 'Upload battle',
  'hud.uploaded': 'uploaded',
  'hud.uploadfail': 'upload failed',
  'wall.close': 'Close wall',
  'wall.unseated': 'unseated',
  'wall.copies': ' cards',
  'card.story': 'Creature file',
  'card.date': 'touched on',
  'card.loading': 'the abyss is brewing…',
  'reveal.tap': 'tap anywhere to close',
  'hud.sound': 'Alt+M mute',
  'hud.goldSeal': 'gold foil',
  'hud.roll': 'rolling… tail match wins the fish',
  'hud.rollpool': 'the tube rattles, the deep holds its breath|the current spins the stick|a whale hymn hums numbers'
    + '|bubbles line up into hexagrams|an echo rolls up from the trench|the stick tip lifts a grain of starlight',
  'hud.wrigpool': 'a flash of scales — gone|a tail flick sprays ink at you'
    + '|half an inch short, only water|it blows a bubble at you',
  'hud.rollmine': 'your tail',
  'hud.rolltarget': 'target',
  'hud.toosoon': 'hash cooling down, try again soon',
  'hud.toosoonwait': 'just touched a card — next touch in ~{m} min',
  'hud.steer': '🖐 hand follows pointer — click to grab',
  'ocean.pacific': 'Pacific Ocean',
  'ocean.atlantic': 'Atlantic Ocean',
  'ocean.indian': 'Indian Ocean',
  'ocean.arctic': 'Arctic Ocean',
  'ocean.southern': 'Southern Ocean',
  'rank.title': 'Global Leaderboard',
  'rank.refresh': 'Refresh',
  'rank.close': 'Close',
  'rank.loading': 'fetching global records…',
  'rank.empty': 'no one has uploaded a battle record yet',
  'rank.login': 'Sign in with GitHub',
  'rank.diver': 'Diver',
  'rank.catches': 'Catches',
  'rank.rarest': 'Rarest',
  'rank.me': 'you',
  'wall.rank': 'Leaderboard',
}

let service: LocaleService | undefined

/** Resolve the service's locale id; tolerates object-shaped returns. */
function localeId(): string {
  const raw = service?.getLocale?.() ?? 'zh'
  if (typeof raw === 'string') return raw
  const obj = raw as { id?: string, locale?: string }
  return typeof obj?.id === 'string' ? obj.id : typeof obj?.locale === 'string' ? obj.locale : 'zh'
}

/** Attach the live locale service (called from apply's runtime fiber). */
export function attachLocale(locale: LocaleService | undefined): () => void {
  service = locale
  if (locale === undefined) return () => { }
  const disposers = [
    locale.register(NS, 'zh', zh),
    locale.register(NS, 'en', en),
  ]
  return () => {
    for (const off of disposers) off()
    if (service === locale) service = undefined
  }
}

function dict(): Record<string, string> {
  return localeId().toLowerCase().startsWith('en') ? en : zh
}

export function isEn(): boolean {
  return localeId().toLowerCase().startsWith('en')
}

/** Translate with {0} formatting; falls back to the zh copy without a service. */
export function tr(key: string, ...args: (string | number)[]): string {
  const text = dict()[key] ?? zh[key] ?? key
  let out = text
  args.forEach((a, i) => { out = out.replaceAll(`{${i}}`, String(a)) })
  return out
}
