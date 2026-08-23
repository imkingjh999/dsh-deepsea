/**
 * Anchor the deepsea chain tip to an external, owner-uncontrolled witness:
 * appends {height, hash, anchoredAt} to anchors.jsonl in the public GitHub
 * repo imkingjh999/deepsea-chain and pushes. Any later full-chain rewrite
 * breaks the match between the live chain and these anchored hashes, so
 * history before the anchor becomes tamper-evident even against the DB
 * owner. Run: pnpm dlx tsx scripts/anchor-tip.ts
 */
import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

const NL = String.fromCharCode(10)

const WORKER = 'https://deepsea.openclawd.qzz.io'
const REPO_DIR = join(homedir(), 'projects', 'dsh-plugins', 'deepsea-chain')
const REMOTE = 'git@github.com:imkingjh999/deepsea-chain.git'

async function main(): Promise<void> {
  const res = await fetch(WORKER + '/api/pool/stats')
  if (!res.ok) throw new Error('pool stats HTTP ' + res.status)
  const raw = await res.text()
  let data: { ok: boolean, value?: { tip?: { height: number, hash: string } } }
  try {
    data = JSON.parse(raw) as { ok: boolean, value?: { tip?: { height: number, hash: string } } }
  } catch {
    throw new Error('pool stats non-JSON (HTTP ' + res.status + ')')
  }
  const tip = data.value?.tip
  if (tip === undefined) throw new Error('no chain tip')
  await mkdir(REPO_DIR, { recursive: true })
  const anchorsPath = join(REPO_DIR, 'anchors.jsonl')
  let existing = ''
  try { existing = await readFile(anchorsPath, 'utf8') } catch { existing = '' }
  if (existing.includes('height":' + tip.height + ',')) {
    process.stdout.write('height ' + tip.height + ' already anchored' + NL)
    return
  }
  const line = JSON.stringify({ height: tip.height, hash: tip.hash, anchoredAt: new Date().toISOString() })
  await appendFile(anchorsPath, line + NL)
  const run = (cmd: string, args: string[]): void => {
    execFileSync(cmd, args, { cwd: REPO_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  try { run('git', ['rev-parse', '--is-inside-work-tree']) } catch {
    run('git', ['init'])
    run('git', ['remote', 'add', 'origin', REMOTE])
  }
  run('git', ['add', 'anchors.jsonl'])
  run('git', ['-c', 'user.name=deepsea-anchor', '-c', 'user.email=anchor@deepsea.local',
    'commit', '-m', 'anchor height ' + tip.height])
  run('git', ['push', '-u', 'origin', 'HEAD:main'])
  process.stdout.write('anchored height ' + tip.height + ' hash ' + tip.hash.slice(0, 16) + NL)
}

void main()
