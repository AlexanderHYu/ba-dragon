// ================= 主进程 =================
// 只负责搭台子：建窗口、起服务、把 IPC 接上。具体逻辑都在 services/ 里。
import { app, BrowserWindow, protocol, shell } from 'electron'
import { dirname, join } from 'node:path'
import { LogParser } from '@shared/log'
import type { SessionState } from '@shared/ipc'
import { Config } from './services/config'
import { Db } from './services/db'
import { BatraceClient } from './services/batrace'
import { LogWatcher } from './services/logWatcher'
import { PlayerService, loadMapNames } from './services/players'
import { QueryService } from './services/query'
import { DeckService } from './services/decks'
import { Tracker } from './services/tracker'
import { BanService } from './services/bans'
import { Updater } from './services/updater'
import { GameDbService } from './services/gameDb'
import { ReplayService } from './services/replays'
import { migrateLegacy, legacyLocalIds } from './services/migrate'
import { MatchSync } from './services/matchSync'
import { registerIpc } from './ipc'

// 录像播放走自定义协议 replay://local/<文件名>：支持 Range 请求，拖进度条只读需要的那一段
protocol.registerSchemesAsPrivileged([
  { scheme: 'replay', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
])

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
  decks: DeckService
  tracker: Tracker
  bans: BanService
  updater: Updater
  gamedb: GameDbService
  replays: ReplayService
  sync: MatchSync
  send: <T>(channel: string, payload?: T) => void
  session: () => SessionState
  queryRoster: (opts?: { prev?: boolean; refresh?: boolean }) => void
}

// 只允许开一个：两个实例同时写本地库会打架，再点图标就把已开的窗口叫到前面。
// 冒烟测试不受这个限制，不然上一次跑剩下的进程会让后面的测试全部「起不来」。
if (!process.env.BA_SMOKE && !app.requestSingleInstanceLock()) app.quit()

let win: BrowserWindow | null = null
let services: Services | null = null

const send = <T,>(channel: string, payload?: T): void => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow(): void {
  // 窗口大小位置记在设置里，下次开还是这么大
  const saved = (services?.config.get('windowBounds') as { width?: number; height?: number } | undefined) || {}
  win = new BrowserWindow({
    width: Math.max(900, Number(saved.width) || 1280),
    height: Math.max(600, Number(saved.height) || 860),
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
  win.on('close', () => {
    try {
      const b = win?.getBounds()
      if (b && !win?.isMaximized()) services?.config.set({ windowBounds: { width: b.width, height: b.height } })
    } catch {
      /* 记不住就算了 */
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  const search = process.env.BA_SMOKE ? 'smoke=1' : ''
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL + (search ? '?' + search : ''))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

function startServices(): Services {
  const dataDir = app.getPath('userData')
  const config = new Config(dataDir)
  const db = new Db(join(dataDir, 'dragon.sqlite'))
  db.importLegacyCache(dataDir) // 老版缓存搬过来，省一批请求
  loadMapNames(db) // 地图名字是一点点学来的，存在库里
  // 4.0.x 的对局档案、玩家库、ELO 快照搬进本地库（只搬一次，只新增不覆盖）
  const moved = migrateLegacy(db, dataDir)
  if (moved.ran && (moved.matches || moved.players)) {
    setTimeout(
      () =>
        send('toast', {
          kind: 'info',
          text: '老版数据已经搬过来了：' + moved.matches + ' 局对局、' + moved.players + ' 个玩家'
        }),
      3000
    )
  }

  const parser = new LogParser((type, data) => {
    // 日志事件：先把状态推给界面
    send('session:state', session())
    // 启动时会把当天的日志补读一遍，那些是历史对局：不能开录、不能覆盖卡组包、也别去查名单，
    // 否则每次打开软件都会「开录 → 立刻结束 → 没有录到画面」，还白发一堆请求
    // 结束事件不看历史判断：没在录的时候 stopForMatch 自己会返回，
    // 但万一对局中途日志停写超过 2 分钟，这一停不能漏（漏了录像会被 watchdog 直接丢掉）
    if (type === 'matchEnd') {
      const m = data as { fid?: string | null; map?: string }
      replays?.stopForMatch(m?.fid ?? null, m?.map || '')
      // BATrace 出数据比打完慢一两分钟（实测 90 秒），所以等一会儿再抓这一局：
      // 对局档案马上就有，录像文件名里缺的地图/队伍也顺手补上
      if (!watcher.isHistorical()) {
        setTimeout(
          () => {
            void sync
              .run()
              .catch(() => undefined)
              .then(() => replays?.backfillMeta())
          },
          2 * 60 * 1000
        )
      }
    }
    if (watcher.isHistorical()) return
    if (type === 'matchStart') {
      const m = data as { fid?: string | null; map?: string }
      replays?.startForMatch(m?.fid ?? null, m?.map || '')
    }
    if (type === 'matchStart' || type === 'roster') scheduleQuery()
  })

  const watcher = new LogWatcher({
    dir: () => String(config.get('logDir') || ''),
    pollMs: () => Number(config.get('pollMs')) || 1500,
    parser,
    onState: () => send('session:state', session()),
    // 补读完了：如果是在对局中途打开的软件，这时候才去查名单
    onCatchUpDone: () => {
      if (!watcher.isStale() && parser.snapshot().current?.players.length) scheduleQuery()
    }
  })

  // 游戏自带的单位库：配装真名 + 精确花费。没填密钥就一直是「没读到」，功能自动退回估算
  const gamedb = new GameDbService(
    db,
    // 老版设置里只有日志目录（…roken_arrow\GameLogs），游戏根目录就是它的上一级
    () => String(config.get('gameDir') || '') || dirname(String(config.get('logDir') || '')),
    () => String(config.get('gameKey') || '')
  )
  setTimeout(() => {
    try {
      gamedb.load()
    } catch {
      /* 读不出来不影响其它功能 */
    }
  }, 1500)

  const decks = new DeckService(dataDir, () => String(config.get('gameKey') || ''))
  const tracker = new Tracker(db)
  const client = new BatraceClient({ db, delayMs: () => Number(config.get('apiDelayMs')) || 1200 })
  const bans = new BanService(client, db)
  // 本机账号：日志里认出来的 + 老数据里记过的
  const localIds = (): string[] => {
    const snap = parser.snapshot()
    const ids = new Set(legacyLocalIds(db))
    if (snap.localName) {
      for (const m of [snap.current, ...parser.archived]) {
        for (const pl of m?.players || []) if (pl.name === snap.localName) ids.add(pl.id)
      }
    }
    return [...ids]
  }
  const sync = new MatchSync(client, db, tracker, localIds)

  const replays = new ReplayService(
    config,
    db,
    {
      status: (st) => send('replay:status', st),
      changed: () => send('replay:changed'),
      log: (line) => send('replay:log', line)
    },
    localIds
  )
  // 不在对局了还在录（崩溃退出、日志漏了结束行）：每 30 秒兜一次
  setInterval(() => replays.watchdog(!!parser.snapshot().current), 30000)

  const updater = new Updater((info) => send('update:available', info))
  updater.init()
  // 启动 8 秒后查一次，之后每 6 小时查一次（只读 GitHub 公开 Release）
  setTimeout(() => void updater.check(), 8000)
  setInterval(() => void updater.check(), 6 * 3600 * 1000)
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

  /**
   * 我自己的 BATrace ID。
   * 开战前的那几行日志（Incoming client、Room: Client）记的都是**别的**客户端，
   * 没有自己，所以房间名单里会少一个人。这里用日志里的角色名把自己认出来补上。
   */
  function localPid(name: string | null): string | null {
    if (!name) return null
    const snap = parser.snapshot()
    // 先看这次开软件以来打过的局：Player list 里有自己，名字对得上就是
    for (const m of [snap.current, ...parser.archived]) {
      const hit = m?.players?.find((p) => p.name === name)
      if (hit?.id) return hit.id
    }
    // 再看本地库里记过的本机账号
    const ids = localIds()
    if (!ids.length) return null
    const row = db.get<{ pid: string }>(
      'SELECT pid FROM player WHERE name = ? AND pid IN (' + ids.map(() => '?').join(',') + ') LIMIT 1',
      [name, ...ids]
    )
    return row?.pid || (ids.length === 1 ? ids[0] : null)
  }

  function queryRoster(opts: { prev?: boolean; refresh?: boolean } = {}): void {
    const snap = parser.snapshot()
    const cur = snap.current
    let roster = cur?.players?.length ? [...cur.players] : []
    if (!roster.length) {
      // 还没开战：用大厅里的人（Incoming client 的 ID 就是 batrace ID）
      roster = Object.entries(snap.lobbyPlayers || {}).map(([id, name]) => ({ id, name, team: null }))
    }
    // 名单里没有自己就补上（对局开始后的 Player list 是带自己的，这时候就不用补）
    const name = snap.localName
    if (name && !roster.some((p) => p.name === name)) {
      const me = localPid(name)
      if (me && !roster.some((p) => p.id === me)) roster.push({ id: me, name, team: null })
    }
    if (!roster.length) return
    void query.run(roster, { fid: cur?.fid ?? null, localName: snap.localName, ...opts })
  }

  watcher.start()
  replays.registerProtocol()
  // 启动后探一次 BATrace（一个很小的请求），否则顶栏一直显示「待请求」
  setTimeout(() => void client.probe().then(() => send('app:status', null)), 3000)
  // 每小时同步一次本机最近对局，对局档案会自己长起来（每个账号 1 个请求）
  if (config.get('matchSyncEnabled')) {
    setTimeout(() => void sync.run().catch(() => undefined), 20000)
    sync.start()
  }
  // 封禁名单：启动后等一会查一次（其余时候手动刷新），查到熟人被封就提示
  if (config.get('banCheckOnStart')) {
    setTimeout(() => {
      void bans
        .check()
        .then((r) => {
          if (r.newly.length) {
            send('toast', { kind: 'warn', text: '你遇到过的 ' + r.newly.map((x) => x.name).join('、') + ' 被封了' })
          }
        })
        .catch(() => undefined)
    }, 10000)
  }
  return { config, db, parser, watcher, client, players, query, decks, tracker, bans, updater, gamedb, replays, sync, send, session, queryRoster }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// 主进程出了没接住的异常：打到日志里，别默默吞掉
process.on('uncaughtException', (e) => console.error('[main] 未捕获异常', e))
process.on('unhandledRejection', (e) => console.error('[main] 未处理的 rejection', e))

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
  services?.sync.stop()
  services?.replays.abort() // 录到一半退出：先把 ffmpeg 停掉
  services?.watcher.stop()
  services?.db.close()
})
