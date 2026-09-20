import { useEffect, useState } from 'react'
import { useStore, cardOf } from './store'
import CurrentMatch from './features/current/CurrentMatch'
import PlayerDrawer from './features/current/PlayerDrawer'
import Search from './features/search/Search'
import Settings from './features/settings/Settings'
import Archive from './features/archive/Archive'
import ReportView from './features/report/ReportView'
import Decks from './features/decks/Decks'
import Bans from './features/decks/Bans'
import UpdateBanner from './components/UpdateBanner'
import Toasts from './components/Toasts'

export default function App(): React.JSX.Element {
  const { view, setView, setConfig, setSession, setQuery, patchCard, openPlayer, setOpenPlayer } = useStore()
  const [reportFid, setReportFid] = useState<string | null>(null)

  useEffect(() => {
    void window.BA.getConfig().then(setConfig)
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
  }, [setConfig, setSession, setQuery, patchCard])

  // 搜索结果里的卡片是空壳，点开时才去算（对局里的已经算好了）
  useEffect(() => {
    if (!openPlayer) return
    const c = cardOf(openPlayer)
    if (!c || c.dragonState !== 'idle') return
    void window.BA.getPlayerCard(openPlayer).then(patchCard)
  }, [openPlayer, patchCard])

  // 冒烟测试用：带 ?smoke=1 启动时，允许外部直接打开某一局的复盘（截图验收）
  useEffect(() => {
    if (!location.search.includes('smoke=1')) return
    ;(window as unknown as { __openReport?: (fid: string) => void }).__openReport = setReportFid
  }, [])

  const card = cardOf(openPlayer)

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <span className="dragon">🐉</span> 龙区分类器
        </div>
        <span className="grow" />
        <button onClick={() => setView('current')} className={view === 'current' ? 'primary' : ''}>
          对局
        </button>
        <button onClick={() => setView('archive')} className={view === 'archive' ? 'primary' : ''}>
          档案
        </button>
        <button
          onClick={async () => {
            const { fid } = await window.BA.getPrevMatch()
            if (fid) setReportFid(fid)
          }}
          title="打完一局后，看这一局的详细复盘"
        >
          上一局复盘
        </button>
        <button onClick={() => setView('tools')} className={view === 'tools' ? 'primary' : ''}>
          工具
        </button>
        <button onClick={() => setView('settings')} className={view === 'settings' ? 'primary' : ''}>
          设置
        </button>
      </div>
      <div className="main">
        <UpdateBanner />
        {view === 'current' && (
          <>
            <CurrentMatch />
            <Search />
          </>
        )}
        {view === 'archive' && <Archive onOpen={setReportFid} />}
        {view === 'tools' && (
          <>
            <Decks />
            <Bans />
          </>
        )}
        {view === 'settings' && <Settings />}
      </div>
      <Toasts />
      {reportFid && <ReportView fid={reportFid} onClose={() => setReportFid(null)} />}
      {card && (
        <PlayerDrawer
          card={card}
          onClose={() => setOpenPlayer(null)}
          onRefresh={async () => {
            const fresh = await window.BA.getPlayerCard(card.id, true)
            patchCard(fresh)
          }}
        />
      )}
    </div>
  )
}
