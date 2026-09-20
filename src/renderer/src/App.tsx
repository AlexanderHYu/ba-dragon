import { useEffect } from 'react'
import { useStore } from './store'
import TopBar from './components/TopBar'
import UpdateBanner from './components/UpdateBanner'
import Toasts from './components/Toasts'
import Home from './features/home/Home'
import Settings from './features/settings/Settings'
import ReportPage from './features/report/ReportPage'

export default function App(): React.JSX.Element {
  const { page, setPage, config, setConfig, setStatus, setSession, setQuery, patchCard } = useStore()

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

  // 冒烟测试用：带 ?smoke=1 启动时，允许外部直接打开某一局的复盘（截图验收）
  useEffect(() => {
    if (!location.search.includes('smoke=1')) return
    ;(window as unknown as { __openReport?: (fid: string) => void }).__openReport = (fid) =>
      setPage({ name: 'report', fid })
  }, [setPage])

  // 配色跟着设置走
  useEffect(() => {
    document.documentElement.dataset.theme = String(config?.theme || 'dark')
  }, [config?.theme])

  return (
    <div className="app">
      <TopBar />
      <div className="main">
        <UpdateBanner />
        {page.name === 'home' && <Home onOpenReport={(fid) => setPage({ name: 'report', fid })} />}
        {page.name === 'report' && <ReportPage fid={page.fid} onBack={() => setPage({ name: 'home' })} />}
        {page.name === 'settings' && <Settings />}
      </div>
      <Toasts />
    </div>
  )
}
