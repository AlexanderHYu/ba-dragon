// 设置：游戏目录（选根目录就行）、主题、查询、录像参数。设置文件和 4.0.x 是同一个。
import { useState } from 'react'
import { useStore } from '../../store'

export default function Settings(): React.JSX.Element {
  const { config, setConfig, status, setStatus } = useStore()
  const [msg, setMsg] = useState<string | null>(null)
  if (!config) return <div className="card"><div className="empty">读设置中…</div></div>

  const patch = async (p: Record<string, unknown>): Promise<void> => {
    setConfig(await window.BA.setConfig(p))
    setStatus(await window.BA.getStatus())
  }
  const afterDir = async (r: { gameDir: string; logDir: string } | { error: string } | null): Promise<void> => {
    if (!r) return
    if ('error' in r) {
      setMsg(r.error)
      return
    }
    setMsg('找到了：' + r.logDir)
    setConfig(await window.BA.getConfig())
    setStatus(await window.BA.getStatus())
  }

  return (
    <>
      <div className="card">
        <h2>游戏目录</h2>
        <div className="stack">
          <div className="row">
            <input readOnly value={String(config.gameDir || config.logDir || '（未设置）')} style={{ flex: 1 }} />
            <button className="primary" onClick={() => void window.BA.selectGameDir().then(afterDir)}>
              选择游戏目录
            </button>
            <button onClick={() => void window.BA.detectGameDir().then(afterDir)}>自动检测</button>
            <button disabled={!status?.logFound} onClick={() => void window.BA.openLogDir()}>
              打开日志文件夹
            </button>
          </div>
          <div className="dim">
            选断箭的安装目录就行（…\steamapps\common\broken_arrow），日志目录自己推。
            {status?.logDir ? '　当前日志目录：' + status.logDir : ''}
            {status?.watching ? '　✅ 正在监听' : status?.logFound ? '　等游戏写日志' : ''}
          </div>
          {msg && <div className="dim">{msg}</div>}
        </div>
      </div>

      <div className="card">
        <h2>外观</h2>
        <div className="row">
          <span style={{ width: 120 }}>配色</span>
          {(
            [
              ['dark', '暗色'],
              ['light', '亮色']
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={config.theme === k ? 'primary' : ''} onClick={() => void patch({ theme: k })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>查询</h2>
        <div className="stack">
          <label className="row">
            <input
              type="checkbox"
              checked={!!config.autoQueryCurrentMatch}
              onChange={(e) => void patch({ autoQueryCurrentMatch: e.target.checked })}
            />
            进对局自动把名单里每个人都算好
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={!!config.banCheckOnStart}
              onChange={(e) => void patch({ banCheckOnStart: e.target.checked })}
            />
            启动时查一次封禁名单
          </label>
          <div className="row">
            <span style={{ width: 120 }}>BATrace 请求间隔</span>
            <input
              type="number"
              min={600}
              max={5000}
              step={100}
              value={Number(config.apiDelayMs)}
              onChange={(e) => void patch({ apiDelayMs: Number(e.target.value) })}
              style={{ width: 110 }}
            />
            <span className="dim">毫秒。请求严格串行，调太快容易被对方限流。</span>
          </div>
          <div className="row">
            <span style={{ width: 120 }}>日志轮询间隔</span>
            <input
              type="number"
              min={500}
              max={10000}
              step={100}
              value={Number(config.pollMs)}
              onChange={(e) => void patch({ pollMs: Number(e.target.value) })}
              style={{ width: 110 }}
            />
            <span className="dim">毫秒</span>
          </div>
        </div>
      </div>
    </>
  )
}
