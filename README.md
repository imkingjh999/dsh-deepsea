# dsh-deepsea · 深海摸鱼

[English](README_EN.md) | 中文

**把会话上下文变成一场深海摸鱼** —— DeepSeek Harness（DSH）浮窗小游戏：你的对话 context 越长，摸鱼手沉得越深；AI 每答完一轮，就有一条该深度的海洋生物入手，化作一张 MiniMax 生成的镭射收藏卡——上班摸鱼，摸出收藏。

## 预览

| 海洋摸鱼 | 卡墙收藏 | 鱼池养成 |
|:---:|:---:|:---:|
| ![海洋摸鱼](assets/screenshots/deepsea-ocean.png) | ![卡墙](assets/screenshots/deepsea-wall.png) | ![鱼池](assets/screenshots/deepsea-pond.png) |

```sh
dsh plugin --profile web add npm:dsh-deepsea          # npm（推荐）
dsh plugin --profile web add github:imkingjh999/dsh-deepsea   # GitHub
# 本地开发：profile dependencies 加 link:<本仓库路径>
```

> 个人娱乐用途。全部能力走本机 DSH 宿主 + 你自己的 MiniMax API Key；战绩上传为可选（默认关闭，Ed25519 签名）。

## 玩法

| 机制 | 说明 |
|------|------|
| **深度即占用率** | 钩深实时映射当前会话 `contextPressure`（projectedTokens / contextWindow），HUD 显示深度百分比与 tokens |
| **四个水层 × 五大洋** | 透光带 → 暮光带 → 午夜带 → 深渊带，海洋纵深为四个屏高，镜头随钩下沉、水体连续变暗；太平洋 / 大西洋 / 印度洋 / 北冰洋 / 南大洋一键切换，各有独立生物池、水体色与 BGM；越深的生物越「深海」：珊瑚鱼 → 银斧鱼 → 蝰鱼/发光鱿鱼 → 鮟鱇/吞噬鳗/小飞象章鱼 |
| **手动摸鱼 + 必接触** | 摸鱼手跟随鼠标，左键出手；手与鱼重叠时点击**必定摸到**——中不中卡交给服务端骰子（1/5，新潜水员前 5 分钟 1/2 新手运势），中卡后 5 分钟冷却也是服务端裁决 |
| **掷骰剧场** | 摸到鱼后先「掷骰」：挑战串哈希尾号与目标比对的全屏剧场（快滚 900ms → 慢滚 500ms → 结果定格），中骰 mint 卡、不中鱼挣脱 |
| **水浒 108 将卡池** | 三十六天罡 + 七十二地煞深海具象化：天罡前 10 席传说、11-36 席史诗、地煞前 36 席稀有、后 36 席普通；卡名如「浪里白条·张顺」，108 星宿角标（如「天魁星」） |
| **镭射卡** | MiniMax M3 写生物志 + image-01 出卡图；Python 为每张卡烘焙「衍射纹理 + 椭圆遮罩」双层装饰，浏览器端用 CSS 混合模式 + 鼠标物理倾斜还原随光流转的镭射质感；SSR 金箔呼吸光晕、UR 彩虹锥形流光 |
| **卡墙** | 浮窗内多行静态网格（纵向滚动）；悬停单卡播黑屏入场动画；点击弹出大卡 |
| **鱼池养成** | 钓到的鱼全量放养进多屏鱼池世界：巡游、缩放（0.5–2.5×，指针锚定）、水面双正弦波光、MiniMax 绘制的岛屿与船只剪影 |
| **链上唯一标识** | 预铸卡是哈希链上的区块（`SHA256(prev|kind|payload)`），编号形如 `DS-0007-12be84f8`；捕获追加 catch 区块，`/api/chain/verify` 重算校验；链尖哈希定期存证公开仓库 deepsea-chain |
| **防篡改加固** | mint 区块记录三层卡图 sha256，`verify-assets` 取图比对，抓「换图不动账本」 |
| **浮窗形态** | 浮窗（拖拽 / 四角缩放 / 拖到右缘或一键切换**精确贴边**）、贴边竖栏、最小化；模式切换时海洋持续运行不重载 |
| **多窗老板键** | 与 shorts-wall 等其它浮窗同屏时自动领取不冲突的组合（本窗为 **Alt+X**，Shorts 固定 Alt+S），标题栏与 tooltip 实时显示实际按键；Alt+M 静音 |
| **战绩上云（可选）** | Cloudflare Worker + D1 服务端裁决真账（pow_wins）：掷骰胜负、卡牌铸造全由服务端判定，Ed25519 只证身份；**绑定 GitHub** 才上全球排行榜，榜显用户名 + 头像；自报战绩一律不信任 |
| **预铸卡池** | `scripts/mint.ts` 批量铸造（MiniMax 出图 + holo 烘焙 → R2 → D1 上链），全部媒体资产走 R2；每次「release」窗口 10–20 分钟随机轮换一张在钓鱼台上的卡 |

## 配置（可选）

profile 的 `cordis.patch.yml`：

```yaml
- id: deepsea
  config:
    minimaxApiKeyEnv: MINIMAX_API_KEY   # Key 解析链：此 env → MINIMAX_API_KEY → VISION_API_KEY → ~/.mmx/config.json
    minimaxModel: MiniMax-M3            # 生物志模型（thinking 自动禁用）
    minimaxImageModel: image-01         # 卡图模型
    pythonBin: python3                  # 需 PIL + numpy（衍射装饰层烘焙）
    dataDir: ''                         # 卡片存储（默认 ~/.dsh/deepsea）
    workerUrl: https://deepsea.openclawd.qzz.io
```

## 架构

- **宿主半**（`src/index.ts`）：`POST /deepsea/api/catch`（稀有度抽取 → M3 文案 → image-01 出图 → `scripts/holo.py` 烘焙 → 落盘）、
  `GET /deepsea/api/cards`、`POST /deepsea/api/upload`（Ed25519 中继）、`GET /deepsea/assets/*`。全部路由过 browser-trust fence。
- **client 半**（`src/client/`）：`shell.tsx` 浮窗外壳；`ocean.tsx` Canvas 海洋引擎（纵深四屏水体、镜头随钩下沉 / 程序化生物 / 摸鱼收获动画）；
  `cards.tsx` 镭射卡 + 卡墙 + 大卡弹窗；`depth.ts` 深度词汇表。经 `ctx.sessions` 读 `contextPressure` / `running`
  （`sessions.list` 只订阅一次、仅换会话时重绑，避免通知回调里重复订阅死循环）。
- **云端**（`cloudflare/`）：Worker + D1（`pow_wins` 服务端裁决账本、`releases` 发卡窗口、`github_links` 身份绑定），PoW 掷骰裁决、Ed25519 验签、win-only 5 分钟冷却、新手 5 分钟运势窗口；`wrangler deploy` 一条命令部署。

## 开发

```sh
pnpm install && pnpm run build
pnpm test          # vitest：深度映射 / 稀有度分布 / 文案解析 / 卡片存取 / bundle 冒烟
node tests/smoke-client.mjs
# cloudflare/
wrangler d1 execute deepsea-leaderboard --remote --file=schema.sql
wrangler deploy
```

## License

MIT
