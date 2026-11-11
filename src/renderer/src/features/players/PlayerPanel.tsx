// 玩家查询页：顶栏里搜索，下面是搜索结果和这个人的详细信息。
// 当前对局里点某个人、复盘里右键「调查羁绊」也是跳到这一页。
import { useEffect, useState } from 'react'
import { IconSearch, IconX } from '@tabler/icons-react'
import { cardOf, useStore } from '../../store'
import PageBar from '../../components/PageBar'
import Ico from '../../components/Icon'
import PlayerRow, { PlayerRowHead } from '../current/PlayerRow'
import PlayerDetail from './PlayerDetail'
import './players.css'

export default function PlayerPanel(): React.JSX.Element {
  const { search, searching, setSearch, openPlayer, setOpenPlayer, patchCard } = useStore()
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const card = cardOf(openPlayer)

  // 搜索结果里的卡片是空壳，点开时才去算（对局里的已经算好了）。
  // 从复盘右键「调查羁绊」跳过来的人，本地压根没有卡片，也在这里补算
  useEffect(() => {
    if (!openPlayer) return
    const c = cardOf(openPlayer)
    if (c && c.dragonState !== 'idle') return
    void window.BA.getPlayerCard(openPlayer, { name: c?.name }).then(patchCard)
  }, [openPlayer, patchCard])

  const go = async (): Promise<void> => {
    const text = q.trim()
    if (!text) return
    setErr(null)
    setSearch([], true)
    try {
      const list = await window.BA.searchPlayers(text)
      setSearch(list)
      if (!list.length) setErr('未找到该玩家')
      // 只搜到一个人就直接打开
      else if (list.length === 1) setOpenPlayer(list[0].id)
    } catch (e) {
      setSearch([])
      setErr(String((e as Error)?.message || e))
    }
  }

  return (
    <>
      <PageBar title="玩家查询">
        <label className="pp-search">
          <Ico i={IconSearch} />
          <input
            value={q}
            placeholder="玩家名或 ID"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void go()}
          />
        </label>
        <button className="primary" onClick={() => void go()}>
          搜索
        </button>
        {searching && <span className="spin" />}
        {err && <span className="m">{err}</span>}
        <span className="grow" />
        {card && (
          <button onClick={() => setOpenPlayer(null)} title="关闭这个人的详细信息">
            <Ico i={IconX} />
            关闭详情
          </button>
        )}
      </PageBar>
      <div className="page">
        {/* 有多个搜索结果、还没选人时列出来；选了人就收起来，免得把详情挤下去 */}
        {search.length > 1 && !card && (
          <div className="card flush search-list">
            <h2>
              搜索结果<span className="sub">{search.length} 人，点一行查看</span>
            </h2>
            <PlayerRowHead />
            {search.slice(0, 12).map((c) => (
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
          !search.length && <div className="empty">搜索玩家名或 ID，或在「当前对局」里点一个人。</div>
        )}
      </div>
    </>
  )
}
