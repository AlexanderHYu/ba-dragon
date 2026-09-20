// 行车记录仪：开关、录像列表、内置播放器；那一堆参数收进右上角的「⚙ 设置」里。
// 录制是自动的——进对局开录，打完合成存盘，这里只管设置和查看。
import { useCallback, useEffect, useRef, useState } from 'react'
import Pager, { pageSlice } from '../../components/Pager'
import Switch from '../../components/Switch'
import type { DisplayChoice, ReplayItem } from '@shared/ipc'
import { useStore } from '../../store'
import Player from './Player'
import './replay.css'

const PAGE_SIZE = 5

/** 分辨率档位：0 = 原生（不缩放，编码器和采集同卡时帧全程留在显存），对齐 4.0.3 的写法 */
const QUALITIES: [number, string][] = [
  [0, '原生分辨率（纯 GPU，几乎不占 CPU）'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p']
]
/** 自动清理：0 = 不删 */
const KEEP_DAYS: [number, string][] = [
  [0, '不自动删'],
  [7, '只留 7 天'],
  [14, '只留 14 天'],
  [30, '只留 30 天'],
  [90, '只留 90 天']
]

const size = (n: number): string => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round(n / 1e6) + ' MB')

/** 预计 45 分钟（2700 秒）的文件大小：VBR 以码率为目标按上限估；声音 AAC 128kbps ≈ 43MB */
const estSize45 = (bitrateMbps: number, audioOn: boolean): string => {
  const mb = Math.round((bitrateMbps / 8) * 2700)
  const audioMb = audioOn ? 43 : 0
  const total = mb + audioMb
  const txt = total >= 1000 ? (total / 1000).toFixed(1) + ' GB' : total + ' MB'
  return txt + (audioOn ? `（画面 ${mb} MB + 声音 ${audioMb} MB）` : '')
}

const fmtEv = (n: number): string => (n > 0 ? '+' : '') + n.toFixed(2).replace(/\.?0+$/, '') + ' EV'

export default function Replays(): React.JSX.Element {
  const { config, setConfig, playReplay, setPlayReplay } = useStore()
  const [status, setStatus] = useState<{
    active: boolean
    current: { map: string; startedAt: number; sourceId: string } | null
    error?: string
  } | null>(null)
  const [list, setList] = useState<ReplayItem[]>([])
  const [displays, setDisplays] = useState<DisplayChoice[]>([])
  const [encoders, setEncoders] = useState<string[] | null>(null)
  const [showSet, setShowSet] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  /** 正在播的那一条（点列表某一行就在卡片里开播放器） */
  const [playing, setPlaying] = useState<ReplayItem | null>(null)
  const [page, setPage] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)

  const { items: shown, page: cur } = pageSlice(list, page, PAGE_SIZE)

  const reload = useCallback((): void => {
    void window.BA.listReplays().then((l) => {
      setList(l)
      // 文件被清理/删掉了就把播放器收起来，别留着一个放不出来的黑框
      setPlaying((p) => (p && l.some((r) => r.id === p.id) ? p : null))
    })
    void window.BA.getReplayStatus().then(setStatus)
  }, [])

  const loadDisplays = useCallback((): void => {
    void window.BA.listDisplays().then(setDisplays)
  }, [])

  useEffect(() => {
    reload()
    loadDisplays()
    const offStatus = window.BA.on('replay:status', setStatus)
    const offChanged = window.BA.on('replay:changed', reload)
    return () => {
      offStatus()
      offChanged()
    }
  }, [reload, loadDisplays])

  // 对局档案里点了 ▶：翻到那一页、开播、滚过来，然后把信号清掉
  useEffect(() => {
    if (!playReplay) return
    const i = list.findIndex((r) => r.id === playReplay)
    if (i < 0) {
      // 列表还没回来就等下一轮；已经回来了还找不到说明文件没了，别一直挂着
      if (list.length) setPlayReplay(null)
      return
    }
    setPage(Math.floor(i / PAGE_SIZE))
    setPlaying(list[i])
    setPlayReplay(null)
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [playReplay, list, setPlayReplay])

  const patch = async (p: Record<string, unknown>): Promise<void> => setConfig(await window.BA.setConfig(p))
  if (!config) return <div className="card" />
  const on = !!config.replayEnabled
  const bitrate = Number(config.replayBitrateMbps) || 8
  const fps = Number(config.replayFps) || 30
  const exposure = Number(config.replayExposure) || 0
  const audioOn = String(config.replayAudio || 'default') !== 'off'

  return (
    <div className="card" ref={cardRef}>
      <h2>
        <span className="ico">🚗</span>
        行车记录仪
        {status?.active && <span className="lit-bad">● 正在录</span>}
        <span className="grow" />
        <Switch checked={on} onChange={(v) => void patch({ replayEnabled: v })} label="开启" />
        <button className={showSet ? 'rec-set-btn open' : 'rec-set-btn'} title="录像设置" onClick={() => setShowSet(!showSet)}>
          ⚙ 设置
        </button>
        <button onClick={() => void window.BA.openReplayFolder()}>📂 打开文件夹</button>
      </h2>

      {status?.error && (
        <div className="lit-bad" style={{ marginBottom: 8 }}>
          {status.error}
        </div>
      )}
      {status?.active && status.current && (
        <div className="dim" style={{ marginBottom: 8 }}>
          {status.current.map || '本局'} · 已录 {Math.round((Date.now() - status.current.startedAt) / 1000)} 秒 ·{' '}
          {status.current.sourceId}
        </div>
      )}

      {showSet && (
        <div className="rec-set">
          {!on && <div className="rec-hint dim">现在是关的。开了之后每局自动录，下面这些设置立刻生效。</div>}

          <div className="rec-field">
            <div className="rec-label">录制屏幕</div>
            <div className="row">
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
              <button title="重新扫描显示器" onClick={() => loadDisplays()}>
                ↻
              </button>
            </div>
          </div>

          <div className="rec-field">
            <div className="rec-label">分辨率</div>
            <select
              value={Number(config.replayQuality)}
              onChange={(e) => void patch({ replayQuality: Number(e.target.value) })}
            >
              {QUALITIES.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="rec-field">
            <div className="rec-label">
              帧数（每秒）<span className="rec-val dim">{fps} fps</span>
            </div>
            <input
              type="range"
              className="rec-range"
              min={30}
              max={60}
              step={1}
              value={fps}
              onChange={(e) => void patch({ replayFps: Number(e.target.value) })}
            />
          </div>

          <div className="rec-field">
            <div className="rec-label">
              画质码率<span className="rec-val dim">{bitrate} Mbps</span>
            </div>
            <input
              type="range"
              className="rec-range"
              min={3}
              max={40}
              step={1}
              value={bitrate}
              onChange={(e) => void patch({ replayBitrateMbps: Number(e.target.value) })}
            />
          </div>

          <div className="rec-field">
            <div className="rec-label">预计 45 分钟文件大小</div>
            <div className="rec-est">{estSize45(bitrate, audioOn)}</div>
          </div>

          <div className="rec-field">
            <div className="rec-label">录制声音</div>
            <select
              value={String(config.replayAudio || 'default')}
              onChange={(e) => void patch({ replayAudio: e.target.value })}
            >
              <option value="default">系统默认声卡（桌面音频）</option>
              <option value="off">关闭</option>
            </select>
            <div className="rec-hint dim">Chromium 仅支持回环系统默认输出，无法指定其它声卡。</div>
          </div>

          <div className="rec-field">
            <div className="rec-label">
              曝光补偿<span className="rec-val dim">{fmtEv(exposure)}</span>
            </div>
            <input
              type="range"
              className="rec-range"
              min={-2}
              max={2}
              step={0.25}
              value={exposure}
              onChange={(e) => void patch({ replayExposure: Number(e.target.value) })}
            />
            <div className="rec-hint dim">录像偏暗往右拉，偏亮往左拉；每 +1 EV 亮度翻倍。HDR 屏一般要往右一点。</div>
          </div>

          <div className="rec-field">
            <div className="rec-label">保存目录</div>
            <div className="row">
              <span className="rec-dir dim">{String(config.replaySaveDir || '') || '默认（数据目录下的 replays）'}</span>
              <span className="grow" />
              <button
                onClick={async () => {
                  const d = await window.BA.selectReplayDir()
                  if (d) setConfig(await window.BA.getConfig())
                }}
              >
                📁 选择目录
              </button>
              <button onClick={() => void window.BA.openReplayFolder()}>📂 打开</button>
            </div>
          </div>

          <div className="rec-field">
            <div className="rec-label">自动清理旧录像</div>
            <select
              value={Number(config.replayKeepDays) || 0}
              onChange={(e) => void patch({ replayKeepDays: Number(e.target.value) })}
            >
              {KEEP_DAYS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="rec-field">
            <div className="rec-label">编码器</div>
            <div className="row">
              <button
                onClick={async () => {
                  setEncoders(null)
                  setEncoders(await window.BA.listEncoders())
                }}
              >
                🔎 检测编码器
              </button>
              {encoders && <span className="dim">{encoders.join('、') || '只有软件编码'}</span>}
            </div>
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
                  🗑 删除
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
      <Pager page={cur} pageSize={PAGE_SIZE} total={list.length} onPage={setPage} />

      <div className="row" style={{ marginTop: 8 }}>
        <button
          onClick={async () => {
            setShowLog(!showLog)
            if (!showLog) setLogs(await window.BA.getReplayLogs())
          }}
        >
          {showLog ? '▴ 收起日志' : '📝 录制日志'}
        </button>
        {!!list.length && (
          <button
            onClick={async () => {
              const n = await window.BA.cleanReplays(30)
              setLogs((l) => [...l, '清理了 ' + n + ' 个 30 天前的录像'])
              reload()
            }}
          >
            🧹 清理 30 天前
          </button>
        )}
      </div>
      {showLog && <pre className="log">{logs.join('\n') || '（还没有日志）'}</pre>}
    </div>
  )
}
