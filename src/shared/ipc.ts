// 主进程 ↔ 界面的契约：通道名和参数/返回类型都写在这里，两边共用。
// 加字段时这里改一次，主进程和界面哪边没跟上，编译就会报错。
import type { DragonScore } from './dragon'
import type { MatchReport } from './match'
import type { LogSnapshot } from './log'

/** 卡组文件 */
export interface DeckFile {
  name: string
  size: number
  mtime: number
}
export interface BackupFile {
  name: string
  path: string
  size: number
  mtime: number
  decks: number
}

/** 调查羁绊 */
export interface Bond {
  pid: string
  name: string
  matches: number
  together: number
  againstYou: number
  withWin: number
  withLose: number
  vsWin: number
  vsLose: number
  firstSeen: number | null
  lastSeen: number | null
  names: string[]
  banned: boolean
  avgScore: number | null
}

/** 本地录像 */
export interface ReplayItem {
  id: string
  fid: string
  map: string
  mapId: number | null
  uploaderName: string
  teamId: number | null
  size: number
  createdAt: number
  localPath: string
}

/** 可选的显示器 */
export interface DisplayChoice {
  id: string
  label: string
  width: number
  height: number
  primary: boolean
  capturable: boolean
}

/** 封禁检查结果 */
export interface BanResult {
  checkedAt: number
  total: number
  newly: { pid: string; name: string }[]
  met: { pid: string; name: string; at: number | null }[]
}

/** 玩家卡片：粗查和龙区分合并后的唯一形态 */
export interface PlayerCard {
  id: string
  name: string
  /** 日志里的队伍（Alpha/Bravo），搜索出来的没有 */
  team?: string | null
  /** 基础档案（/api/analysis/player） */
  info: PlayerInfo | null
  /** 龙区分（/api/players/matches 算出来） */
  dragon: DragonScore | null
  /** 这两步各自的状态，界面据此显示「正在算」 */
  infoState: LoadState
  dragonState: LoadState
  error?: string | null
  /** 上次见到这个人时的龙区分（本地库里的快照），用于「上次 6.2，这次 7.8」 */
  lastSeen?: { score: number; at: number } | null
  /** 搜索接口给的 ELO：BATrace 档案里的旧值，可能是几周前的，只在没有更新数据时兜底显示 */
  staleElo?: number | null
  staleEloAt?: number | null
  updatedAt?: number
}

export type LoadState = 'idle' | 'loading' | 'done' | 'error'

export interface PlayerInfo {
  stbid: string
  name?: string
  elo: number | null
  /** 本地记到的更新的 ELO（搜索接口的 rating 可能是几周前的） */
  localElo?: number | null
  localEloAt?: number | null
  matchCount: number
  winRate: number
  wins: number
  losses: number
  kd: number | null
  dmr: number | null
  favUnits: { name: string; val: number; spawn: number; roi: number | null }[]
  categories: { key: string; pct: number }[]
  mapStats: { mapId: number; name: string; matchCount: number; winRate: number }[]
  playStyle: unknown
  recentMatches: {
    matchId: string | number
    win: boolean
    eloDelta: number | null
    kd: number | null
    dmr: number | null
    destruction: number
    losses: number
    objectives: number
    endTime: number
  }[]
}

export interface Settings {
  /** 游戏根目录；日志目录从它推 */
  gameDir: string
  logDir: string
  /** 读游戏自带单位库的密钥（32 位，空 = 不启用） */
  gameKey: string
  pollMs: number
  apiDelayMs: number
  autoQueryCurrentMatch: boolean
  theme: 'dark' | 'light' | string
  banCheckOnStart: boolean
  matchSyncEnabled: boolean
  replayEnabled: boolean
  [k: string]: unknown
}

export interface SessionState {
  snapshot: LogSnapshot
  watcher: { file: string | null; listening: boolean; mtime: number | null }
}

/** 顶栏那一行状态 */
export interface AppStatus {
  version: string
  /** 游戏目录找没找到 */
  gameDir: string
  logDir: string
  logFound: boolean
  watching: boolean
  /** BATrace 最近一次真实请求的结果 */
  api: { ok: boolean | null; at: number | null; message: string | null; requests: number }
}

export interface QueryState {
  fid: string | null
  /** 名单查询进度：第几个/共几个，两轮分别统计 */
  pass: 1 | 2 | null
  done: number
  total: number
  prev: boolean
  cards: PlayerCard[]
}

/** 对局档案里的一条 */
export interface ArchiveItem {
  fid: string
  map: string
  startTime: number | null
  durationSec: number | null
  winnerTeam: number | null
  /** 排位还是自定义（看这局有没有人掉分涨分） */
  mode: '排位' | '自定义' | '未知'
  /** 我这局：哪个账号、胜负、赛前赛后 ELO、龙区分 */
  mine?: {
    account: string
    won: boolean | null
    eloBefore: number | null
    eloAfter: number | null
    score: number | null
    mark: string | null
  } | null
}

/** invoke 通道：名字 → [参数, 返回值] */
export interface IpcMap {
  'config:get': [void, Settings]
  'config:set': [Partial<Settings>, Settings]
  'config:selectDir': [void, { gameDir: string; logDir: string } | { error: string } | null]
  'config:detectDir': [void, { gameDir: string; logDir: string } | null]
  'config:openLogDir': [void, void]
  'app:status': [void, AppStatus]
  'session:get': [void, SessionState]
  'players:search': [string, PlayerCard[]]
  'player:card': [{ stbid: string; name?: string; refresh?: boolean }, PlayerCard]
  'match:query': [{ players?: { id: string; name: string; team?: string | null }[] } | void, void]
  'match:state': [void, QueryState]
  'match:report': [{ fid: string; localIds?: string[] }, MatchReport | { error: string }]
  'archive:list': [void, ArchiveItem[]]
  'deck:list': [void, { found: boolean; dir: string; backupDir: string; decks: DeckFile[]; backups: BackupFile[] }]
  'deck:backup': [{ name?: string; only?: string[] } | void, { file: string; decks: number } | { error: string }]
  'deck:restore': [{ name: string; overwrite?: boolean }, { restored: number; skipped: string[] } | { error: string }]
  'deck:deleteDecks': [string[], { removed: number; error?: string }]
  'deck:deleteBackups': [string[], { removed: number; error?: string }]
  'deck:openDir': ['decks' | 'backups', void]
  'tracker:bond': [string, Bond | null]
  'ban:get': [void, BanResult | null]
  'ban:check': [void, BanResult | { error: string }]
  'replay:status': [void, { active: boolean; current: { fid: string; map: string; startedAt: number; sourceId: string } | null; error?: string }]
  'replay:list': [void, ReplayItem[]]
  'replay:delete': [string, { ok: boolean; message: string }]
  'replay:clean': [number, number]
  'replay:displays': [void, DisplayChoice[]]
  'replay:encoders': [void, string[]]
  'replay:openFolder': [string | void, void]
  'replay:logs': [void, string[]]
  'replay:selectDir': [void, string | null]
  'match:sync': [void, { added: number; accounts: number } | { error: string }]
  'app:version': [void, { current: string; latest: string; hasUpdate: boolean }]
  /** 游戏自带单位库：状态 / 重新读一遍 */
  'gamedb:status': [void, GameDbStatus]
  'gamedb:refresh': [void, GameDbStatus]
  /** 读一副卡组的内容（需要密钥） */
  'deck:read': [string, DeckView | { error: string }]
  'update:get': [void, UpdateInfo | null]
  /** 手动点「检查更新」：查完把结果直接返回，没有新版本就是 null */
  'update:check': [void, UpdateInfo | null]
  'update:install': [void, boolean]
}

export interface DeckView {
  name: string
  country: string
  specs: string[]
  /** 一共多少张卡 */
  cards: number
  cats: {
    key: string
    label: string
    items: {
      unitId: number
      name: string
      loadout: string
      cost: number
      count: number
      transport: string | null
      transportCost: number
    }[]
  }[]
}

/** 游戏单位库的状态 */
export interface GameDbStatus {
  /** 用的是哪一份：local = 本机实时解的，bundled = 软件自带的，none = 都没有 */
  source: 'local' | 'bundled' | 'none'
  units: number
  options: number
  /** 这份数据是哪天导出来的 */
  updatedAt: string | null
  /** 导出时游戏资源包的大小:修改时间，游戏更新了这个会变 */
  stamp: string | null
  /** 本机解出来的那份比游戏旧了（游戏更新过），提示重新读一次 */
  stale: boolean
  error: string | null
  /** 设置里填没填密钥 */
  hasKey: boolean
}

export interface UpdateInfo {
  version: string
  current: string
  url: string
  mode: 'auto' | 'manual'
  status: 'available' | 'downloading' | 'ready'
  percent?: number | null
  portable?: boolean
}

/** 主进程 → 界面的推送 */
export interface EventMap {
  'session:state': SessionState
  'query:state': QueryState
  'query:card': PlayerCard
  'update:available': UpdateInfo
  'toast': { kind: 'info' | 'warn' | 'error'; text: string }
  'replay:status': { active: boolean; current: { fid: string; map: string; startedAt: number; sourceId: string } | null; error?: string }
  'replay:changed': void
  'replay:log': string
}

export type IpcChannel = keyof IpcMap
export type EventChannel = keyof EventMap
