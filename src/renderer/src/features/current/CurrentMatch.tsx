// 当前房间 / 对局：两队名单左右并排，每人一行，进对局自动开查，不用点。
// 点一行跳到「玩家查询」页看这个人的详细信息。
import { useState } from 'react'
import { IconCrown, IconRefresh } from '@tabler/icons-react'
import type { PlayerCard } from '@shared/ipc'
import { teamWinExpect } from '@shared/dragon'
import { useStore } from '../../store'
import ContextMenu, { type MenuState } from '../../components/ContextMenu'
import PageBar from '../../components/PageBar'
import Ico from '../../components/Icon'
import PlayerRow, { PlayerRowHead } from './PlayerRow'
import { guessHost } from '@shared/log/host'
import './current.css'

export default function CurrentMatch(): React.JSX.Element {
  const { query, session, status, openPlayer, setOpenPlayer, setPage } = useStore()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const cur = session?.snapshot.current
  const lobby = Object.keys(session?.snapshot.lobbyPlayers || {}).length
  const cards = query.cards
  const meName = session?.snapshot.localName
  const teamOf = (c: PlayerCard): string => c.team || '?'
  // [标题, 队伍样式, 名单, 是否通栏]。A 队在左、B 队在右（排位和自定义都能从日志里读到队伍，
  // 但要等对局开始；在房间里等的时候日志只有名字，分不出队）。
  // 观战和还没分队的人各自横跨两栏——挤在半边不好看。
  const isTeam = (c: PlayerCard): boolean => teamOf(c) === 'Alpha' || teamOf(c) === 'Bravo'
  const A = cards.filter((c) => teamOf(c) === 'Alpha')
  const B = cards.filter((c) => teamOf(c) === 'Bravo')
  const groups: [string, number | null, PlayerCard[], boolean][] = [
    ['A 队', 0, A, false],
    ['B 队', 1, B, false],
    ['观战', null, cards.filter((c) => teamOf(c) === 'Spectators'), true],
    ['未分队', null, cards.filter((c) => !isTeam(c) && teamOf(c) !== 'Spectators'), true]
  ]
  // 游戏只在有人**加入**时写一行 Incoming client，你进房之前就在里面的人（房主必然是）
  // 日志里根本没有。翻了十份日志，进厅两秒内一条补播都没有，只能等开打时的完整名单。
  const partialRoster = !cur && cards.length > 0
  // 反推房主：名单里既不是「我进来之后才加入的」也不是我自己的人，就是我进房之前就在的
  const host = guessHost(
    cards.map((c) => ({ id: c.id, name: c.name, team: c.team || null })),
    session?.snapshot.lobbyPlayers || {},
    meName || null,
    !!session?.snapshot.sawLobbyEnter
  )
  // 赛前预期胜率：两队都有人查到 ELO 才显示
  const elos = (l: PlayerCard[]): number[] =>
    l.map((c) => c.info?.elo ?? c.staleElo ?? null).filter((v): v is number => v != null)
  const wp = A.length && B.length ? teamWinExpect(elos(A), elos(B)) : null

  const open = (id: string): void => {
    setOpenPlayer(id)
    setPage({ name: 'players' })
  }

  return (
    <>
      <PageBar title={cur ? '当前对局' : '当前房间'}>
        {cur?.map && (
          <span className="m">
            地图 <b>{cur.map}</b>
          </span>
        )}
        {cur?.fid && (
          <span className="m">
            对局 <b>#{cur.fid}</b>
          </span>
        )}
        <span className="grow" />
        {query.pass && (
          <span className="m">
            第 {query.pass} 轮 {query.done}/{query.total}
            <span className="spin" style={{ marginLeft: 8, verticalAlign: -1 }} />
          </span>
        )}
        <button onClick={() => void window.BA.queryRoster()}>
          <Ico i={IconRefresh} />
          重新查询
        </button>
      </PageBar>

      {query.pass && (
        <div className="bar">
          <i style={{ width: (query.total ? (query.done / query.total) * 100 : 0) + '%' }} />
        </div>
      )}

      <div className="page">
        {partialRoster && (
          <div className="cm-note">
            游戏日志只记录你进入后加入的玩家，你进入前已在房间的玩家（通常包括房主）暂不显示。对局开始后显示完整名单。
          </div>
        )}

        {/* 房主只在房间里有意义，开打之后就不显示了 */}
        {host.known && !cur && (
          <div className="cm-note">
            <Ico i={IconCrown} />
            {host.me ? (
              <b>你是房主</b>
            ) : host.id ? (
              <>
                房主：<b>{host.candidates[0].name}</b>
              </>
            ) : (
              <>
                房主可能是：<b>{host.candidates.map((c) => c.name).join('、')}</b>
                （均在你进入前已在房间，无法确定）
              </>
            )}
          </div>
        )}

        {wp != null && <Odds A={A} B={B} wp={wp} />}

        {!cards.length ? (
          <div className="empty">
            {!status?.logFound
              ? '未找到游戏目录，请在「设置」中选择。'
              : cur || lobby
                ? '等待玩家名单…'
                : '等待对局开始，进入房间后自动查询所有玩家。'}
          </div>
        ) : (
          <div className="teams">
            {groups.map(([label, t, list, wide]) =>
              list.length ? (
                <div key={label} className={(wide ? 'wide' : '') + (t != null ? ' team' + t : '')}>
                  <div className={'team-head' + (t != null ? ' t' + t : '')}>
                    {label}
                    <span className="dim">{list.length} 人</span>
                    <TeamAvg list={list} />
                  </div>
                  <PlayerRowHead />
                  {list.map((c) => (
                    <PlayerRow
                      key={c.id}
                      card={c}
                      me={!!meName && c.name === meName}
                      active={openPlayer === c.id}
                      onOpen={() => open(c.id)}
                      onMenu={setMenu}
                    />
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </>
  )
}

/**
 * 两队对比：中间大号的赛前胜率（按两队平均 ELO，和复盘页「赛前预期」同一算法），
 * 两边是平均 ELO、平均龙区分和龙/强/区的人数。龙区分还没换算进胜率——那要先用历史对局回测校准。
 */
function Odds({ A, B, wp }: { A: PlayerCard[]; B: PlayerCard[]; wp: number }): React.JSX.Element {
  const side = (list: PlayerCard[], t: number): React.JSX.Element => {
    const elos = list.map((c) => c.info?.elo ?? c.staleElo ?? null).filter((v): v is number => v != null)
    const scores = list.map((c) => c.dragon?.value).filter((v): v is number => v != null)
    const avg = (a: number[]): number | null => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
    const tiers = { dragon: 0, solid: 0, qu: 0 } as Record<string, number>
    for (const c of list) if (c.dragon && c.dragon.tier in tiers) tiers[c.dragon.tier]++
    const e = avg(elos)
    const sc = avg(scores)
    return (
      <div className={'odds-side t' + t}>
        <div className="odds-name">{t === 0 ? 'A 队' : 'B 队'}</div>
        <div className="odds-kv">
          <span>
            平均 ELO<b>{e == null ? '—' : Math.round(e)}</b>
          </span>
          <span>
            平均龙区分<b>{sc == null ? '—' : sc.toFixed(1)}</b>
          </span>
          <span>
            龙 / 强 / 区
            <b>
              <i className="sc-dragon">{tiers.dragon}</i>
              <i className="faint"> / </i>
              <i className="sc-solid">{tiers.solid}</i>
              <i className="faint"> / </i>
              <i className="sc-qu">{tiers.qu}</i>
            </b>
          </span>
        </div>
      </div>
    )
  }
  const a = Math.round(wp * 100)
  return (
    <div className="odds">
      {side(A, 0)}
      <div className="odds-mid" title="按两队平均 ELO 估算，和复盘页的「赛前预期」同一算法">
        <div className="p">赛前胜率</div>
        <div className="w mono">
          <span className="t0">{a}%</span>
          <span className="faint"> : </span>
          <span className="t1">{100 - a}%</span>
        </div>
        <span className="track">
          <i style={{ width: a + '%' }} />
          <i />
        </span>
        <div className="note">按平均 ELO</div>
      </div>
      {side(B, 1)}
    </div>
  )
}

/** 一队的平均 ELO 和平均龙区分，算好了才显示 */
function TeamAvg({ list }: { list: PlayerCard[] }): React.JSX.Element | null {
  const elos = list.map((c) => c.info?.elo).filter((v): v is number => v != null)
  const scores = list.map((c) => c.dragon?.value).filter((v): v is number => v != null)
  if (!elos.length && !scores.length) return null
  const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length
  return (
    <span className="avg">
      {!!elos.length && <>ELO {Math.round(avg(elos))}</>}
      {!!scores.length && (
        <>
          {elos.length ? '  ·  ' : ''}平均
          <b className="sc-min">{avg(scores).toFixed(1)}</b>
        </>
      )}
    </span>
  )
}
