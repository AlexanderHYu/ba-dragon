// 设置：对着 4.0.3 那份设置来的——游戏目录、外观、查询、同步、录像管理、关于。
// 设置文件和 4.0.x 是同一个 settings.json，两个版本能共存。
import { useEffect, useState } from 'react'
import type { GameDbStatus } from '@shared/ipc'
import { useStore } from '../../store'
import Switch from '../../components/Switch'

const QQ = '3123897241'

export default function Settings(): React.JSX.Element {
  const { config, setConfig, status, setStatus } = useStore()
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [replayCount, setReplayCount] = useState<number | null>(null)
  const [upMsg, setUpMsg] = useState<string | null>(null)
  const [gdb, setGdb] = useState<GameDbStatus | null>(null)
  const [keyText, setKeyText] = useState<string | null>(null)

  useEffect(() => {
    void window.BA.listReplays().then((l) => setReplayCount(l.length))
    void window.BA.getGameDb().then(setGdb)
  }, [])

  if (!config) {
    return (
      <div className="card">
        <div className="empty">正在读取设置…</div>
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
    setMsg('已找到日志目录：' + r.logDir)
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
            选择断箭安装目录（…\steamapps\common\broken_arrow），日志目录自动识别。
            {status?.logDir ? '　当前日志目录：' + status.logDir : ''}
            {status?.watching ? '　✅ 正在监听' : status?.logFound ? '　等待游戏日志' : ''}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>🧩 游戏数据（配装名字 / 精确花费）</h2>
        <div className="stack">
          <div className="dim">
            复盘中的配装名称（「配装 A」→「M1A1 FEP Trophy」）和精确花费来自游戏单位表。软件内置一份，游戏更新后可能略旧。
            填写密钥后从本机游戏文件读取最新单位表（仅本地读取，不上传）。查看卡组内容也需要密钥（.dek 文件已加密）。
            密钥可能随游戏更新变化，不随软件发布。
          </div>
          <div className="row wrap">
            <input
              value={keyText ?? String(config.gameKey || '')}
              placeholder="32 位密钥，留空则不启用"
              spellCheck={false}
              onChange={(e) => setKeyText(e.target.value)}
              style={{ flex: 1, minWidth: 280, fontFamily: 'ui-monospace, Consolas, monospace' }}
            />
            <button
              className="primary"
              disabled={busy === 'gamekey' || keyText == null || keyText === String(config.gameKey || '')}
              onClick={async () => {
                setBusy('gamekey')
                await patch({ gameKey: (keyText || '').trim() })
                // 解密是重活，只在这儿和下面那个按钮做，平时开软件只读缓存
                setGdb(await window.BA.refreshGameDb())
                setKeyText(null)
                setBusy(null)
              }}
            >
              {busy === 'gamekey' ? '读取中…' : '保存并读取'}
            </button>
            <button
              disabled={busy === 'gamekey' || !gdb?.hasKey}
              onClick={async () => {
                setBusy('gamekey')
                setGdb(await window.BA.refreshGameDb())
                setBusy(null)
              }}
              title="游戏更新后重新读取单位表"
            >
              ↻ 重新读取
            </button>
          </div>
          <div className={gdb?.source === 'local' ? 'lit-ok' : gdb?.error ? 'lit-bad' : 'dim'}>
            {gdb?.error
              ? '读取失败：' + gdb.error + '（暂用内置单位表）'
              : gdb?.source === 'local'
                ? '✅ 本机单位表：' + gdb.units + ' 个单位、' + gdb.options + ' 套配装选项'
                : gdb?.source === 'bundled'
                  ? '内置单位表（' +
                    (gdb.updatedAt || '未知日期') +
                    ' 导出，' +
                    gdb.units +
                    ' 个单位）。填写密钥可读取本机最新版本'
                  : '无单位表，复盘花费为估算值'}
            {gdb?.stale && '　⚠ 游戏已更新，请点「重新读取」'}
          </div>
          <div className="dim" style={{ fontSize: 11.5 }}>
            读取结果会缓存，启动时不重复读取。游戏更新后需手动重新读取。
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
            label="进入对局时自动查询全部玩家"
            hint="分两轮：先查档案，再算龙区分"
          />
          <Switch
            checked={!!config.banCheckOnStart}
            onChange={(v) => void patch({ banCheckOnStart: v })}
            label="启动时查一次封禁名单"
            hint="只标记你遇到过的玩家"
          />
          <Switch
            checked={!!config.matchSyncEnabled}
            onChange={(v) => void patch({ matchSyncEnabled: v })}
            label="每小时同步我的对局记录"
            hint="更新对局档案，并补全相遇、胜负和改名记录"
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
            <span className="dim">毫秒。请求逐个发送，间隔过短可能被限流。</span>
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
                  return '已删除 ' + n + ' 个 30 天前的录像'
                })
              }
            >
              删除 30 天前
            </button>
            <button
              className="danger"
              onClick={() => {
                if (!window.confirm('删除本地全部录像？此操作不可撤销。')) return
                void run('cleanAll', async () => {
                  const n = await window.BA.cleanReplays(0)
                  setReplayCount((await window.BA.listReplays()).length)
                  return '已删除 ' + n + ' 个录像'
                })
              }}
            >
              删除全部录像
            </button>
          </div>
          <div className="dim">录像参数（显示器、画质、曝光、声音）在主界面「行车记录仪」卡片中设置。</div>
        </div>
      </div>

      <div className="card about">
        <h2>ℹ 关于</h2>
        <p>
          🐉 <b>龙区分类器</b> v{status?.version || ''} · 只读取游戏日志（GameLogs）和 BATrace 的公开接口，
          <b>不读写游戏内存、不注入进程、不修改游戏文件，不影响反作弊。</b>
          <button
            style={{ marginLeft: 8 }}
            disabled={busy === 'update'}
            onClick={async () => {
              setBusy('update')
              setUpMsg(null)
              // 有新版本的话，主进程会推 update:available，顶上的横幅自己会出来
              const u = await window.BA.checkUpdate()
              setUpMsg(u ? '发现新版本 v' + u.version : '已是最新版本')
              setBusy(null)
            }}
          >
            {busy === 'update' ? '查询中…' : '检查更新'}
          </button>
          {upMsg && <span className="dim" style={{ marginLeft: 8 }}>{upMsg}</span>}
        </p>
        <p className="dim">
          安装版在后台下载新版本，下载完成后顶部提示「重启更新」，未重启则在下次退出时安装。
          免安装版仅提示，需手动下载新 exe 替换。
        </p>
        <p>
          数据全部存在本地（<code>%APPDATA%\broken-arrow-log-assistant</code>），无自建服务器，不上传任何数据。
          联网仅两处：BATrace 公开接口、GitHub 本仓库 Release 信息（检查更新）。
        </p>
        <p>
          玩家数据来自{' '}
          <a href="#" onClick={() => window.BA.openExternal('https://dash.batrace.top/')}>
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
          （MIT），当前版本为完全重写。
        </p>
        <p>
          问题反馈：<b>QQ {QQ}</b>
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
            龙区分算法说明
          </a>
        </p>
      </div>

      {msg && <div className="toast info set-msg">{msg}</div>}
    </>
  )
}
