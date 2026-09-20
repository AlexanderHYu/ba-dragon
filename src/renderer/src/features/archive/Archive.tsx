// 对局档案：本地库里算过的对局 + 本次会话打完还没算的。点一条开复盘。
import { useEffect, useState } from 'react'
import type { ArchiveItem } from '@shared/ipc'
import { scoreColor } from '../current/PlayerRow'

export default function Archive({ onOpen }: { onOpen: (fid: string) => void }): React.JSX.Element {
  const [list, setList] = useState<ArchiveItem[] | null>(null)
  useEffect(() => {
    void window.BA.listArchive().then(setList)
  }, [])

  return (
    <div className="card">
      <h2>
        对局档案
        <span className="grow" />
        <button onClick={() => void window.BA.listArchive().then(setList)}>刷新</button>
      </h2>
      {!list?.length ? (
        <div className="empty">还没有对局。打完一局，或者在上面点「上一局复盘」。</div>
      ) : (
        <table className="t">
          <thead>
            <tr>
              <th>时间</th>
              <th>地图</th>
              <th>时长</th>
              <th>我这局</th>
              <th>龙区分</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((m) => (
              <tr key={m.fid} style={{ cursor: 'pointer' }} onClick={() => onOpen(m.fid)}>
                <td>{m.startTime ? new Date(m.startTime).toLocaleString('zh-CN') : '—'}</td>
                <td>{m.map || '—'}</td>
                <td>{m.durationSec ? Math.round(m.durationSec / 60) + ' 分钟' : '—'}</td>
                <td style={{ color: m.mine?.won ? 'var(--good)' : m.mine?.won === false ? 'var(--bad)' : undefined }}>
                  {m.mine ? (m.mine.won ? '胜' : m.mine.won === false ? '负' : '—') : '—'}
                </td>
                <td style={{ color: scoreColor(m.mine?.score) }}>
                  {m.mine?.score != null ? m.mine.score.toFixed(1) : '—'}
                </td>
                <td className="dim">{m.cached ? '已算' : '点开算'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
