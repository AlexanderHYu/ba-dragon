// 设置：目录、轮询、请求间隔、自动查询。设置文件和 4.0.x 是同一个。
import { useStore } from '../../store'

export default function Settings(): React.JSX.Element {
  const { config, setConfig, session } = useStore()
  if (!config) return <div className="empty">读设置中…</div>
  const patch = async (p: Record<string, unknown>): Promise<void> => setConfig(await window.BA.setConfig(p))

  return (
    <div className="card">
      <h2>设置</h2>
      <div className="stack">
        <div>
          <div className="dim">游戏日志目录（…\broken_arrow\GameLogs）</div>
          <div className="row">
            <input readOnly value={config.logDir || '（未设置）'} style={{ flex: 1 }} />
            <button
              onClick={async () => {
                const dir = await window.BA.selectLogDir()
                if (dir) void patch({})
              }}
            >
              选择目录
            </button>
            <button
              onClick={async () => {
                const dir = await window.BA.detectLogDir()
                if (dir) setConfig(await window.BA.getConfig())
              }}
            >
              自动检测
            </button>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            {session?.watcher.listening
              ? '正在监听：' + (session.watcher.file || '')
              : '没有在监听任何日志文件'}
          </div>
        </div>

        <label className="row">
          <input
            type="checkbox"
            checked={!!config.autoQueryCurrentMatch}
            onChange={(e) => void patch({ autoQueryCurrentMatch: e.target.checked })}
          />
          进对局自动把名单里每个人都算好
        </label>

        <div className="row">
          <span style={{ width: 160 }}>BATrace 请求间隔</span>
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
          <span style={{ width: 160 }}>日志轮询间隔</span>
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
  )
}
