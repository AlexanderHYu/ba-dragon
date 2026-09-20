// 搜索玩家：搜到之后点开就是完整卡片（档案 + 龙区分），不再分两步。
import { useState } from 'react'
import { useStore } from '../../store'
import PlayerRow from '../current/PlayerRow'

export default function Search(): React.JSX.Element | null {
  const { search, searching, setSearch, setOpenPlayer } = useStore()
  const [q, setQ] = useState('')

  const go = async (): Promise<void> => {
    const text = q.trim()
    if (!text) return
    setSearch([], true)
    try {
      setSearch(await window.BA.searchPlayers(text))
    } catch {
      setSearch([])
    }
  }

  return (
    <div className="card">
      <h2>
        搜索玩家
        <span className="grow" />
        {searching && <span className="spin" />}
      </h2>
      <div className="row" style={{ marginBottom: search.length ? 10 : 0 }}>
        <input
          value={q}
          placeholder="玩家名或 ID"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void go()}
          style={{ flex: 1 }}
        />
        <button className="primary" onClick={() => void go()}>
          搜索
        </button>
      </div>
      {search.map((c) => (
        <PlayerRow key={c.id} card={c} onOpen={() => setOpenPlayer(c.id)} />
      ))}
    </div>
  )
}
