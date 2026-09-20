// ================= 主进程 =================
// 只负责搭台子：建窗口、起服务、把 IPC 接上。具体逻辑都在 services/ 里。
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { LogParser } from '@shared/log'
import type { SessionState } from '@shared/ipc'
import { Config } from './services/config'
import { Db } from './services/db'
import { BatraceClient } from './services/batrace'
import { LogWatcher } from './services/logWatcher'
import { PlayerService } from './services/players'
import { QueryService } from './services/query'
import { registerIpc } from './ipc'

// 数据目录固定成 4.0.x 用的那个：改名、换版本，设置和对局档案都还在原处
app.setPath('userData', join(app.getPath('appData'), 'broken-arrow-log-assistant'))

export interface Services {
  config: Config
  db: Db
  parser: LogParser
  watcher: LogWatcher
  client: BatraceClient
  players: PlayerService
  query: QueryService
  send: <T>(channel: string, payload?: T) => void
  session: () => SessionState
  queryRoster: (opts?: { prev?: boolean; refresh?: boolean }) => void
}

let win: BrowserWindow | null = null
let services: Services | null = null

const send = <T,>(channel: string, payload?: T): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#12151b',
    title: '龙区分类器',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.on('ready-to-show', () => {
    win?.show()
    // 冒烟测试：起得来就退出，不用人看着
    if (process.env.BA_SMOKE && win) void import('./smoke').then((m) => m.run(win as BrowserWindow))
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function startServices(): Services {
  const dataDir = app.getPath('userData')
  const config = new Config(dataDir)
  const db = new Db(join(dataDir, 'dragon.sqlite'))
  db.importLegacyCache(dataDir) // 老版缓存搬过来，省一批请求

  const parser = new LogParser((type) => {
    // 日志事件：先把状态推给界面，进对局/名单变化时自动开查
    send('session:state', session())
    if (type === 'matchStart' || type === 'roster') scheduleQuery()
  })

  const watcher = new LogWatcher({
    dir: () => String(config.get('logDir') || ''),
    pollMs: () => Number(config.get('pollMs')) || 1500,
    parser,
    onState: () => send('session:state', session())
  })

  const client = new BatraceClient({ db, delayMs: () => Number(config.get('apiDelayMs')) || 1200 })
  const players = new PlayerService(client, db)
  const query = new QueryService(players, {
    state: (s) => send('query:state', s),
    card: (c) => send('query:card', c)
  })

  const session = (): SessionState => ({ snapshot: parser.snapshot(), watcher: watcher.state() })

  // 名单会一行一行地出现，等它稳定 2 秒再开查，免得查到一半又来人
  let queryTimer: NodeJS.Timeout | null = null
  function scheduleQuery(): void {
    if (!config.get('autoQueryCurrentMatch')) return
    if (queryTimer) clearTimeout(queryTimer)
    queryTimer = setTimeout(() => queryRoster(), 2000)
  }

  function queryRoster(opts: { prev?: boolean; refresh?: boolean } = {}): void {
    const snap = parser.snapshot()
    const cur = snap.current
    let roster = cur?.players?.length ? cur.players : []
    if (!roster.length) {
      // 还没开战：用大厅里的人（Incoming client 的 ID 就是 batrace ID）
      roster = Object.entries(snap.lobbyPlayers || {}).map(([id, name]) => ({ id, name, team: null }))
    }
    if (!roster.length) return
    void query.run(roster, { fid: cur?.fid ?? null, localName: snap.localName, ...opts })
  }

  watcher.start()
  return { config, db, parser, watcher, client, players, query, send, session, queryRoster }
}

app.whenReady().then(() => {
  services = startServices()
  registerIpc(services)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  services?.watcher.stop()
  services?.db.close()
})
