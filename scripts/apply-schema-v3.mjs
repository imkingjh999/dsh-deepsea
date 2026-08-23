// Apply schema-v3.sql statement-by-statement via wrangler --command
// (the --file import path rejects this script's mixed DDL/DML batch).
import { readFile } from 'node:fs/promises'
const NL = String.fromCharCode(10)
import { execFileSync } from 'node:child_process'
const sql = await readFile(new URL('../cloudflare/schema-v3.sql', import.meta.url), 'utf8')
// strip comments, split on ; at line ends
const clean = sql.split(String.fromCharCode(10))
  .filter((l) => !l.trim().startsWith('--'))
  .join(String.fromCharCode(10))
const stmts = clean.split(';').map((s) => s.trim()).filter((s) => s.length > 0)
process.stdout.write('statements: ' + stmts.length + NL)
for (const stmt of stmts) {
  const head = stmt.slice(0, 60).replace(/["\\`$]/g, ' ')
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'deepsea-leaderboard', '--remote', '-y',
      '--command', stmt],
        { cwd: new URL('../cloudflare', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] })
    process.stdout.write('OK ' + head + NL)
  } catch (err) {
    process.stdout.write('FAIL ' + head + NL)
    process.stdout.write(String(err.stderr ?? err.message).slice(0, 300) + NL)
    process.exitCode = 1
    break
  }
}
