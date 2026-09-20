// 行车记录仪：开关、录哪块屏、画质，以及本地录像列表。
// 录制是自动的——进对局开录，打完合成存盘，这里只管设置和查看。
import { useEffect, useState } from 'react'
import Pager, { pageSlice } from '../../components/Pager'
import Switch from '../../components/Switch'
import type { DisplayChoice, ReplayItem } from '@shared/ipc'
import { useStore } from '../../store'
import Player from './Player'
import './replay.css'

const QUALITIES: [number, string][] = [
  [0, '原生'],
  [720, '720p'],
  [1080, '1080p'],
  [1440, '1440p']
]
const size = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB')

export default function Replays(): React.JSX.Element {
  const { config, setConfig } = useStore()
  const [status, setStatus] = useState<{ active: boolean; current: { map: string; startedAt: number; sourceId: string } | null; error?: string } | null>(null)
  const [list, setList] = useState<ReplayItem[]>([])
  const [displays, setDisplays] = useState<DisplayChoice[]>([])
  const [encoders, setEncoders] = useState<string[] | null>(null)
  const [showLog, setShowLog] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  /** 正在播的那一条（点列表某一行就在卡片里开播放器） */
  const [playing, setPlaying] = useState<ReplayItem | null>(null)
  const [page, setPage] = useState(0)

  const { items: shown, page: cur } = pageSlice(list, page, 5)

  const reload = (): void => {
    void window.BA.listReplays().then((l) => {
      setList(l)
      // 文件被清理/删掉了就把播放器收起来，别留着一个放不出来的黑框
      setPlaying((p) => (p && l.some((r) => r.id === p.id) ? p : null))
    })
    void window.BA.getReplayStatus().then(setStatus)
  }
  useEffect(() => {
    reload()
    void window.BA.listDisplays().then(setDisplays)
    const offStatus = window.BA.on('replay:status', setStatus)
    const offChanged = window.BA.on('replay:changed', reload)
    return () => {
      offStatus()
      offChanged()
    }
  }, [])

  const patch = async (p: Record<string, unknown>): Promise<void> => setConfig(await window.BA.setConfig(p))
  if (!config) return <div className="card" />
  const on = !!config.replayEnabled

  return (
    <div className="card">
      <h2>
        <span className="ico">🚗</span>
        行车记录仪
        {status?.active && <span className="lit-bad">● 正在录</span>}
        <span className="grow" />
        <Switch checked={on} onChange={(v) => void patch({ replayEnabled: v })} label="开启" />
        <button onClick={() => void window.BA.openReplayFolder()}>打开文件夹</button>
      </h2>

      {status?.error && <div className="lit-bad" style={{ marginBottom: 8 }}>{status.error}</div>}
      {status?.active && status.current && (
        <div className="dim" style={{ marginBottom: 8 }}>
          {status.current.map || '本局'} · 已录 {Math.round((Date.now() - status.current.startedAt) / 1000)} 秒 ·{' '}
          {status.current.sourceId}
        </div>
      )}

      {on && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <div className="row">
            <span style={{ width: 90 }}>录哪块屏</span>
            <select
              value={String(config.replayDisplayId || '')}
              onChange={(e) => void patch({ replayDisplayId: e.target.value })}
            >
              <option value="">自动（主屏）</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.primary ? '（主屏）' : ''}
                  {d.capturable ? '' : '（显卡直采探测不到）'}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span style={{ width: 90 }}>画质</span>
            <select value={Number(config.replayQuality)} onChange={(e) => void patch({ replayQuality: Number(e.target.value) })}>
              {QUALITIES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
            <select value={Number(config.replayFps)} onChange={(e) => void patch({ replayFps: Number(e.target.value) })}>
              {[30, 45, 60].map((f) => (
                <option key={f} value={f}>
                  {f} 帧
                </option>
              ))}
            </select>
            <input
              type="number"
              min={3}
              max={40}
              value={Number(config.replayBitrateMbps)}
              onChange={(e) => void patch({ replayBitrateMbps: Number(e.target.value) })}
              style={{ width: 70 }}
            />
            <span className="dim">Mbps</span>
          </div>
          <div className="row">
            <span style={{ width: 90 }}>曝光</span>
            <input
              type="range"
              min={-2}
              max={2}
              step={0.25}
              value={Number(config.replayExposure)}
              onChange={(e) => void patch({ replayExposure: Number(e.target.value) })}
            />
            <span className="dim">
              {Number(config.replayExposure) > 0 ? '+' : ''}
              {Number(config.replayExposure)} EV（HDR 屏录出来偏暗/过曝时调）
            </span>
          </div>
          <div className="row">
            <span style={{ width: 90 }}>声音</span>
            <select value={String(config.replayAudio)} onChange={(e) => void patch({ replayAudio: e.target.value })}>
              <option value="default">录系统声音</option>
              <option value="off">不录声音</option>
            </select>
            <span className="grow" />
            <button
              onClick={async () => {
                setEncoders(null)
                setEncoders(await window.BA.listEncoders())
              }}
            >
              检测编码器
            </button>
            {encoders && <span className="dim">{encoders.join('、') || '只有软件编码'}</span>}
          </div>
        </div>
      )}

      {playing && <Player key={playing.id} item={playing} onClose={() => setPlaying(null)} />}

      <table className="t">
        <thead>
          <tr>
            <th>时间</th>
            <th>地图</th>
            <th>大小</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr
              key={r.id}
              className={'replay-row' + (playing?.id === r.id ? ' active' : '')}
              title="点一下在这里播放"
              onClick={() => setPlaying((p) => (p?.id === r.id ? null : r))}
            >
              <td>{new Date(r.createdAt).toLocaleString('zh-CN')}</td>
              <td>{r.map || '—'}</td>
              <td>{size(r.size)}</td>
              <td>
                <button
                  className="danger"
                  onClick={async (e) => {
                    e.stopPropagation()
                    await window.BA.deleteReplay(r.id)
                    reload()
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
          {!list.length && (
            <tr>
              <td colSpan={4} className="dim">
                {on ? '还没有录像。进一局游戏就会自动开录。' : '没开。开了之后每局自动录。'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Pager page={cur} pageSize={5} total={list.length} onPage={setPage} />

      <div className="row" style={{ marginTop: 8 }}>
        <button
          onClick={async () => {
            setShowLog(!showLog)
            if (!showLog) setLogs(await window.BA.getReplayLogs())
          }}
        >
          {showLog ? '收起日志' : '录制日志'}
        </button>
        {!!list.length && (
          <button
            onClick={async () => {
              const n = await window.BA.cleanReplays(30)
              setLogs((l) => [...l, '清理了 ' + n + ' 个 30 天前的录像'])
              reload()
            }}
          >
            清理 30 天前
          </button>
        )}
      </div>
      {showLog && (
        <pre className="log">{logs.join('\n') || '（还没有日志）'}</pre>
      )}
    </div>
  )
}
