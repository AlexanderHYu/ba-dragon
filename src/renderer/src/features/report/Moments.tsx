// 关键时刻：高光、犯罪、大量阵亡、侦察。默认显示全场最重要的几条，点上面的玩家只看他的。
// 点一条跳到时间线；这一局有录像的话直接跳到视频里对应的时间。
import { IconAlertTriangle, IconEye, IconFlame, IconSkull, type Icon as TablerIcon } from '@tabler/icons-react'
import { clock, topMoments, type MatchReport, type Moment, type MomentKind } from '@shared/match'
import Ico from '../../components/Icon'

export const KIND: Record<MomentKind, { label: string; icon: TablerIcon; cls: string }> = {
  highlight: { label: '高光', icon: IconFlame, cls: 'mk-hl' },
  blunder: { label: '犯罪', icon: IconSkull, cls: 'mk-bl' },
  wipe: { label: '大量阵亡', icon: IconAlertTriangle, cls: 'mk-wp' },
  recon: { label: '侦察', icon: IconEye, cls: 'mk-rc' }
}

/** 按筛选取要显示的时刻：null = 全场重点；玩家 id = 他的全部高光、犯罪、侦察（含次要的侦察出兵） */
export function momentsFor(r: MatchReport, focus: string | null): Moment[] {
  if (!focus) return topMoments(r.moments)
  return r.moments.filter((m) => m.pid === focus).sort((a, b) => a.t0 - b.t0)
}

export function MomentFilter({
  r,
  focus,
  onFocus
}: {
  r: MatchReport
  focus: string | null
  onFocus: (pid: string | null) => void
}): React.JSX.Element {
  // 每个人有几条（不算次要的侦察出兵），没有的人也列出来，点了显示「没有」
  const count = (pid: string): number => r.moments.filter((m) => m.pid === pid && !m.minor).length
  return (
    <div className="mo-filter">
      <button className={focus == null ? 'active' : ''} onClick={() => onFocus(null)}>
        全场重点
      </button>
      {[0, 1].map((t) => (
        <span key={t} className={'mo-team t' + t}>
          {r.players
            .filter((p) => p.team === t)
            .map((p) => (
              <button
                key={p.id}
                className={(focus === p.id ? 'active ' : '') + (count(p.id) ? '' : 'none')}
                onClick={() => onFocus(focus === p.id ? null : p.id)}
                title={count(p.id) ? count(p.id) + ' 条' : '这一局没有他的关键时刻'}
              >
                {p.name}
                {!!count(p.id) && <em>{count(p.id)}</em>}
              </button>
            ))}
        </span>
      ))}
    </div>
  )
}

export function MomentList({
  list,
  onPick,
  empty
}: {
  list: Moment[]
  onPick?: (m: Moment) => void
  empty: string
}): React.JSX.Element {
  if (!list.length) return <div className="mo-empty">{empty}</div>
  return (
    <ul className="mo-list">
      {list.map((m, i) => {
        const k = KIND[m.kind]
        return (
          <li
            key={i}
            className={k.cls + (m.minor ? ' minor' : '') + (onPick ? ' pick' : '')}
            onClick={onPick ? () => onPick(m) : undefined}
            title={onPick ? '在时间线上查看' : undefined}
          >
            <span className="mo-time mono">
              {clock(m.t0)}
              {m.t1 - m.t0 >= 5 ? '–' + clock(m.t1) : ''}
            </span>
            <span className="mo-kind">
              <Ico i={k.icon} size={14} />
              {k.label}
            </span>
            <span className="mo-text">
              <span className={'mo-edge t' + m.team} />
              {m.text}
              {m.detail && <small>{m.detail}</small>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
