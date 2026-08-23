/**
 * MiniMax client for the card pipeline: chat completion (card lore JSON,
 * thinking disabled — the only flag MiniMax-M3 honors) and image generation
 * (image-01, base64 response so nothing depends on CDN TTL).
 * Auth resolution: config apiKeyEnv (default MINIMAX_API_KEY) → VISION_API_KEY
 * → ~/.mmx/config.json api_key (the mmx CLI's store). China region endpoint.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface MiniMaxConfig {
  baseURL: string
  apiKey: string
  model: string
  imageModel: string
}

export class MiniMaxError extends Error {
  constructor(message: string) { super(message); this.name = 'MiniMaxError' }
}

/** Parse a response body as JSON; converts syntax errors into a typed
 * MiniMaxError so every failure leaving this module has one error shape
 * (callers switch on MiniMaxError, not raw SyntaxError). */
function parseBody<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new MiniMaxError(`${what} 返回非 JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Resolve the API key: env chain first, then the mmx CLI config file. */
export async function resolveApiKey(primaryEnv: string): Promise<string> {
  for (const name of [primaryEnv, 'MINIMAX_API_KEY', 'VISION_API_KEY']) {
    const v = process.env[name]
    if (v !== undefined && v !== '') return v
  }
  try {
    const cfg = JSON.parse(await readFile(join(homedir(), '.mmx', 'config.json'), 'utf8')) as { api_key?: string }
    if (typeof cfg.api_key === 'string' && cfg.api_key !== '') return cfg.api_key
  } catch { /* no mmx config */ }
  throw new MiniMaxError('未找到 MiniMax API Key（env MINIMAX_API_KEY / VISION_API_KEY 或 ~/.mmx/config.json）')
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/** Chat completion; `thinking: {type:'disabled'}` per the M3 quirk. */
export async function chat(cfg: MiniMaxConfig, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      thinking: { type: 'disabled' },
      max_tokens: maxTokens,
      temperature: 0.9,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new MiniMaxError(`MiniMax chat HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`)
  const data = parseBody<ChatResponse>(await res.text(), 'MiniMax chat')
  const content = data.choices?.[0]?.message?.content
  if (content === undefined || content === '') throw new MiniMaxError('MiniMax chat 返回空内容')
  return content
}

/** Ask the vision-capable chat model which way a creature sprite faces.
 * Used to normalize generated sprites to head-RIGHT: generation prompts ask
 * for it but image models drift, and a head-left sprite looks like it swims
 * backwards once the renderer flips it for leftward motion. */
export async function classifySpriteHeading(
  cfg: MiniMaxConfig, pngBase64: string,
): Promise<'LEFT' | 'RIGHT' | 'OTHER'> {
  const res = await fetch(cfg.baseURL + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/png;base64,' + pngBase64 } },
          { type: 'text', text: '图中生物的头部或前端朝向画面的左边还是右边？只回答一个词：LEFT、RIGHT 或 OTHER（上下朝向或无法判断用 OTHER）。' },
        ],
      }],
      thinking: { type: 'disabled' },
      max_tokens: 8,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new MiniMaxError('MiniMax vision HTTP ' + res.status + ': ' + (await res.text()).slice(0, 180))
  const data = parseBody<ChatResponse>(await res.text(), 'MiniMax vision')
  const answer = (data.choices?.[0]?.message?.content ?? '').trim().toUpperCase()
  const left = answer.includes('LEFT') || answer.includes('左')
  const right = answer.includes('RIGHT') || answer.includes('右')
  if (left !== right) return left ? 'LEFT' : 'RIGHT'
  return 'OTHER'
}

interface ImageResponse {
  data?: { image_base64?: string[], image_urls?: string[] }
}

/** Generate one card-art image; returns raw PNG bytes. */
export async function generateImage(cfg: MiniMaxConfig, prompt: string,
  size?: { w: number, h: number }): Promise<Buffer> {
  const res = await fetch(`${cfg.baseURL.replace(/\/v1$/, '')}/v1/image_generation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.imageModel,
      prompt,
      response_format: 'base64',
      width: size?.w ?? 768,
      height: size?.h ?? 1104,
      n: 1,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new MiniMaxError(`MiniMax image HTTP ${res.status}: ${(await res.text()).slice(0, 180)}`)
  const data = parseBody<ImageResponse>(await res.text(), 'MiniMax image')
  const b64 = data.data?.image_base64?.[0]
  if (typeof b64 === 'string' && b64 !== '') return Buffer.from(b64, 'base64')
  for (const url of data.data?.image_urls ?? []) {
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (img.ok) return Buffer.from(await img.arrayBuffer())
  }
  throw new MiniMaxError('MiniMax image 未返回图片')
}

/** Generate an image conditioned on a reference image (subject_reference
 * on the same image_generation endpoint; image-01 accepts a data-URL
 * reference) — used to redraw card art as matching pond sprites. */
export async function generateImageWithRef(cfg: MiniMaxConfig, prompt: string, refBase64: string): Promise<Buffer> {
  const res = await fetch(cfg.baseURL.replace(/\/v1$/, '') + '/v1/image_generation', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({
      model: cfg.imageModel,
      prompt,
      subject_reference: [{ type: 'character', image_file: 'data:image/png;base64,' + refBase64 }],
      response_format: 'base64',
      n: 1,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new MiniMaxError('MiniMax image(ref) HTTP ' + res.status + ': ' + (await res.text()).slice(0, 180))
  const data = parseBody<ImageResponse>(await res.text(), 'MiniMax image(ref)')
  const b64 = data.data?.image_base64?.[0]
  if (typeof b64 === 'string' && b64 !== '') return Buffer.from(b64, 'base64')
  for (const url of data.data?.image_urls ?? []) {
    const img = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (img.ok) return Buffer.from(await img.arrayBuffer())
  }
  throw new MiniMaxError('MiniMax image(ref) 未返回图片')
}
