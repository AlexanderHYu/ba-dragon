// 主进程 ↔ 界面的契约：通道名和参数/返回类型都写在这里，两边共用。
// 加字段时这里改一次，主进程和界面哪边没跟上，编译就会报错。
import type { DragonScore } from './dragon'
import type { MatchReport } from './match'
import type { LogMatch, LogSnapshot } from './log'

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
  logDir: string
  pollMs: number
  apiDelayMs: number
  autoQueryCurrentMatch: boolean
  theme: string
  banCheckOnStart: boolean
  matchSyncEnabled: boolean
  replayEnabled: boolean
  [k: string]: unknown
}

export interface SessionState {
  snapshot: LogSnapshot
  watcher: { file: string | null; listening: boolean; mtime: number | null }
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

/** invoke 通道：名字 → [参数, 返回值] */
export interface IpcMap {
  'config:get': [void, Settings]
  'config:set': [Partial<Settings>, Settings]
  'config:selectDir': [void, string | null]
  'config:detectDir': [void, string | null]
  'session:get': [void, SessionState]
  'players:search': [string, PlayerCard[]]
  'player:card': [{ stbid: string; refresh?: boolean }, PlayerCard]
  'match:query': [{ players?: { id: string; name: string; team?: string | null }[] } | void, void]
  'match:state': [void, QueryState]
  'match:report': [{ fid: string; localIds?: string[] }, MatchReport | { error: string }]
  'archive:list': [void, LogMatch[]]
  'app:version': [void, { current: string; latest: string; hasUpdate: boolean }]
  'update:get': [void, UpdateInfo | null]
  'update:install': [void, boolean]
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
}

export type IpcChannel = keyof IpcMap
export type EventChannel = keyof EventMap
