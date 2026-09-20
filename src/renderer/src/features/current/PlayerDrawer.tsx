// 玩家详情：一个窗口把该看的都放进去——龙区分和它的可能范围、分项百分位、角色构成、
// 基础档案、最爱单位、地图表现、最近对局。4.0.x 分成两个窗口，这里合并。
import { useEffect, useState } from 'react'
import type { PlayerCard } from '@shared/ipc'
import { scoreColor } from './PlayerRow'

const ROLE_NAME: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼'
}
const CAT_NAME: Record<string, string> = {
  recon: '侦察', infantry: '步兵', vehicles: '载具', support: '支援', logistic: '后勤',
  helicopters: '直升机', aircrafts: '固定翼'
}
const PART_NAME: Record<string, string> = { kd: 'K/D', contrib: '摧毁贡献', obj: '占点', outcome: '胜负' }
const TIER_TEXT: Record<string, string> = { dragon: '龙', solid: '强', average: '中', weak: '弱', qu: '区' }

const pctText = (p: number | null | undefined): string => (p == null ? '—' : '第 ' + Math.round(p * 100) + ' 百分位')

export default function PlayerDrawer({
  card,
  onClose,
  onRefresh
}: {
  card: PlayerCard
  onClose: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const d = card.dragon
  const info = card.info
  const roles = d?.roles
  return (
    <div className="drawer" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="grow">{card.name || card.id}</h3>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onRefresh()
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '查询中…' : '重新查询'}
          </button>
          <button onClick={() => window.BA.openExternal('https://app.batrace.top/player/' + card.id)}>
            BATrace
          </button>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="dim" style={{ marginBottom: 10 }}>
          ID {card.id}
          {card.updatedAt ? ' · ' + new Date(card.updatedAt).toLocaleString('zh-CN') + ' 算的' : ''}
        </div>

        {d ? (
          <div className="card">
            <div className="row" style={{ alignItems: 'baseline' }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: scoreColor(d.value) }}>{d.value.toFixed(1)}</div>
              <div>
                <b>{TIER_TEXT[d.tier] || d.tier}</b>
                <div className="dim">
                  可能范围 {d.range[0].toFixed(1)}–{d.range[1].toFixed(1)} · 最近 {d.matchCount} 场排位
                </div>
              </div>
            </div>
            <div className="kv">
              {Object.entries(d.parts).map(([k, v]) => (
                <div key={k}>
                  <b>{pctText(v)}</b>
                  <span>{PART_NAME[k] || k}</span>
                </div>
              ))}
            </div>
            {roles && (
              <div className="dim" style={{ fontSize: 12 }}>
                兵种构成：
                {Object.keys(ROLE_NAME)
                  .map((k) => [k, (roles as Record<string, number>)[k] || 0] as const)
                  .filter(([, v]) => v >= 3)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => ROLE_NAME[k] + ' ' + v + '%')
                  .join(' · ')}
                {roles.known === false && '（没有生涯数据，按全体平均算的）'}
              </div>
            )}
            {!!d.reasons.length && (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {d.reasons.slice(0, 4).map((r) => (
                  <li key={r.key} className="dim">
                    {reasonText(r.key, r.params)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="card dim">
            {card.dragonState === 'loading' ? '正在算龙区分…' : '没有排位局，算不出龙区分'}
          </div>
        )}

        {info && (
          <div className="card">
            <h2>档案</h2>
            <div className="kv">
              <div>
                <b>{info.elo != null ? Math.round(info.elo) : '—'}</b>
                <span>ELO</span>
              </div>
              <div>
                <b>{info.winRate}%</b>
                <span>
                  胜率（{info.wins}胜 {info.losses}负）
                </span>
              </div>
              <div>
                <b>{info.matchCount}</b>
                <span>统计局数</span>
              </div>
              <div>
                <b>{info.kd ?? '—'}</b>
                <span>最近 K/D</span>
              </div>
            </div>
            {!!info.categories.length && (
              <div className="dim" style={{ fontSize: 12 }}>
                花费偏好：
                {info.categories.map((c) => (CAT_NAME[c.key] || c.key) + ' ' + Math.round(c.pct) + '%').join(' · ')}
              </div>
            )}
            {!!info.favUnits.length && (
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                最爱单位：{info.favUnits.map((u) => u.name + '（' + u.spawn + ' 次）').join('、')}
              </div>
            )}
          </div>
        )}

        {!!info?.recentMatches.length && (
          <div className="card">
            <h2>最近对局</h2>
            <table className="t">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>结果</th>
                  <th>ELO</th>
                  <th>K/D</th>
                  <th>摧毁</th>
                  <th>损失</th>
                </tr>
              </thead>
              <tbody>
                {info.recentMatches.map((m) => (
                  <tr key={String(m.matchId)}>
                    <td>{m.endTime ? new Date(m.endTime * 1000).toLocaleDateString('zh-CN') : '—'}</td>
                    <td style={{ color: m.win ? 'var(--good)' : 'var(--bad)' }}>{m.win ? '胜' : '负'}</td>
                    <td>{m.eloDelta != null ? (m.eloDelta > 0 ? '+' : '') + m.eloDelta : '—'}</td>
                    <td>{m.kd != null ? m.kd.toFixed(2) : '—'}</td>
                    <td>{Math.round(m.destruction)}</td>
                    <td>{Math.round(m.losses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** 龙区分的解释文案 */
function reasonText(key: string, p: Record<string, unknown>): string {
  const T: Record<string, string> = {
    kdHigh: `K/D 中位 ${p.kd}，在同条件玩家里排第 ${p.p} 百分位`,
    kdLowFront: `K/D 中位 ${p.kd}，打正面的人里偏低（第 ${p.p} 百分位）`,
    kdLowSupport: `K/D 中位 ${p.kd}，同类玩家里偏低（第 ${p.p} 百分位）`,
    contribHigh: `摧毁贡献是队友人均的 ${p.x} 倍`,
    contribLow: `摧毁贡献只有队友人均的 ${p.x} 倍`,
    overperform: `胜率 ${p.win}%，比 ELO 预期的 ${p.exp}% 高`,
    underperform: `胜率 ${p.win}%，比 ELO 预期的 ${p.exp}% 低`,
    underdog: `对手平均更强，预期胜率只有 ${p.exp}%`,
    conscript: `有 ${p.n} 场是被大佬带/被拉去填坑`,
    afkGames: `有 ${p.n} 场掉线或挂机`,
    shortGames: `有 ${p.n} 场很短`,
    roleUnknown: '没有生涯兵种数据，角色构成按全体平均算',
    fewMatches: `只有 ${p.n} 场排位，分数不太稳`
  }
  return T[key] || key
}
