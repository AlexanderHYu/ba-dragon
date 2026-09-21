// 预加载：界面只能通过这里跟主进程说话（contextIsolation 开着，没有 nodeIntegration）。
import { contextBridge, ipcRenderer } from 'electron'
import type { EventMap, IpcMap } from '@shared/ipc'

const invoke = <K extends keyof IpcMap>(ch: K, arg?: IpcMap[K][0]): Promise<IpcMap[K][1]> =>
  ipcRenderer.invoke(ch, arg)

const api = {
  getConfig: () => invoke('config:get'),
  setConfig: (patch: IpcMap['config:set'][0]) => invoke('config:set', patch),
  selectGameDir: () => invoke('config:selectDir'),
  detectGameDir: () => invoke('config:detectDir'),
  openLogDir: () => invoke('config:openLogDir'),
  getStatus: () => invoke('app:status'),

  getSession: () => invoke('session:get'),
  searchPlayers: (q: string) => invoke('players:search', q),
  getPlayerCard: (stbid: string, opts?: { name?: string; refresh?: boolean }) =>
    invoke('player:card', { stbid, ...(opts || {}) }),

  queryRoster: (players?: IpcMap['match:query'][0]) => invoke('match:query', players),
  getQueryState: () => invoke('match:state'),
  getMatchReport: (fid: string, localIds?: string[]) => invoke('match:report', { fid, localIds }),
  listArchive: () => invoke('archive:list'),

  listDecks: () => invoke('deck:list'),
  readDeck: (name: string) => invoke('deck:read', name),
  backupDecks: (only?: string[], name?: string) => invoke('deck:backup', { only, name }),
  restoreDecks: (name: string, overwrite?: boolean) => invoke('deck:restore', { name, overwrite }),
  deleteDecks: (names: string[]) => invoke('deck:deleteDecks', names),
  deleteBackups: (names: string[]) => invoke('deck:deleteBackups', names),
  openDeckDir: (which: 'decks' | 'backups') => invoke('deck:openDir', which),
  getBond: (pid: string) => invoke('tracker:bond', pid),
  getBans: () => invoke('ban:get'),
  checkBans: () => invoke('ban:check'),

  getReplayStatus: () => invoke('replay:status'),
  listReplays: () => invoke('replay:list'),
  deleteReplay: (key: string) => invoke('replay:delete', key),
  cleanReplays: (days: number) => invoke('replay:clean', days),
  listDisplays: () => invoke('replay:displays'),
  listEncoders: () => invoke('replay:encoders'),
  openReplayFolder: (key?: string) => invoke('replay:openFolder', key),
  getReplayLogs: () => invoke('replay:logs'),
  selectReplayDir: () => invoke('replay:selectDir'),
  syncMatches: () => invoke('match:sync'),

  getVersion: () => invoke('app:version'),
  getGameDb: () => invoke('gamedb:status'),
  refreshGameDb: () => invoke('gamedb:refresh'),
  getUpdateInfo: () => invoke('update:get'),
  checkUpdate: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url),

  /** 订阅主进程推送，返回取消订阅的函数 */
  on: <K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void): (() => void) => {
    const listener = (_e: unknown, payload: EventMap[K]): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

export type BridgeApi = typeof api

contextBridge.exposeInMainWorld('BA', api)
