// 左侧栏：品牌、分组导航、底部三个状态灯（日志、BATrace、录像）。替代原来的顶栏。
import { useEffect, useState } from 'react'
import {
  IconBan,
  IconCalculator,
  IconCards,
  IconChartBar,
  IconCrosshair,
  IconHistory,
  IconSettings,
  IconUsers,
  IconVideo,
  type Icon as TablerIcon
} from '@tabler/icons-react'
import { useStore, type NavPage } from '../store'
import Ico from './Icon'

type Item = [NavPage, string, TablerIcon]
const GROUPS: [string, Item[]][] = [
  [
    '对局',
    [
      ['current', '当前对局', IconCrosshair],
      ['archive', '对局档案', IconHistory],
      ['replays', '录像', IconVideo]
    ]
  ],
  [
    '情报',
    [
      ['players', '玩家查询', IconUsers],
      ['stats', '单位效能', IconChartBar],
      ['calc', '伤害计算', IconCalculator]
    ]
  ],
  [
    '工具',
    [
      ['decks', '卡组', IconCards],
      ['bans', '封禁追踪', IconBan],
      ['settings', '设置', IconSettings]
    ]
  ]
]

export default function Sidebar(): React.JSX.Element {
  const { status, setStatus, page, setPage } = useStore()
  const [probing, setProbing] = useState(false)
  const [counts, setCounts] = useState<{ archive: number | null; replays: number | null }>({ archive: null, replays: null })
  const [rec, setRec] = useState<{ active: boolean; error?: string } | null>(null)

  useEffect(() => {
    const pull = (): void => void window.BA.getStatus().then(setStatus)
    pull()
    const t = setInterval(pull, 5000)
    return () => clearInterval(t)
  }, [setStatus])

  useEffect(() => {
    const archive = (): void => void window.BA.listArchive().then((l) => setCounts((c) => ({ ...c, archive: l.length })))
    const replays = (): void => void window.BA.listReplays().then((l) => setCounts((c) => ({ ...c, replays: l.length })))
    archive()
    replays()
    void window.BA.getReplayStatus().then(setRec)
    const offA = window.BA.on('archive:changed', archive)
    const offR = window.BA.on('replay:changed', replays)
    const offS = window.BA.on('replay:status', setRec)
    return () => {
      offA()
      offR()
      offS()
    }
  }, [])

  const api = status?.api
  const apiCls = api?.ok == null ? 'wait' : api.ok ? 'ok' : 'bad'
  const apiText = probing ? '检测中' : api?.ok == null ? '待请求' : api.ok ? '正常' : api.message || '异常'
  const logCls = status?.watching ? 'ok' : status?.logFound ? 'wait' : 'bad'
  const logText = status?.watching ? '监听中' : status?.logFound ? '等待日志' : '未找到目录'
  const recCls = rec?.error ? 'bad' : rec?.active ? 'rec' : ''
  const recText = rec?.error ? '出错' : rec?.active ? '录制中' : '待机'

  const count = (k: NavPage): number | null => (k === 'archive' ? counts.archive : k === 'replays' ? counts.replays : null)
  // 复盘页属于「对局档案」那一栏
  const on = (k: NavPage): boolean => page.name === k || (page.name === 'report' && k === 'archive')

  return (
    <aside className="side">
      <div className="brand">
        <div className="t">龙区分类器</div>
        <div className="v">BA-DRAGON v{status?.version || '…'}</div>
      </div>
      <nav className="nav">
        {GROUPS.map(([g, items]) => (
          <div key={g}>
            <div className="g">{g}</div>
            {items.map(([k, label, icon]) => (
              <a key={k} className={on(k) ? 'on' : undefined} onClick={() => setPage({ name: k })} title={label}>
                <Ico i={icon} />
                <span>{label}</span>
                {count(k) != null && <span className="c">{count(k)}</span>}
              </a>
            ))}
          </div>
        ))}
      </nav>
      <div className="sys">
        <div title={status?.logDir || ''}>
          <span className="k">LOG</span>
          <span className={'lamp ' + logCls} />
          <span className={'txt ' + logCls}>{logText}</span>
        </div>
        <div
          className="clickable"
          title={
            (api?.at ? new Date(api.at).toLocaleTimeString('zh-CN') + ' · 本次启动请求 ' + api.requests + ' 次 · ' : '') +
            '点击重新检测连接'
          }
          onClick={() => {
            if (probing) return
            setProbing(true)
            void window.BA.probeApi()
              .then(() => window.BA.getStatus().then(setStatus))
              .finally(() => setProbing(false))
          }}
        >
          <span className="k">API</span>
          <span className={'lamp ' + apiCls} />
          <span className={'txt ' + apiCls}>BATrace {apiText}</span>
        </div>
        <div title={rec?.error || ''}>
          <span className="k">REC</span>
          <span className={'lamp ' + recCls} />
          <span className={'txt ' + (rec?.error ? 'bad' : '')}>{recText}</span>
        </div>
      </div>
    </aside>
  )
}
