// 设置：对着 4.0.3 那份设置来的——游戏目录、外观、查询、同步、录像管理、关于。
// 设置文件和 4.0.x 是同一个 settings.json，两个版本能共存。
import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import Switch from '../../components/Switch'

const QQ = '3123897241'

export default function Settings(): React.JSX.Element {
  const { config, setConfig, status, setStatus } = useStore()
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [replayCount, setReplayCount] = useState<number | null>(null)

  useEffect(() => {
    void window.BA.listReplays().then((l) => setReplayCount(l.length))
  }, [])

  if (!config) {
    return (
      <div className="card">
        <div className="empty">读设置中…</div>
      </div>
    )
  }

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
  const run = async (key: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(key)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="card">
        <h2>📁 游戏目录</h2>
        <div className="stack">
          <div className="row wrap">
            <input readOnly value={String(config.gameDir || config.logDir || '（未设置）')} style={{ flex: 1, minWidth: 240 }} />
            <button className="primary" onClick={() => void window.BA.selectGameDir().then(afterDir)}>
              选择游戏目录
            </button>
            <button onClick={() => void window.BA.detectGameDir().then(afterDir)}>自动检测</button>
            <button disabled={!status?.logFound} onClick={() => void window.BA.openLogDir()}>
              📂 打开日志文件夹
            </button>
          </div>
          <div className="dim">
            选断箭的安装目录就行（…\steamapps\common\broken_arrow），日志目录自己推。
            {status?.logDir ? '　当前日志目录：' + status.logDir : ''}
            {status?.watching ? '　✅ 正在监听' : status?.logFound ? '　等游戏写日志' : ''}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>🎨 外观</h2>
        <div className="row">
          <span className="set-label">配色</span>
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
        <h2>🔍 查询与同步</h2>
        <div className="stack">
          <Switch
            checked={!!config.autoQueryCurrentMatch}
            onChange={(v) => void patch({ autoQueryCurrentMatch: v })}
            label="进对局自动把名单里每个人都算好"
            hint="两轮：先拉档案填满名单，再补龙区分"
          />
          <Switch
            checked={!!config.banCheckOnStart}
            onChange={(v) => void patch({ banCheckOnStart: v })}
            label="启动时查一次封禁名单"
            hint="只标记你遇到过的人；4.0.x 是每小时轮询"
          />
          <Switch
            checked={!!config.matchSyncEnabled}
            onChange={(v) => void patch({ matchSyncEnabled: v })}
            label="每小时同步我的对局记录"
            hint="对局档案会自己长起来，也用来回填相遇、胜负、改名史"
          />
          <div className="row">
            <span className="set-label">BATrace 请求间隔</span>
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
            <span className="set-label">日志轮询间隔</span>
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
          <div className="row">
            <button
              disabled={busy === 'sync'}
              onClick={() =>
                void run('sync', async () => {
                  const r = await window.BA.syncMatches()
                  return 'error' in r ? '同步失败：' + r.error : `同步完成，新增 ${r.added} 局（${r.accounts} 个账号）`
                })
              }
            >
              {busy === 'sync' ? '同步中…' : '立即同步对局记录'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>📼 本地录像管理</h2>
        <div className="stack">
          <div className="row wrap">
            <span className="set-label">保存目录</span>
            <input readOnly value={String(config.replaySaveDir || '（默认：数据目录\\replays）')} style={{ flex: 1, minWidth: 220 }} />
            <button onClick={() => void window.BA.selectReplayDir().then(() => void window.BA.getConfig().then(setConfig))}>
              换目录
            </button>
            <button onClick={() => void window.BA.openReplayFolder()}>📂 打开</button>
          </div>
          <div className="row wrap">
            <span className="dim">本地共 {replayCount ?? '…'} 个录像</span>
            <button
              onClick={() =>
                void run('clean30', async () => {
                  const n = await window.BA.cleanReplays(30)
                  setReplayCount((await window.BA.listReplays()).length)
                  return '删除了 ' + n + ' 个 30 天前的录像'
                })
              }
            >
              删除 30 天前
            </button>
            <button
              className="danger"
              onClick={() => {
                if (!window.confirm('把本地所有录像都删掉？这一步不可撤销。')) return
                void run('cleanAll', async () => {
                  const n = await window.BA.cleanReplays(0)
                  setReplayCount((await window.BA.listReplays()).length)
                  return '删除了 ' + n + ' 个录像'
                })
              }}
            >
              删除全部录像
            </button>
          </div>
          <div className="dim">录像参数（显示器、画质、曝光、声音）在主界面的「行车记录仪」卡片里调。</div>
        </div>
      </div>

      <div className="card about">
        <h2>ℹ 关于</h2>
        <p>
          🐉 <b>龙区分类器</b> v{status?.version || ''} · 只读取游戏日志（GameLogs）和 BATrace 的公开接口，
          <b>不读写游戏内存、不注入进程、不修改游戏文件，不影响反作弊。</b>
        </p>
        <p>
          数据全部存在本地（<code>%APPDATA%\broken-arrow-log-assistant</code>），没有自建服务器，不上传你的任何数据。
          联网只有两处：BATrace 的公开接口、GitHub 上本仓库的 Release 信息（查新版本）。
        </p>
        <p>
          玩家数据来自{' '}
          <a href="#" onClick={() => window.BA.openExternal('https://app.batrace.top/')}>
            BATrace
          </a>
          （运营方已同意本工具使用其 API）· 录像编码用{' '}
          <a href="#" onClick={() => window.BA.openExternal('https://github.com/BtbN/FFmpeg-Builds')}>
            FFmpeg
          </a>
          （GPL）· 本项目最初 fork 自 Zola 的{' '}
          <a href="#" onClick={() => window.BA.openExternal('https://github.com/Zawinzala/brokenarrow-log-maggot')}>
            断箭蛆工具
          </a>
          （MIT），5.0 是重写版本。
        </p>
        <p>
          有问题、有想法、发现算得不对，都可以找我：<b>QQ {QQ}</b>
          <button style={{ marginLeft: 8 }} onClick={() => void navigator.clipboard.writeText(QQ)}>
            复制
          </button>
        </p>
        <p>
          <a href="#" onClick={() => window.BA.openExternal('https://github.com/AlexanderHYu/ba-dragon')}>
            源码与更新
          </a>
          {' · '}
          <a href="#" onClick={() => window.BA.openExternal('https://github.com/AlexanderHYu/ba-dragon/blob/main/docs/algorithm.md')}>
            龙区分怎么算的
          </a>
        </p>
      </div>

      {msg && <div className="toast info set-msg">{msg}</div>}
    </>
  )
}
