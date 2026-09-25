// 对局档案：本地库里的对局列表。一行 = 一局，点开进复盘。
// 列：胜负 / 模式 / 龙区分 / 地图 / ELO / 账号 / 时间（+ 有录像的那局末尾一个 ▶）
import { useCallback, useEffect, useState } from 'react'
import type { ArchiveItem } from '@shared/ipc'
import { scoreColor } from '../current/PlayerRow'
import Pager, { pageSlice } from '../../components/Pager'
import { useStore } from '../../store'
import './archive.css'

const PAGE_SIZE = 30

/** 今天的只给时分（22:49），别的日子前面补个日期（09/19 22:49） */
/** 时长：38:24 这样；不到一分钟就只写秒 */
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? m + ':' + String(s).padStart(2, '0') : s + '秒'
}

function fmtTime(ms: number | null): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  const hm = p(d.getHours()) + ':' + p(d.getMinutes())
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + hm
}

/** 模式标签：排位走强调色、自定义走警告色（和老版 .mode-tag 一致），未知就灰着 */
function Mode({ mode }: { mode: ArchiveItem['mode'] }): React.JSX.Element {
  if (mode === '排位') return <span className="mode-tag ranked">🏆 排位</span>
  if (mode === '自定义') return <span className="mode-tag custom">🎮 自定义</span>
  return <span className="mode-tag">未知</span>
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
  const setPlayReplay = useStore((s) => s.setPlayReplay)
  const [list, setList] = useState<ArchiveItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  /** fid → 录像 id：有录像的那几局末尾显示 ▶ */
  const [replays, setReplays] = useState<Record<string, string>>({})

  const reload = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      setList(await window.BA.listArchive())
    } finally {
      setBusy(false)
    }
  }, [])

  const reloadReplays = useCallback((): void => {
    void window.BA.listReplays().then((rs) => {
      const m: Record<string, string> = {}
      // 同一局可能有多个视角，取最新的那条
      for (const r of rs) if (r.fid) m[r.fid] = r.id
      setReplays(m)
    })
  }, [])

  useEffect(() => {
    void reload()
    reloadReplays()
    const offReplay = window.BA.on('replay:changed', reloadReplays)
    const offArchive = window.BA.on('archive:changed', () => void reload())
    return () => {
      offReplay()
      offArchive()
    }
  }, [reload, reloadReplays])

  const { items: shown, page: cur } = pageSlice(list || [], page, PAGE_SIZE)

  return (
    <div className="card">
      <h2>
        <span className="ico">🗂</span>
        对局档案
        {!!list?.length && <span className="dim">{list.length} 局</span>}
        <span className="grow" />
        {busy && <span className="spin" />}
        <button disabled={busy} onClick={() => void reload()}>
          ↻ 刷新
        </button>
      </h2>

      {!list?.length ? (
        <div className="empty">还没有对局。打完一局就会出现在这里。</div>
      ) : (
        <div className="archive-wrap">
          <table className="t archive-t">
            <thead>
              <tr>
                <th>胜负</th>
                <th>模式</th>
                <th>龙区分</th>
                <th>地图</th>
                <th>ELO</th>
                <th>账号</th>
                <th>时间</th>
                <th className="num" title="这一局打了多久。和 BATrace 的 TotalPlayTimeInSec 逐条核对过，完全一致">
                  时长
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const won = m.mine?.won
                const rid = replays[m.fid]
                return (
                  <tr key={m.fid} onClick={() => onOpen(m.fid)} title="点开看这局复盘">
                    <td style={{ color: won ? 'var(--good)' : won === false ? 'var(--bad)' : undefined }}>
                      {won ? '胜' : won === false ? '负' : <span className="dim">—</span>}
                    </td>
                    <td className="archive-mode">
                      <Mode mode={m.mode} />
                    </td>
                    <td style={{ color: scoreColor(m.mine?.score) }}>
                      {m.mine?.score != null ? m.mine.score.toFixed(1) : '—'}
                    </td>
                    <td className="archive-map" title={m.map || undefined}>
                      {m.map || '—'}
                    </td>
                    <td className="archive-elo">
                      <Elo mine={m.mine} />
                    </td>
                    <td className="archive-account" title={m.mine?.account || undefined}>
                      {m.mine?.account || <span className="dim">—</span>}
                    </td>
                    <td className="archive-time">{fmtTime(m.startTime)}</td>
                    <td className="archive-dur num">{fmtDur(m.durationSec)}</td>
                    <td className="archive-play">
                      {rid && (
                        <button
                          className="archive-play-btn"
                          title="播放这局录像"
                          onClick={(e) => {
                            e.stopPropagation()
                            setPlayReplay(rid)
                          }}
                        >
                          ▶
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager page={cur} pageSize={PAGE_SIZE} total={list.length} onPage={setPage} />
        </div>
      )}
    </div>
  )
}
