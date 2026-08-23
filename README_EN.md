# dsh-deepsea · Deep-Sea Claw

中文 | [English](README_EN.md)

**Turn your conversation context into a deep-sea claw game** — a DeepSeek Harness (DSH) floating-window game:
the longer your session context, the deeper the claw sinks; every finished AI answer snaps up one creature
from that depth, minting a MiniMax-generated holographic collectible card.

```sh
dsh plugin --profile web add github:imkingjh999/dsh-deepsea   # (once published)
# Local dev: add link:~/projects/dsh-plugins/dsh-deepsea to the profile dependencies
```

> Personal entertainment. Everything runs through your local DSH host + your own MiniMax API key;
> battle uploads are opt-in (Ed25519 signed, off by default).

## Gameplay

| Mechanic | Detail |
|---|---|
| **Depth = occupancy** | Hook rides `contextPressure` (projectedTokens / contextWindow); HUD shows depth % + tokens |
| **Four zones** | Sunlit → Twilight → Midnight → Abyss, four viewports deep; camera follows the hook down |
| **Answer = bite** | AI finish (falling `running` edge) reels up a zone creature; card from the pool or on-demand |
| **Hearthstone-style rarity** | Four tiers, depth-weighted; epic purple glow, legendary gold-foil + rainbow sweep |
| **Rarity effects** | SSR gold-foil glow + sparkles; UR rainbow conic sweep + abyssal glow; on-chain id badge |
| **On-chain identity** | Pre-minted cards are hash-chain blocks (`SHA256(prev|kind|payload)`); catches append blocks |
| **Water Margin 108 set** | 108 Stars as deep-sea creatures: top-10 天罡 Legendary, 11-36 Epic, 地煞 Rare/Common |
| **Holographic cards** | M3 lore + image-01 art; Python bakes diffraction/mask layers; browser composites the foil |
| **Card wall** | Black-screen entrance → marquee → hover pauses → click for the enlarged card + story |
| **Floating shell** | Float (drag/resize/snap-to-edge), stick rail, minimized; the ocean never unmounts |
| **Per-window boss key** | Auto-assigned (this window **Alt+X**; Shorts keeps Alt+S); title bar shows live combo |
| **Battle upload (opt-in)** | Ed25519-signed records to Worker + D1 (`deepsea-leaderboard`): wall / stats / profiles |
| **Pre-minted pool** | `scripts/mint.ts` batch-mints (MiniMax art + holo bake → R2 → D1); inventory `/api/pool/stats` |

## Configuration (optional)

In the profile's `cordis.patch.yml`:

```yaml
- id: deepsea
  config:
    minimaxApiKeyEnv: MINIMAX_API_KEY   # key chain: this env → MINIMAX_API_KEY → VISION_API_KEY → ~/.mmx/config.json
    minimaxModel: MiniMax-M3            # lore model (thinking auto-disabled)
    minimaxImageModel: image-01         # card art model
    pythonBin: python3                  # needs PIL + numpy (decoration baking)
    dataDir: ''                         # card store (default ~/.dsh/deepsea)
    workerUrl: https://deepsea.openclawd.qzz.io
```

## Architecture

- **Host** (`src/index.ts`): `POST /deepsea/api/catch` (rarity roll → M3 lore → image-01 art
  → `scripts/holo.py` bakes layers → stored), `GET /deepsea/api/cards`, `POST /deepsea/api/upload`
  (Ed25519 signing relay), `GET /deepsea/assets/*`. Every route sits behind the browser-trust fence.
- **Client** (`src/client/`): `shell.tsx` floating shell; `ocean.tsx` canvas engine
  (four-viewport water column, camera-follows-hook descent, procedural creatures, catch animation);
  `cards.tsx` holo card + wall + modal; `depth.ts` pure depth vocabulary.
  Reads `contextPressure` / `running` via `ctx.sessions` (`sessions.list` subscribed once per mount,
  rebinds only when the session changes).
- **Cloud** (`cloudflare/`): Worker + D1 (divers / catches), Ed25519 verification, rate limits,
  validation; one-command `wrangler deploy`.

## Development

```sh
pnpm install && pnpm run build
pnpm test          # vitest: depth mapping / rarity distribution / lore parsing / card store / bundle smoke
node tests/smoke-client.mjs
# cloudflare/
wrangler d1 execute deepsea-leaderboard --remote --file=schema.sql
wrangler deploy
```

## License

MIT
