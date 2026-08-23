/**
 * Leaderboard — the GLOBAL diver ranking (全球排行榜), served by the
 * Worker from the shared D1 database. Rows are divers worldwide ranked by
 * total catches; the local diver (matched by public key) is highlighted.
 * Opened from the card wall header; the ocean stays frozen behind it
 * (pausedRef covers it via the overlay state in ocean.tsx).
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { fetchLeaders, fetchMe, type LeaderRow } from './api.ts'
import { tr, isEn } from './locale.ts'
import { rarityMeta } from './depth.ts'

/** Short stable identity tag for a diver: first 4 + last 4 of the key. */
function tagOf(publicKey: string): string {
  if (publicKey.length <= 8) return publicKey
  return publicKey.slice(0, 4) + '…' + publicKey.slice(-4)
}

const RAREST_ORDER = ['LEGENDARY', 'EPIC', 'RARE', 'COMMON']

function rarestLabel(rarity: string): string {
  const meta = RAREST_ORDER.includes(rarity) ? rarityMeta(rarity) : rarityMeta('COMMON')
  return isEn() ? meta.en : meta.zh
}

const btn = {
  background: 'rgba(10,24,46,.85)', border: '1px solid #2a5484', color: '#bfe2ff',
  borderRadius: 8, fontSize: 11, padding: '4px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
}

export function Leaderboard(props: { onClose: () => void }): ReactNode {
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [me, setMe] = useState('')
  const [failed, setFailed] = useState(false)

  const load = (): void => {
    setRows(null); setFailed(false)
    void Promise.all([fetchLeaders(50), fetchMe()]).then(([leaders, myKey]) => {
      if (leaders.length === 0) setFailed(true)
      setRows(leaders); setMe(myKey)
    }).catch(() => setFailed(true))
  }

  useEffect(load, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') props.onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [props])

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 6,
      background: '#01030a',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* v49.1: same chrome metrics as the ocean/wall/pond strips so the
       * top bar does not shift when the rank overlay swaps in. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', minHeight: 36 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#cfe6ff', flex: 1, whiteSpace: 'nowrap' }}>
          🏆 {tr('rank.title')}
        </span>
        <button type="button" aria-label="deepsea-rank-refresh" onClick={load} style={btn}>
          ↻ {tr('rank.refresh')}
        </button>
        <button type="button" onClick={props.onClose} style={btn}>✕ {tr('rank.close')}</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 14px 14px' }}>
        {rows === null && !failed && (
          <div style={{ margin: 'auto', color: '#5f7c9e', fontSize: 13 }}>{tr('rank.loading')}</div>
        )}
        {failed && (
          <div style={{ margin: 'auto', color: '#5f7c9e', fontSize: 13 }}>{tr('rank.empty')}</div>
        )}
        {rows !== null && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, color: '#c6d9ee' }}>
            <thead>
              <tr style={{ color: '#7fa6cf', textAlign: 'left' }}>
                <th style={{ padding: '5px 6px', fontWeight: 600 }}>#</th>
                <th style={{ padding: '5px 6px', fontWeight: 600 }}>{tr('rank.diver')}</th>
                <th style={{ padding: '5px 6px', fontWeight: 600, textAlign: 'right' }}>{tr('rank.catches')}</th>
                <th style={{ padding: '5px 6px', fontWeight: 600, textAlign: 'right',
                  color: rarityMeta('RARE').color }}>
                  {isEn() ? rarityMeta('RARE').en : rarityMeta('RARE').zh}
                </th>
                <th style={{ padding: '5px 6px', fontWeight: 600, textAlign: 'right',
                  color: rarityMeta('EPIC').color }}>
                  {isEn() ? rarityMeta('EPIC').en : rarityMeta('EPIC').zh}
                </th>
                <th style={{ padding: '5px 6px', fontWeight: 600, textAlign: 'right',
                  color: rarityMeta('LEGENDARY').color }}>
                  {isEn() ? rarityMeta('LEGENDARY').en : rarityMeta('LEGENDARY').zh}
                </th>
                <th style={{ padding: '5px 6px', fontWeight: 600 }}>{tr('rank.rarest')}</th>
                <th style={{ padding: '5px 6px', fontWeight: 600, textAlign: 'right' }}>{tr('rank.deepest')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const mine = row.public_key === me && me !== ''
                const meta = RAREST_ORDER.includes(row.rarest) ? rarityMeta(row.rarest) : rarityMeta('COMMON')
                return (
                  <tr
                    key={row.public_key}
                    style={{
                      background: mine ? 'rgba(61,158,255,.14)' : i % 2 === 0 ? 'rgba(16,34,60,.45)' : 'transparent',
                      outline: mine ? '1px solid rgba(61,158,255,.5)' : 'none',
                    }}
                  >
                    <td style={{ padding: '5px 6px', color: '#7fa6cf' }}>{String(i + 1)}</td>
                    <td style={{ padding: '5px 6px', fontFamily: 'monospace' }}>
                      {tagOf(row.public_key)}{mine ? ` · ${tr('rank.me')}` : ''}
                    </td>
                    <td style={{ padding: '5px 6px', fontWeight: 700, textAlign: 'right' }}>
                      {String(row.total_catches)}
                    </td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: rarityMeta('RARE').color }}>
                      {row.rare_count !== undefined ? String(row.rare_count) : '—'}
                    </td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: rarityMeta('EPIC').color }}>
                      {row.epic_count !== undefined ? String(row.epic_count) : '—'}
                    </td>
                    <td style={{ padding: '5px 6px', textAlign: 'right', color: rarityMeta('LEGENDARY').color }}>
                      {row.legendary_count !== undefined ? String(row.legendary_count) : '—'}
                    </td>
                    <td style={{ padding: '5px 6px', color: meta.color }}>{isEn() ? meta.en : meta.zh}</td>
                    <td style={{ padding: '5px 6px', color: '#7fa6cf', textAlign: 'right' }}>
                      {(row.deepest * 100).toFixed(0)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
