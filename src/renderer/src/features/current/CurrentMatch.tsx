// 当前房间 / 对局：两队名单，每人一行，进对局自动开查，不用点。
// 点一行不是弹窗，是把详细信息开在下面的「玩家查询」卡片里。
import { useState } from 'react'
import type { PlayerCard } from '@shared/ipc'
import { useStore } from '../../store'
import ContextMenu, { type MenuState } from '../../components/ContextMenu'
import PlayerRow, { PlayerRowHead } from './PlayerRow'

export default function CurrentMatch(): React.JSX.Element {
  const { query, session, status, openPlayer, setOpenPlayer } = useStore()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const cur = session?.snapshot.current
  const lobby = Object.keys(session?.snapshot.lobbyPlayers || {}).length
  const cards = query.cards
  const teamOf = (c: PlayerCard): string => c.team || '?'
  // [标题, 标题颜色, 名单, 是否通栏]。A 队在左、B 队在右（排位和自定义都能从日志里读到队伍，
  // 但要等对局开始；在房间里等的时候日志只有名字，分不出队）。
  // 观战和还没分队的人各自横跨两栏——挤在半边不好看。
  const isTeam = (c: PlayerCard): boolean => teamOf(c) === 'Alpha' || teamOf(c) === 'Bravo'
  const groups: [string, string, PlayerCard[], boolean][] = [
    ['Alpha', 't0', cards.filter((c) => teamOf(c) === 'Alpha'), false],
    ['Bravo', 't1', cards.filter((c) => teamOf(c) === 'Bravo'), false],
    ['观战', '', cards.filter((c) => teamOf(c) === 'Spectators'), true],
    ['房间里的人', '', cards.filter((c) => !isTeam(c) && teamOf(c) !== 'Spectators'), true]
  ]

  return (
    <div className="card">
      <h2>
        <span className="ico">📍</span>
        {cur ? '当前对局' : '当前房间'}
        {cur?.map && <span className="dim">{cur.map}</span>}
        {cur?.fid && <span className="dim">#{cur.fid}</span>}
        <span className="grow" />
        {query.pass && (
          <span className="dim">
            第 {query.pass} 轮 {query.done}/{query.total}
            <span className="spin" style={{ marginLeft: 6 }} />
          </span>
        )}
        <button onClick={() => void window.BA.queryRoster()}>🔄 重新查询</button>
      </h2>

      {query.pass && (
        <div className="bar" style={{ marginBottom: 10 }}>
          <i style={{ width: (query.total ? (query.done / query.total) * 100 : 0) + '%' }} />
        </div>
      )}

      {!cards.length ? (
        <div className="empty">
          {!status?.logFound
            ? '还没设置游戏目录，去右上角「设置」里选。'
            : cur || lobby
              ? '正在等名单…'
              : '等待对局开始…进游戏后会自动把房间里每个人都算好。'}
        </div>
      ) : (
        <div className="teams">
          {groups.map(([label, cls, list, wide]) =>
            list.length ? (
              <div key={label} className={wide ? 'wide' : undefined}>
                <div className={'team-head ' + cls}>
                  {label}
                  <span className="dim">{list.length} 人</span>
                  <span className="dim">{avgText(list)}</span>
                </div>
                <PlayerRowHead />
                {list.map((c) => (
                  <PlayerRow
                    key={c.id}
                    card={c}
                    active={openPlayer === c.id}
                    onOpen={() => setOpenPlayer(c.id)}
                    onMenu={setMenu}
                  />
                ))}
              </div>
            ) : null
          )}
        </div>
      )}
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

/** 一队的平均 ELO 和平均龙区分，算好了才显示 */
function avgText(list: PlayerCard[]): string {
  const elos = list.map((c) => c.info?.elo).filter((v): v is number => v != null)
  const scores = list.map((c) => c.dragon?.value).filter((v): v is number => v != null)
  const out: string[] = []
  if (elos.length) out.push('平均 ELO ' + Math.round(elos.reduce((a, b) => a + b, 0) / elos.length))
  if (scores.length) out.push('平均 ' + (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) + ' 分')
  return out.join(' · ')
}
