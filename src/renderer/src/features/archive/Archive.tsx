// 对局档案：本地库里的对局列表。一行 = 一局，点开进复盘。
// 顶上一排近期汇总（只用本地库里已有的数据，不发请求），下面可按模式、胜负、地图筛选。
// 每行左边的色条表示这局你在 A 队（蓝）还是 B 队（红）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconChartBar, IconPlayerPlay, IconRefresh, IconSearch } from '@tabler/icons-react'
import type { ArchiveItem } from '@shared/ipc'
import { scoreColor } from '../../components/scoreColor'
import Pager, { pageSlice } from '../../components/Pager'
import PageBar from '../../components/PageBar'
import Ico from '../../components/Icon'
import Mark from '../../components/Mark'
import { TITLE_NAME, titleCls } from '../../components/titleNames'
import { useStore } from '../../store'
import './archive.css'

const PAGE_SIZE = 30
/** 汇总看最近多少局 */
const RECENT = 20

/** 时长：38:24 这样；不到一分钟就只写秒 */
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? m + ':' + String(s).padStart(2, '0') : s + '秒'
}

/** 今天的只给时分（22:49），别的日子前面补个日期（09/19 22:49） */
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

/** ELO：2213 +6.7。涨了绿、掉了灰（不用红色，红色是 B 队） */
function Elo({ mine }: { mine: ArchiveItem['mine'] }): React.JSX.Element {
  const before = mine?.eloBefore ?? null
  const after = mine?.eloAfter ?? null
  if (before == null || after == null) return <span className="faint">—</span>
  const d = after - before
  return (
    <span className="elo">
      {Math.round(after)}
      <span className={'elo-delta ' + (d > 0 ? 'pos' : d < 0 ? 'neg' : '')}>
        {(d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d).toFixed(1)}
      </span>
    </span>
  )
}

type ModeF = 'all' | 'rated' | 'custom'
type ResF = 'all' | 'win' | 'loss'

export default function Archive({ onOpen }: { onOpen: (fid: string) => void }): React.JSX.Element {
  const { setPlayReplay, setPage: go } = useStore()
  const [list, setList] = useState<ArchiveItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [mode, setMode] = useState<ModeF>('all')
  const [res, setRes] = useState<ResF>('all')
  const [q, setQ] = useState('')
  /** fid → 录像 id：有录像的那几局可以直接播 */
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

  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    return (list || []).filter((m) => {
      if (mode === 'rated' && m.mode !== '排位') return false
      if (mode === 'custom' && m.mode !== '自定义') return false
      if (res === 'win' && m.mine?.won !== true) return false
      if (res === 'loss' && m.mine?.won !== false) return false
      if (text && !(m.map || '').toLowerCase().includes(text) && !(m.mine?.account || '').toLowerCase().includes(text))
        return false
      return true
    })
  }, [list, mode, res, q])

  // 筛选条件变了回到第一页
  useEffect(() => setPage(0), [mode, res, q])

  const { items: shown, page: cur } = pageSlice(filtered, page, PAGE_SIZE)

  return (
    <>
      <PageBar title="对局档案">
        {!!list?.length && (
          <span className="m">
            共 <b>{list.length}</b> 局
          </span>
        )}
        <span className="grow" />
        {busy && <span className="spin" />}
        <button disabled={busy} onClick={() => void reload()}>
          <Ico i={IconRefresh} />
          刷新
        </button>
      </PageBar>
      <div className="page">
        {!list?.length ? (
          <div className="empty">暂无对局记录。对局结束后会自动添加。</div>
        ) : (
          <>
            <Summary list={list} />
            <div className="ar-filters">
              <span className="seg">
                {(
                  [
                    ['all', '全部'],
                    ['rated', '排位'],
                    ['custom', '自定义']
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={mode === k ? 'active' : ''} onClick={() => setMode(k)}>
                    {label}
                  </button>
                ))}
              </span>
              <span className="seg">
                {(
                  [
                    ['all', '全部'],
                    ['win', '胜'],
                    ['loss', '负']
                  ] as const
                ).map(([k, label]) => (
                  <button key={k} className={res === k ? 'active' : ''} onClick={() => setRes(k)}>
                    {label}
                  </button>
                ))}
              </span>
              <label className="ar-search">
                <Ico i={IconSearch} />
                <input value={q} placeholder="地图或账号" onChange={(e) => setQ(e.target.value)} />
              </label>
              <span className="grow" />
              {filtered.length !== list.length && <span className="faint mono">筛出 {filtered.length} 局</span>}
            </div>
            <div className="card flush">
              <table className="t archive-t">
                <thead>
                  <tr>
                    <th>胜负</th>
                    <th>本局</th>
                    <th>地图</th>
                    <th>模式</th>
                    <th>队伍</th>
                    <th>ELO</th>
                    <th>称号</th>
                    <th>账号</th>
                    <th>时间</th>
                    <th title="对局时长，与 BATrace 的 TotalPlayTimeInSec 一致">时长</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const won = m.mine?.won
                    const rid = replays[m.fid]
                    const team = m.mine?.team
                    return (
                      <tr
                        key={m.fid}
                        className={team === 0 ? 'ea' : team === 1 ? 'eb' : undefined}
                        onClick={() => onOpen(m.fid)}
                        title="查看本局复盘"
                      >
                        <td>
                          {won == null ? (
                            <span className="faint">—</span>
                          ) : (
                            <span className={won ? 'res-win' : 'res-loss'}>{won ? '胜' : '负'}</span>
                          )}
                        </td>
                        <td>
                          {m.mine?.score != null ? (
                            <span className="ar-score">
                              <Mark tier={m.mine.mark} />
                              <span style={{ color: scoreColor(m.mine.score, m.mine.mark) }}>
                                {m.mine.score.toFixed(1)}
                              </span>
                            </span>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="archive-map" title={m.map || undefined}>
                          {m.map || '—'}
                        </td>
                        <td className="ar-text dim">{m.mode}</td>
                        <td className={'ar-text ' + (team === 0 ? 't0' : team === 1 ? 't1' : 'faint')}>
                          {team === 0 ? 'A 队' : team === 1 ? 'B 队' : '—'}
                        </td>
                        <td>
                          <Elo mine={m.mine} />
                        </td>
                        <td className="ar-text">
                          {(m.mine?.titles || []).map((t) => (
                            <span key={t} className={titleCls(t)}>
                              {TITLE_NAME[t] || t}
                            </span>
                          ))}
                        </td>
                        <td className="archive-account" title={m.mine?.account || undefined}>
                          {m.mine?.account || <span className="faint">—</span>}
                        </td>
                        <td className="dim">{fmtTime(m.startTime)}</td>
                        <td>{fmtDur(m.durationSec)}</td>
                        <td className="ar-acts">
                          <button
                            title="查看本局复盘"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpen(m.fid)
                            }}
                          >
                            <Ico i={IconChartBar} />
                            复盘
                          </button>
                          <button
                            className="archive-play-btn"
                            title={rid ? '播放本局录像' : '这一局没有录像'}
                            aria-label="播放本局录像"
                            disabled={!rid}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!rid) return
                              setPlayReplay(rid)
                              go({ name: 'replays' })
                            }}
                          >
                            <Ico i={IconPlayerPlay} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!shown.length && (
                    <tr>
                      <td colSpan={11} className="empty">
                        没有符合条件的对局。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager page={cur} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
          </>
        )}
      </div>
    </>
  )
}

/** 近期汇总：只看有「我这局」数据的对局（知道本机账号、库里算过的） */
function Summary({ list }: { list: ArchiveItem[] }): React.JSX.Element | null {
  const mine = list.filter((m) => m.mine)
  if (!mine.length) return null
  // list 是按时间倒序的：前面的是最近的
  const recent = mine.filter((m) => m.mine?.won != null).slice(0, RECENT)
  const wins = recent.filter((m) => m.mine?.won).length
  const scored = mine.filter((m) => m.mine?.score != null).slice(0, RECENT)
  const avg = scored.length ? scored.reduce((a, m) => a + (m.mine?.score as number), 0) / scored.length : null
  const rated = mine.filter((m) => m.mine?.eloAfter != null && m.mine?.eloBefore != null)
  const eloNow = rated[0]?.mine?.eloAfter ?? null
  const eloDelta = rated
    .slice(0, RECENT)
    .reduce((a, m) => a + ((m.mine?.eloAfter as number) - (m.mine?.eloBefore as number)), 0)
  const marks = { dragon: 0, min: 0, qu: 0 }
  const titles: Record<string, number> = {}
  for (const m of mine) {
    const k = m.mine?.mark as keyof typeof marks
    if (k in marks) marks[k]++
    for (const t of m.mine?.titles || []) titles[t] = (titles[t] || 0) + 1
  }
  const topTitles = Object.entries(titles)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)

  return (
    <div className="ar-stats">
      <div>
        <span>近 {recent.length} 局胜率</span>
        <b>{recent.length ? Math.round((wins / recent.length) * 100) + '%' : '—'}</b>
        {/* 胜负走势：从左（早）到右（近），胜的高、负的矮 */}
        <div className="ar-spark" title={recent.map((m) => (m.mine?.won ? '胜' : '负')).reverse().join(' ')}>
          {[...recent].reverse().map((m) => (
            <i key={m.fid} className={m.mine?.won ? 'w' : 'l'} />
          ))}
        </div>
      </div>
      <div>
        <span>近 {scored.length} 局平均单局分</span>
        <b>{avg == null ? '—' : avg.toFixed(1)}</b>
        <small>每局的龙蛆分取平均</small>
      </div>
      <div>
        <span>当前 ELO</span>
        <b>{eloNow == null ? '—' : Math.round(eloNow)}</b>
        {rated.length > 0 && (
          <small className={eloDelta > 0 ? 'pos' : eloDelta < 0 ? 'neg' : ''}>
            近 {Math.min(RECENT, rated.length)} 局 {(eloDelta > 0 ? '+' : eloDelta < 0 ? '−' : '') + Math.abs(eloDelta).toFixed(1)}
          </small>
        )}
      </div>
      <div>
        <span>本局标记</span>
        <div className="ar-marks">
          <Mark tier="dragon" />
          <em>{marks.dragon}</em>
          <Mark tier="min" />
          <em>{marks.min}</em>
          <Mark tier="qu" />
          <em>{marks.qu}</em>
        </div>
      </div>
      <div>
        <span>最常拿的称号</span>
        <div className="ar-marks">
          {topTitles.length ? (
            topTitles.map(([t, n]) => (
              <span key={t}>
                <span className={titleCls(t)}>{TITLE_NAME[t] || t}</span>
                <em>×{n}</em>
              </span>
            ))
          ) : (
            <span className="faint">—</span>
          )}
        </div>
      </div>
    </div>
  )
}
