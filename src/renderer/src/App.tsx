import { useEffect } from 'react'
import { useStore } from './store'
import Sidebar from './components/Sidebar'
import UpdateBanner from './components/UpdateBanner'
import Toasts from './components/Toasts'
import CurrentMatch from './features/current/CurrentMatch'
import Archive from './features/archive/Archive'
import Replays from './features/replay/Replays'
import PlayerPanel from './features/players/PlayerPanel'
import Decks from './features/decks/Decks'
import Bans from './features/decks/Bans'
import Settings from './features/settings/Settings'
import UnitStats from './features/stats/UnitStats'
import Calculator from './features/calc/Calculator'
import ReportPage from './features/report/ReportPage'

export default function App(): React.JSX.Element {
  const { page, back, setPage, config, setConfig, setStatus, setSession, setQuery, patchCard } = useStore()

  useEffect(() => {
    void window.BA.getConfig().then(setConfig)
    void window.BA.getStatus().then(setStatus)
    void window.BA.getSession().then(setSession)
    void window.BA.getQueryState().then(setQuery)
    const offSession = window.BA.on('session:state', setSession)
    const offQuery = window.BA.on('query:state', setQuery)
    const offCard = window.BA.on('query:card', patchCard)
    return () => {
      offSession()
      offQuery()
      offCard()
    }
  }, [setConfig, setStatus, setSession, setQuery, patchCard])

  // 冒烟测试用：带 ?smoke=1 启动时，允许外部直接打开某一页（截图验收）
  useEffect(() => {
    if (!location.search.includes('smoke=1')) return
    const w = window as unknown as Record<string, unknown>
    w.__openReport = (fid: string, tab?: string) => setPage({ name: 'report', fid, tab })
    w.__goto = (name: string) => setPage({ name } as Parameters<typeof setPage>[0])
    // 没在打游戏也能把名单摆出来看排版（只在 smoke=1 下挂）
    w.__fakeRoster = (q: unknown) => setQuery(q as Parameters<typeof setQuery>[0])
  }, [setPage, setQuery])

  // 配色跟着设置走
  useEffect(() => {
    document.documentElement.dataset.theme = String(config?.theme || 'dark')
  }, [config?.theme])

  const openReport = (fid: string): void => setPage({ name: 'report', fid })

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <UpdateBanner />
        {page.name === 'current' && <CurrentMatch />}
        {page.name === 'archive' && <Archive onOpen={openReport} />}
        {page.name === 'replays' && <Replays />}
        {page.name === 'players' && <PlayerPanel />}
        {page.name === 'stats' && <UnitStats />}
        {page.name === 'calc' && <Calculator />}
        {page.name === 'decks' && <Decks />}
        {page.name === 'bans' && <Bans />}
        {page.name === 'settings' && <Settings />}
        {page.name === 'report' && <ReportPage fid={page.fid} onBack={() => setPage(back)} />}
      </main>
      <Toasts />
    </div>
  )
}
