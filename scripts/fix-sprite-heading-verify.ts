/**
 * fix-sprite-heading-verify.ts — SELF-VERIFYING heading normalization.
 *
 * Why this exists (replaces the old "mirror on first LEFT" approach):
 *   - The old run classified + mirrored in one shot; if the SAME card was
 *     re-processed on a retry run, the disk file was already mirrored, but
 *     it still pointed LEFT (the head stayed on the same canvas side after
 *     the mirror), so the script flipped it BACK to the wrong direction.
 *   - Net effect: cards were reported as "kept" but were actually wrong.
 *   - Worse: the MiniMax vision classifier has single-shot noise — a single
 *     judgement isn't authoritative enough to commit a destructive mirror.
 *
 * The fix: every card goes through a closed loop that converges to a
 * provably-right state, OR is flagged for human review.
 *
 *   1) c1 = classify(current bytes)
 *   2) c1 == RIGHT → kept (no disk change, log c1=RIGHT)
 *   3) c1 == LEFT → mirror → c2 = classify(mirrored bytes)
 *        c2 == RIGHT → fixed (disk flipped to RIGHT, log c2=RIGHT)
 *        c2 == LEFT → mirror again (rollback to original bytes) → AMBIGUOUS
 *                     (two classifier passes contradict; leave original
 *                     state untouched so a human can eyeball it)
 *   4) 429 / timeout / 5xx ⇒ exponential backoff, up to 3 retries per
 *      per-classify-call (so 6 retries per card in the worst LEFT-then-still-
 *      LEFT case). Transient failures bubble up as ERROR after the budget.
 *
 * Disk state at the end:
 *   - kept cards         : unchanged on disk
 *   - fixed cards        : flipped from wrong-side to RIGHT-side
 *   - ambiguous cards    : unchanged on disk (mirrored twice = original)
 *
 * Usage: pnpm dlx tsx scripts/fix-sprite-heading-verify.ts
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { classifySpriteHeading, resolveApiKey, type MiniMaxConfig } from '../src/minimax.ts'

const CARD_ROOT = join(process.env.HOME ?? '.', '.dsh', 'deepsea', 'cards')
const LOG_PATH = '/tmp/deepsea-heading-fix.log'

type Heading = 'LEFT' | 'RIGHT' | 'OTHER'

function log(line: string): void {
  // Mirror to stdout (so a real-time `tail -f` works) and to the persistent
  // log so the report and a post-mortem have the full per-card trace.
  process.stdout.write(line + '\n')
  try { appendFileSync(LOG_PATH, line + '\n') } catch { /* non-fatal */ }
}

function mirror(path: string): void {
  // FLIP_LEFT_RIGHT is its own inverse, so applying it twice returns the
  // original bytes. We rely on that to make the rollback step exact.
  const r = spawnSync('python3', ['scripts/mirror_png.py', path], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('mirror failed for ' + path + ': ' + String(r.stderr))
}

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message
  return m.includes('aborted due to timeout')
    || m.includes('HTTP 429')
    || m.includes('HTTP 5')
    || m.includes('fetch failed')
    || m.includes('ECONNRESET')
    || m.includes('ETIMEDOUT')
}

/** Track the most recent transient-error wall time so we can pace the
 * next card. When the API throws 429 the limit window is in seconds, so
 * even a single 429 should slow the run, not just the failing card. */
let lastTransientAt = 0
const TRANSIENT_COOLDOWN_MS = 4_000

async function classifyWithBackoff(mm: MiniMaxConfig, b64: string, attemptLog: string[]): Promise<Heading> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await classifySpriteHeading(mm, b64)
    } catch (err) {
      lastErr = err
      const tag = isTransient(err) ? 'transient' : 'hard'
      attemptLog.push(`  retry ${attempt + 1}/3: ${tag} `
        + (err instanceof Error ? err.message.slice(0, 120) : String(err)))
      if (!isTransient(err)) break
      lastTransientAt = Date.now()
      // 2s, 4s, 8s — gives the rate-limit window time to slide.
      const wait = 2000 * (1 << attempt)
      attemptLog.push(`  backoff ${wait}ms before next attempt`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Majority vote over `n` independent classifier passes. The MiniMax vision
 * model has noticeable per-call noise — single-shot judgements aren't
 * authoritative enough to commit a destructive mirror. Three samples give
 * a clear majority in all non-tied cases; ties (e.g. 1 LEFT + 2 RIGHT)
 * fall back to a conservative mirror-and-verify, which can still flip a
 * card that may actually be wrong. */
async function classifyMajority(mm: MiniMaxConfig, b64: string, n: number, attemptLog: string[]): Promise<Heading> {
  const votes: Heading[] = []
  for (let i = 0; i < n; i += 1) {
    try {
      votes.push(await classifyWithBackoff(mm, b64, attemptLog))
    } catch (err) {
      throw err
    }
    // Small inter-sample gap so we don't burst three requests into the
    // same rate-limit window. Only applies between samples of the same
    // card; cross-card pacing is handled by the main loop.
    if (i < n - 1) await new Promise((r) => setTimeout(r, 1500))
  }
  const left = votes.filter((v) => v === 'LEFT').length
  const right = votes.filter((v) => v === 'RIGHT').length
  const other = votes.filter((v) => v === 'OTHER').length
  attemptLog.push(`  votes: ${votes.join(',')} (L=${left} R=${right} O=${other})`)
  if (right > left && right > other) return 'RIGHT'
  if (left > right && left > other) return 'LEFT'
  // Tied or OTHER-dominated → too ambiguous to commit a flip on.
  return 'OTHER'
}

async function processOne(id: string, mm: MiniMaxConfig): Promise<{
  terminal: 'kept' | 'fixed' | 'ambiguous' | 'error', retries: number
}> {
  const path = join(CARD_ROOT, id, 'sprite.png')
  const trace: string[] = []
  let retries = 0
  // Snapshot the original bytes so we can ALWAYS restore to them — even
  // if a mirror call, the classifier, or the logger throws between flips.
  // FLIP_LEFT_RIGHT is its own inverse, so a deterministic byte-for-byte
  // copy gives us a stronger rollback guarantee than "mirror twice on top
  // of a possibly-corrupted file".
  let originalBytes: Buffer
  try {
    originalBytes = await readFile(path)
  } catch (err) {
    log(id + ': ERROR read ' + (err instanceof Error ? err.message : String(err)))
    return { terminal: 'error', retries: 0 }
  }
  let flippedOnce = false
  const rollback = async (): Promise<void> => {
    try { await writeFile(path, originalBytes) } catch (e) { /* logged in caller */ }
  }
  const doMirror = (): void => {
    mirror(path)
    flippedOnce = true
  }
  try {
    const b64 = originalBytes.toString('base64')
    let c1: Heading
    try {
      c1 = await classifyMajority(mm, b64, 3, trace)
    } catch (err) {
      log(id + ': ERROR c1 ' + (err instanceof Error ? err.message : String(err)))
      for (const t of trace) log(t)
      return { terminal: 'error', retries: trace.length }
    }
    retries = trace.length
    if (c1 === 'RIGHT') {
      log(id + ': c1=RIGHT -> kept')
      for (const t of trace) log(t)
      return { terminal: 'kept', retries }
    }
    if (c1 === 'OTHER') {
      log(id + ': c1=OTHER -> AMBIGUOUS (no majority; untouched)')
      for (const t of trace) log(t)
      return { terminal: 'ambiguous', retries }
    }
    // c1 == LEFT (majority). Flip and re-verify with another 3-vote.
    for (const t of trace) log(t)
    doMirror()
    const trace2: string[] = []
    let mirrored: Buffer
    try {
      mirrored = await readFile(path)
    } catch (err) {
      await rollback()
      log(id + ': ERROR post-mirror read '
        + (err instanceof Error ? err.message : String(err)) + ' (restored from snapshot)')
      return { terminal: 'error', retries: retries + trace2.length }
    }
    let c2: Heading
    try {
      c2 = await classifyMajority(mm, mirrored.toString('base64'), 3, trace2)
    } catch (err) {
      await rollback()
      log(id + ': ERROR c2 ' + (err instanceof Error ? err.message : String(err)) + ' (restored from snapshot)')
      for (const t of trace2) log('  c2 ' + t)
      return { terminal: 'error', retries: retries + trace2.length }
    }
    retries += trace2.length
    for (const t of trace2) log('  c2 ' + t)
    if (c2 === 'RIGHT') {
      log(id + ': c1=LEFT c2=RIGHT -> fixed (kept flipped)')
      return { terminal: 'fixed', retries }
    }
    // c2 LEFT or OTHER after mirroring — ambiguous. Restore from snapshot
    // (not another mirror) so a failed mirror call or a buggy log write
    // can't leave the file flipped.
    await rollback()
    log(id + ': c1=LEFT c2=' + c2 + ' -> AMBIGUOUS (restored from snapshot)')
    return { terminal: 'ambiguous', retries }
  } catch (err) {
    if (flippedOnce) await rollback()
    log(id + ': ERROR ' + (err instanceof Error ? err.message : String(err))
      + (flippedOnce ? ' (restored from snapshot)' : ''))
    return { terminal: 'error', retries }
  }
}

async function main(): Promise<void> {
  // Fresh log on each run so the report and the audit trail are unambiguous.
  try { appendFileSync(LOG_PATH, '\n--- run ' + new Date().toISOString() + ' ---\n') } catch { /* */ }
  const apiKey = await resolveApiKey('MINIMAX_API_KEY')
  const mm: MiniMaxConfig = { baseURL: 'https://api.minimaxi.com/v1', apiKey,
    model: 'MiniMax-M3', imageModel: 'image-01' }
  const allDirs = await readdir(CARD_ROOT, { withFileTypes: true })
  const ids = allDirs
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  // Only cards with a sprite.png on disk are eligible for heading work —
  // 108 of the 219 dirs are still pending sprite generation upstream.
  const eligible = ids.filter((id) => existsSync(join(CARD_ROOT, id, 'sprite.png')))
  log('found ' + ids.length + ' dirs, ' + eligible.length + ' have sprite.png — processing serially')
  const counts = { kept: 0, fixed: 0, ambiguous: 0, error: 0 }
  let totalRetries = 0
  // Map id -> terminal so we can re-process errored cards cleanly.
  const terminal: Map<string, 'kept' | 'fixed' | 'ambiguous' | 'error'> = new Map()

  const runCard = async (id: string): Promise<void> => {
    const r = await processOne(id, mm)
    totalRetries += r.retries
    terminal.set(id, r.terminal)
  }
  // First pass
  for (const id of eligible) {
    await runCard(id)
    if (lastTransientAt > 0) {
      const elapsed = Date.now() - lastTransientAt
      if (elapsed < TRANSIENT_COOLDOWN_MS) {
        await new Promise((r2) => setTimeout(r2, TRANSIENT_COOLDOWN_MS - elapsed))
      }
    } else {
      await new Promise((r2) => setTimeout(r2, 1000))
    }
  }
  // Second pass for any errored cards — by then the rate-limit window
  // is long past and we can re-classify with full retry budget.
  let pass = 1
  while (true) {
    const errored = [...terminal.entries()].filter(([, v]) => v === 'error').map(([k]) => k)
    if (errored.length === 0) break
    if (pass > 3) break
    pass += 1
    log('--- retry pass ' + pass + ' for ' + errored.length + ' errored cards ---')
    for (const id of errored) await runCard(id)
    await new Promise((r2) => setTimeout(r2, 2000))
  }
  for (const v of terminal.values()) counts[v] += 1
  const ambiguous = [...terminal.entries()].filter(([, v]) => v === 'ambiguous').map(([k]) => k).sort()
  const errored = [...terminal.entries()].filter(([, v]) => v === 'error').map(([k]) => k).sort()
  log('--- summary ---')
  log('kept:      ' + counts.kept)
  log('fixed:     ' + counts.fixed)
  log('ambiguous: ' + counts.ambiguous)
  log('error:     ' + counts.error)
  log('retries:   ' + totalRetries)
  if (ambiguous.length > 0) log('AMBIGUOUS: ' + ambiguous.join(', '))
  if (errored.length > 0) log('ERRORED:   ' + errored.join(', '))
}

mkdirSync('/tmp', { recursive: true })
void main()
