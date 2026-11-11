// 录像页：左边播放器，右边录制状态和录像列表；参数收进「录像设置」里。
// 录制是自动的——进对局开录，打完合成存盘，这里只管设置和查看。
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconAdjustments,
  IconAlertTriangle,
  IconChartBar,
  IconFileText,
  IconFolder,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconTrash
} from '@tabler/icons-react'
import Pager, { pageSlice } from '../../components/Pager'
import Switch from '../../components/Switch'
import PageBar from '../../components/PageBar'
import Ico from '../../components/Icon'
import type { DisplayChoice, ReplayItem, Settings } from '@shared/ipc'
import { useStore } from '../../store'
import Player from './Player'
import './replay.css'

const PAGE_SIZE = 12

/** 分辨率档位：0 = 原生（不缩放，编码器和采集同卡时帧全程留在显存），对齐 4.0.3 的写法 */
const QUALITIES: [number, string][] = [
  [0, '原生分辨率（GPU 编码，CPU 占用低）'],
  [1440, '1440p'],
  [1080, '1080p'],
  [720, '720p']
]
/** 自动清理：0 = 不删 */
const KEEP_DAYS: [number, string][] = [
  [0, '不自动清理'],
  [7, '保留 7 天'],
  [14, '保留 14 天'],
  [30, '保留 30 天'],
  [90, '保留 90 天']
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
  const { config, setConfig, playReplay, setPlayReplay, setPage } = useStore()
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
  const [page, setPageNo] = useState(0)
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
    setPageNo(Math.floor(i / PAGE_SIZE))
    setPlaying(list[i])
    setPlayReplay(null)
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [playReplay, list, setPlayReplay])

  const patch = async (p: Record<string, unknown>): Promise<void> => setConfig(await window.BA.setConfig(p))
  if (!config) return <div className="page" />
  const on = !!config.replayEnabled

  return (
    <>
      <PageBar title="录像">
        <span className="m">
          共 <b>{list.length}</b> 条 · 占用 <b>{size(list.reduce((a, r) => a + r.size, 0))}</b>
        </span>
        <span className="grow" />
        <Switch checked={on} onChange={(v) => void patch({ replayEnabled: v })} label="自动录制" />
        <button className={showSet ? 'rec-set-btn open' : 'rec-set-btn'} onClick={() => setShowSet(!showSet)}>
          <Ico i={IconAdjustments} />
          录像设置
        </button>
        <button onClick={() => void window.BA.openReplayFolder()}>
          <Ico i={IconFolder} />
          打开文件夹
        </button>
      </PageBar>
      <div className="page" ref={cardRef}>
        {status?.error && (
          <div className="banner err" style={{ margin: '0 0 12px' }}>
            <Ico i={IconAlertTriangle} />
            {status.error}
          </div>
        )}
        <div className="rec-grid">
          <div className="rec-main">
            {/* 播放器的位置一直留着：没在放的时候是个空框，点一条才把画面填进去 */}
            <div className="bplayer-slot">
              {playing ? (
                <Player key={playing.id} item={playing} onClose={() => setPlaying(null)} />
              ) : (
                <div className="bplayer-empty">
                  <div className="bplayer-empty-ico">
                    <Ico i={IconPlayerPlay} size={20} />
                  </div>
                  <div>
                    {list.length
                      ? '点击右侧录像在此播放'
                      : on
                        ? '进入对局后自动录制，录像将显示在此'
                        : '自动录制未开启'}
                  </div>
                </div>
              )}
            </div>
            {playing?.fid && (
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={() => setPage({ name: 'report', fid: playing.fid, tab: 'timeline' })}>
                  <Ico i={IconChartBar} />
                  查看本局复盘
                </button>
              </div>
            )}
            {showSet && <RecSettings config={config} patch={patch} displays={displays} loadDisplays={loadDisplays} encoders={encoders} setEncoders={setEncoders} on={on} />}
          </div>

          <div className="rec-side">
            <div className="card flush">
              <div className="recst">
                <span className={'lamp ' + (status?.error ? 'bad' : status?.active ? 'rec' : on ? 'wait' : '')} />
                <span>
                  {status?.active
                    ? '正在录制' + (status.current?.map ? ' · ' + status.current.map : '')
                    : on
                      ? '等待开战后自动录制'
                      : '自动录制未开启'}
                </span>
                <span className="grow" />
                {status?.active && status.current && (
                  <span className="mono faint">{Math.round((Date.now() - status.current.startedAt) / 1000)} 秒</span>
                )}
              </div>
              <div className="rl">
                {shown.map((r) => (
                  <div
                    key={r.id}
                    className={'replay-row' + (playing?.id === r.id ? ' active' : '')}
                    title="在左侧播放"
                    onClick={() => setPlaying((p) => (p?.id === r.id ? null : r))}
                  >
                    <div className="x">
                      <b>{r.map || '—'}</b>
                      <span>
                        {new Date(r.createdAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}{' '}
                        · {size(r.size)}
                      </span>
                    </div>
                    <button
                      className="danger ghost"
                      title="删除这条录像"
                      aria-label="删除这条录像"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await window.BA.deleteReplay(r.id)
                        reload()
                      }}
                    >
                      <Ico i={IconTrash} />
                    </button>
                  </div>
                ))}
                {!list.length && (
                  <div className="empty">{on ? '暂无录像。进入对局后自动录制。' : '自动录制未开启。开启后每局自动录制。'}</div>
                )}
              </div>
            </div>
            <Pager page={cur} pageSize={PAGE_SIZE} total={list.length} onPage={setPageNo} />
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button
                onClick={async () => {
                  setShowLog(!showLog)
                  if (!showLog) setLogs(await window.BA.getReplayLogs())
                }}
              >
                <Ico i={IconFileText} />
                {showLog ? '收起日志' : '录制日志'}
              </button>
              {!!list.length && (
                <button
                  onClick={async () => {
                    const n = await window.BA.cleanReplays(30)
                    setLogs((l) => [...l, '已清理 ' + n + ' 个 30 天前的录像'])
                    reload()
                  }}
                >
                  <Ico i={IconTrash} />
                  清理 30 天前
                </button>
              )}
            </div>
            {showLog && <pre className="log">{logs.join('\n') || '（暂无日志）'}</pre>}
          </div>
        </div>
      </div>
    </>
  )
}

/** 录像设置：点「录像设置」才展开，改了立即生效 */
function RecSettings({
  config,
  patch,
  displays,
  loadDisplays,
  encoders,
  setEncoders,
  on
}: {
  config: Settings
  patch: (p: Record<string, unknown>) => Promise<void>
  displays: DisplayChoice[]
  loadDisplays: () => void
  encoders: string[] | null
  setEncoders: (e: string[] | null) => void
  on: boolean
}): React.JSX.Element {
  const { setConfig } = useStore()
  const bitrate = Number(config.replayBitrateMbps) || 8
  const fps = Number(config.replayFps) || 30
  const exposure = Number(config.replayExposure) || 0
  const audioOn = String(config.replayAudio || 'default') !== 'off'
  return (
    <div className="card rec-set-card">
      <h2>录像设置</h2>
      {!on && <div className="rec-hint dim">自动录制未开启。开启后每局自动录制，以下设置立即生效。</div>}
      <div className="rec-set">
        <div className="rec-field">
          <div className="rec-label">录制屏幕</div>
          <div className="row">
            <select
              value={String(config.replayDisplayId || '')}
              onChange={(e) => void patch({ replayDisplayId: e.target.value })}
              style={{ flex: 1 }}
            >
              <option value="">自动（主屏）</option>
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                  {d.primary ? '（主屏）' : ''}
                  {d.capturable ? '' : '（不支持显卡直接采集）'}
                </option>
              ))}
            </select>
            <button title="重新扫描显示器" aria-label="重新扫描显示器" onClick={() => loadDisplays()}>
              <Ico i={IconRefresh} />
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
            帧数（每秒）<span className="rec-val">{fps} fps</span>
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
            画质码率<span className="rec-val">{bitrate} Mbps</span>
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
          <div className="rec-hint dim">预计 45 分钟文件大小：{estSize45(bitrate, audioOn)}</div>
        </div>

        <div className="rec-field">
          <div className="rec-label">录制声音</div>
          <select
            value={String(config.replayAudio || 'default')}
            onChange={(e) => void patch({ replayAudio: e.target.value })}
          >
            <option value="default">桌面声音</option>
            <option value="mic">桌面声音 + 麦克风</option>
            <option value="off">关闭</option>
          </select>
          <div className="rec-hint dim">
            使用系统默认播放设备和麦克风（Windows 声音设置中的「默认设备」）。如需更换请在系统中设置。
          </div>
        </div>

        <div className="rec-field">
          <div className="rec-label">
            曝光补偿<span className="rec-val">{fmtEv(exposure)}</span>
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
          <div className="rec-hint dim">录像偏暗向右调，偏亮向左调；每 +1 EV 亮度翻倍。HDR 显示器通常需要调高。</div>
        </div>

        <div className="rec-field">
          <div className="rec-label">保存目录</div>
          <div className="row">
            <span className="rec-dir dim">{String(config.replaySaveDir || '') || '默认（数据目录\\replays）'}</span>
            <span className="grow" />
            <button
              onClick={async () => {
                const d = await window.BA.selectReplayDir()
                if (d) setConfig(await window.BA.getConfig())
              }}
            >
              <Ico i={IconFolder} />
              选择目录
            </button>
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
              <Ico i={IconSearch} />
              检测编码器
            </button>
            {encoders && <span className="dim">{encoders.join('、') || '仅软件编码'}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
