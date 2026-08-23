# dsh-deepsea · 深海垂爪

[English](README_EN.md) | 中文

**把会话上下文变成一场深海垂爪** —— DeepSeek Harness（DSH）浮窗小游戏：你的对话 context 越长，爪子沉得越深；AI 每答完一轮，就有一只该深度的海洋生物入爪，化作一张 MiniMax 生成的镭射收藏卡。

```sh
dsh plugin --profile web add github:imkingjh999/dsh-deepsea   #（发布后）
# 本地开发：profile dependencies 加 link:~/projects/dsh-plugins/dsh-deepsea
```

> 个人娱乐用途。全部能力走本机 DSH 宿主 + 你自己的 MiniMax API Key；战绩上传为可选（默认关闭，Ed25519 签名）。

## 玩法

| 机制 | 说明 |
|------|------|
| **深度即占用率** | 钩深实时映射当前会话 `contextPressure`（projectedTokens / contextWindow），HUD 显示深度百分比与 tokens |
| **四个水层** | 透光带 → 暮光带 → 午夜带 → 深渊带；海洋纵深为四个屏高，镜头随钩下沉、水体连续变暗，一屏只见一个水层；越深的生物越「深海」：珊瑚鱼 → 银斧鱼 → 蝰鱼/发光鱿鱼 → 鮟鱇/吞噬鳗/小飞象章鱼 |
| **答完即上抓** | AI 回答结束（`running` 下降沿）→ 该水层一条生物被拉出水面 → 从预铸卡池抽卡（即时）；池空或离线自动回退为现场生成 |
| **炉石式四档稀有度** | 普通(白)/稀有(蓝)/史诗(紫)/传说(橙) 四档，按深度加权（透光带几乎不出传说，深渊 22% 传说）；史诗紫光呼吸、传说金箔+彩虹流光+星点 |
| **稀有度特效** | SSR 金箔呼吸光晕 + 闪烁星点；UR 彩虹锥形流光 + 星点 + 深渊红紫辉光；卡面角标显示链上编号 |
| **链上唯一标识** | 预铸卡是哈希链上的区块（`SHA256(prev|kind|payload)`），编号形如 `DS-0007-12be84f8`；捕获追加 catch 区块，`/api/chain/verify` 重算校验 |
| **防篡改加固** | 链尖哈希定期存证公开仓库 deepsea-chain（重写即对不上锚点）；mint 区块记录三层卡图 sha256，`verify-assets` 取图比对，抓「换图不动账本」 |
| **水浒 108 将卡池** | 三十六天罡 + 七十二地煞深海具象化：天罡前 10 席传说、11-36 席史诗、地煞前 36 席稀有、后 36 席普通；卡名如「浪里白条·张顺」 |
| **镭射卡** | MiniMax M3 写生物志 + image-01 出卡图；Python 为每张卡烘焙「衍射纹理 + 椭圆遮罩」双层装饰，浏览器端用 CSS 混合模式 + 鼠标物理倾斜还原随光流转的镭射质感 |
| **卡墙** | 保留在浮窗内的多行静态网格（纵向滚动）；悬停单卡才播黑屏入场动画；点击弹出大卡；水浒英雄卡带 108 星宿角标（如「天魁星」） |
| **浮窗形态** | 浮窗（拖拽/缩放/拖到右缘贴边）、贴边竖栏（点击展开）、最小化（右下角按钮或老板键），模式切换时海洋持续运行不重载 |
| **多窗老板键** | 与 shorts-wall 等其它浮窗同屏时自动领取不冲突的组合（本窗为 **Alt+X**，Shorts 固定 Alt+S），标题栏与 tooltip 实时显示实际按键 |
| **战绩上云（可选）** | Ed25519 签名上传战绩到 Cloudflare Worker + D1（`deepsea-leaderboard`），提供全服卡墙 / 统计 / 潜水员档案接口 |
| **预铸卡池** | `scripts/mint.ts` 批量铸造（MiniMax 出图 + holo 烘焙 → R2 → D1 上链），库存见 `GET /api/pool/stats` |

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
- **client 半**（`src/client/`）：`shell.tsx` 浮窗外壳；`ocean.tsx` Canvas 海洋引擎（纵深四屏水体、镜头随钩下沉 / 程序化生物 / 上抓动画）；
  `cards.tsx` 镭射卡 + 卡墙 + 大卡弹窗；`depth.ts` 深度词汇表。经 `ctx.sessions` 读 `contextPressure` / `running`
  （`sessions.list` 只订阅一次、仅换会话时重绑，避免通知回调里重复订阅死循环）。
- **云端**（`cloudflare/`）：Worker + D1（divers / catches 表），Ed25519 验签、限流、校验；`wrangler deploy` 一条命令。

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
