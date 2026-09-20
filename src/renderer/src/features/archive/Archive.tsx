// 对局档案：本地库里的对局列表。一行 = 一局，点开进复盘。
// 列：时间 / 地图 / 模式 / 账号 / 胜负 / ELO / 龙区分
import { useCallback, useEffect, useState } from 'react'
import type { ArchiveItem } from '@shared/ipc'
import { scoreColor } from '../current/PlayerRow'
import './archive.css'

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** ELO：2219 → 2213（-6.7）。涨了绿、掉了红，没有就 — */
function Elo({ mine }: { mine: ArchiveItem['mine'] }): React.JSX.Element {
  const before = mine?.eloBefore ?? null
  const after = mine?.eloAfter ?? null
  if (before == null || after == null) return <span className="dim">—</span>
  const d = after - before
  const color = d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'var(--dim)'
  return (
    <span className="elo">
      <span className="dim">{Math.round(before)}</span>
      <span className="elo-arrow dim">→</span>
      <span>{Math.round(after)}</span>
      <span className="elo-delta" style={{ color }}>
        （{d > 0 ? '+' : ''}
        {d.toFixed(1)}）
      </span>
    </span>
  )
}

export default function Archive({ onOpen }: { onOpen: (fid: string) => void }): React.JSX.Element {
  const [list, setList] = useState<ArchiveItem[] | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setList(await window.BA.listArchive())
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return (
    <div className="card">
      <h2>
        对局档案
        {!!list?.length && <span className="dim">{list.length} 局</span>}
        <span className="grow" />
        {busy && <span className="spin" />}
        <button disabled={busy} onClick={() => void reload()}>
          刷新
        </button>
      </h2>

      {!list?.length ? (
        <div className="empty">还没有对局。打完一局，或者在上面点「上一局复盘」。</div>
      ) : (
        <div className="archive-wrap archive-scroll">
          <table className="t archive-t">
            <thead>
              <tr>
                <th>时间</th>
                <th>地图</th>
                <th>模式</th>
                <th>账号</th>
                <th>胜负</th>
                <th>ELO</th>
                <th>龙区分</th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const won = m.mine?.won
                return (
                  <tr key={m.fid} onClick={() => onOpen(m.fid)} title="点开看这局复盘">
                    <td className="archive-time">{fmtTime(m.startTime)}</td>
                    <td className="archive-map" title={m.map || undefined}>
                      {m.map || '—'}
                    </td>
                    <td className={m.mode === '未知' ? 'dim' : undefined}>{m.mode}</td>
                    <td className="archive-account" title={m.mine?.account || undefined}>
                      {m.mine?.account || <span className="dim">—</span>}
                    </td>
                    <td style={{ color: won ? 'var(--good)' : won === false ? 'var(--bad)' : undefined }}>
                      {won ? '胜' : won === false ? '负' : <span className="dim">—</span>}
                    </td>
                    <td className="archive-elo">
                      <Elo mine={m.mine} />
                    </td>
                    <td style={{ color: scoreColor(m.mine?.score) }}>
                      {m.mine?.score != null ? m.mine.score.toFixed(1) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
