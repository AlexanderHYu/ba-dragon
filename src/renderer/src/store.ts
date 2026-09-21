// 界面状态：主进程推什么就存什么，组件只管读。
import { create } from 'zustand'
import type { AppStatus, PlayerCard, QueryState, SessionState, Settings } from '@shared/ipc'

/** 主界面 / 复盘整页 / 设置 */
export type Page = { name: 'home' } | { name: 'report'; fid: string } | { name: 'stats' } | { name: 'settings' }

interface State {
  config: Settings | null
  status: AppStatus | null
  session: SessionState | null
  query: QueryState
  /** 玩家查询卡片里正在看的人 */
  openPlayer: string | null
  /** 手动搜出来的人 */
  search: PlayerCard[]
  searching: boolean
  page: Page
  /** 档案里点了 ▶：行车记录仪看到非空就播这一条，然后清空 */
  playReplay: string | null
  setConfig: (c: Settings) => void
  setStatus: (s: AppStatus) => void
  setSession: (s: SessionState) => void
  setQuery: (q: QueryState) => void
  patchCard: (c: PlayerCard) => void
  setOpenPlayer: (id: string | null) => void
  setSearch: (list: PlayerCard[], searching?: boolean) => void
  setPage: (p: Page) => void
  setPlayReplay: (id: string | null) => void
}

const emptyQuery: QueryState = { fid: null, pass: null, done: 0, total: 0, prev: false, cards: [] }

export const useStore = create<State>((set) => ({
  config: null,
  status: null,
  session: null,
  query: emptyQuery,
  openPlayer: null,
  search: [],
  searching: false,
  page: { name: 'home' },
  playReplay: null,
  setConfig: (config) => set({ config }),
  setStatus: (status) => set({ status }),
  setSession: (session) => set({ session }),
  setQuery: (query) => set({ query }),
  patchCard: (card) =>
    set((s) => {
      const inQuery = s.query.cards.some((c) => c.id === card.id)
      const inSearch = s.search.some((c) => c.id === card.id)
      return {
        query: inQuery ? { ...s.query, cards: s.query.cards.map((c) => (c.id === card.id ? card : c)) } : s.query,
        // 既不在对局里也不在搜索结果里（比如从档案点进来的）：放进搜索结果，详情才找得到
        search: inSearch ? s.search.map((c) => (c.id === card.id ? card : c)) : inQuery ? s.search : [card, ...s.search]
      }
    }),
  setOpenPlayer: (openPlayer) => set({ openPlayer }),
  setSearch: (search, searching = false) => set({ search, searching }),
  setPage: (page) => set({ page }),
  setPlayReplay: (playReplay) => set({ playReplay })
}))

/** 当前对局 + 搜索结果里找这个人 */
export const cardOf = (id: string | null): PlayerCard | null => {
  if (!id) return null
  const s = useStore.getState()
  return s.query.cards.find((c) => c.id === id) || s.search.find((c) => c.id === id) || null
}
