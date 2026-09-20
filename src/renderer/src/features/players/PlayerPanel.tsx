// 玩家查询：搜索框 + 搜索结果 + 详细信息，全都在这一个卡片里。
// 当前对局里点某个人也是开在这儿（不再弹侧栏）。
import { useEffect, useRef, useState } from 'react'
import { cardOf, useStore } from '../../store'
import PlayerRow, { PlayerRowHead } from '../current/PlayerRow'
import PlayerDetail from './PlayerDetail'
import './players.css'

export default function PlayerPanel(): React.JSX.Element {
  const { search, searching, setSearch, openPlayer, setOpenPlayer, patchCard } = useStore()
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const card = cardOf(openPlayer)
  const boxRef = useRef<HTMLDivElement>(null)

  // 在上面的名单里点了人：把这张卡片滚到视野里
  useEffect(() => {
    if (openPlayer) boxRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [openPlayer])

  // 搜索结果里的卡片是空壳，点开时才去算（对局里的已经算好了）
  useEffect(() => {
    if (!openPlayer) return
    const c = cardOf(openPlayer)
    if (!c || c.dragonState !== 'idle') return
    void window.BA.getPlayerCard(openPlayer, { name: c.name }).then(patchCard)
  }, [openPlayer, patchCard])

  const go = async (): Promise<void> => {
    const text = q.trim()
    if (!text) return
    setErr(null)
    setSearch([], true)
    try {
      const list = await window.BA.searchPlayers(text)
      setSearch(list)
      if (!list.length) setErr('没搜到这个人')
    } catch (e) {
      setSearch([])
      setErr(String((e as Error)?.message || e))
    }
  }

  return (
    <div className="card" ref={boxRef}>
      <h2>
        <span className="ico">🔍</span>
        玩家查询 · 龙区分
        <span className="grow" />
        {searching && <span className="spin" />}
        {card && (
          <button onClick={() => setOpenPlayer(null)} title="收起详细信息">
            ▴ 收起
          </button>
        )}
      </h2>

      <div className="row" style={{ marginBottom: 10 }}>
        <input
          value={q}
          placeholder="玩家名或 ID"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void go()}
          style={{ flex: 1, maxWidth: 320 }}
        />
        <button className="primary" onClick={() => void go()}>
          🔍 搜索
        </button>
        {err && <span className="dim">{err}</span>}
      </div>

      {!!search.length && (
        <div className="search-list">
          <PlayerRowHead />
          {search.slice(0, 8).map((c) => (
            <PlayerRow key={c.id} card={c} active={openPlayer === c.id} onOpen={() => setOpenPlayer(c.id)} />
          ))}
        </div>
      )}

      {card ? (
        <PlayerDetail
          card={card}
          onRefresh={async () => {
            patchCard(await window.BA.getPlayerCard(card.id, { name: card.name, refresh: true }))
          }}
        />
      ) : (
        <div className="empty">搜一个人，或者在上面的名单里点一个人。</div>
      )}
    </div>
  )
}
