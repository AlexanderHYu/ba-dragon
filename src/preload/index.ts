// 预加载：界面只能通过这里跟主进程说话（contextIsolation 开着，没有 nodeIntegration）。
import { contextBridge, ipcRenderer } from 'electron'
import type { EventMap, IpcMap } from '@shared/ipc'

const invoke = <K extends keyof IpcMap>(ch: K, arg?: IpcMap[K][0]): Promise<IpcMap[K][1]> =>
  ipcRenderer.invoke(ch, arg)

const api = {
  getConfig: () => invoke('config:get'),
  setConfig: (patch: IpcMap['config:set'][0]) => invoke('config:set', patch),
  selectLogDir: () => invoke('config:selectDir'),
  detectLogDir: () => invoke('config:detectDir'),

  getSession: () => invoke('session:get'),
  searchPlayers: (q: string) => invoke('players:search', q),
  getPlayerCard: (stbid: string, refresh?: boolean) => invoke('player:card', { stbid, refresh }),

  queryRoster: (players?: IpcMap['match:query'][0]) => invoke('match:query', players),
  getQueryState: () => invoke('match:state'),
  getMatchReport: (fid: string, localIds?: string[]) => invoke('match:report', { fid, localIds }),
  listArchive: () => invoke('archive:list'),
  getPrevMatch: () => invoke('match:prev'),

  getVersion: () => invoke('app:version'),
  getUpdateInfo: () => invoke('update:get'),
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
