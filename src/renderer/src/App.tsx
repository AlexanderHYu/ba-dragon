import { useEffect } from 'react'
import { useStore, cardOf } from './store'
import CurrentMatch from './features/current/CurrentMatch'
import PlayerDrawer from './features/current/PlayerDrawer'
import Search from './features/search/Search'
import Settings from './features/settings/Settings'

export default function App(): React.JSX.Element {
  const { view, setView, setConfig, setSession, setQuery, patchCard, openPlayer, setOpenPlayer } = useStore()

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
        <button onClick={() => setView('settings')} className={view === 'settings' ? 'primary' : ''}>
          设置
        </button>
      </div>
      <div className="main">
        {view === 'current' ? (
          <>
            <CurrentMatch />
            <Search />
          </>
        ) : (
          <Settings />
        )}
      </div>
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
