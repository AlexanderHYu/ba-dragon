// 玩家详情：4.0.x 里「粗查」和「龙区分」两个窗口的内容合在一起。
// 30 分钟内查过的直接读本地库，不会再发请求；要强制重查点「重新查询」。
import { useEffect, useState } from 'react'
import type { Bond, PlayerCard } from '@shared/ipc'
import { scoreColor } from '../current/PlayerRow'

const ROLE_NAME: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼'
}
const ROLE_COLOR: Record<string, string> = {
  armor: '#6e9bd8', inf: '#63b06a', recon: '#c9a227', arty: '#d07b3f', aa: '#b06ec4', heli: '#4bb3ad', jet: '#d1607a'
}
const CAT_NAME: Record<string, string> = {
  recon: '侦察', infantry: '步兵', vehicles: '载具', support: '支援', logistic: '后勤',
  helicopters: '直升机', aircrafts: '固定翼'
}
const PART_NAME: Record<string, string> = { kd: 'K/D', contrib: '摧毁贡献', obj: '占点', outcome: '胜负' }
const TIER_TEXT: Record<string, string> = { dragon: '龙', solid: '强', average: '中', weak: '弱', qu: '区' }
const pctText = (p: number | null | undefined): string => (p == null ? '—' : '第 ' + Math.round(p * 100) + ' 百分位')
const num = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString('zh-CN'))

export default function PlayerDetail({
  card,
  onRefresh
}: {
  card: PlayerCard
  onRefresh: () => Promise<void> | void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [bond, setBond] = useState<Bond | null>(null)
  useEffect(() => {
    void window.BA.getBond(card.id).then(setBond)
  }, [card.id])

  const d = card.dragon
  const info = card.info
  const roles = d?.roles

  return (
    <div className="pdetail">
      <div className="row" style={{ marginBottom: 8 }}>
        <b style={{ fontSize: 16 }}>{card.name || card.id}</b>
        <span className="dim">ID {card.id}</span>
        {card.updatedAt && <span className="dim">{new Date(card.updatedAt).toLocaleString('zh-CN')} 算的</span>}
        <span className="grow" />
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
        <button onClick={() => window.BA.openExternal('https://app.batrace.top/player/' + card.id)}>BATrace</button>
      </div>

      <div className="pdetail-grid">
        {/* 龙区分 */}
        <section>
          <h3>龙区分</h3>
          {d ? (
            <>
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
                <>
                  <div className="rolebar">
                    {Object.keys(ROLE_NAME)
                      .map((k) => [k, (roles as unknown as Record<string, number>)[k] || 0] as const)
                      .filter(([, v]) => v > 0)
                      .map(([k, v]) => (
                        <i key={k} style={{ width: v + '%', background: ROLE_COLOR[k] }} title={ROLE_NAME[k] + ' ' + v + '%'}>
                          {v >= 8 ? v + '%' : ''}
                        </i>
                      ))}
                  </div>
                  <div className="legend">
                    {Object.keys(ROLE_NAME).map((k) => (
                      <span key={k}>
                        <i style={{ background: ROLE_COLOR[k] }} />
                        {ROLE_NAME[k]}
                      </span>
                    ))}
                  </div>
                  {roles.known === false && <div className="dim">没有生涯兵种数据，按全体平均算的</div>}
                </>
              )}
              {!!d.reasons.length && (
                <ul className="reasons">
                  {d.reasons.slice(0, 5).map((r) => (
                    <li key={r.key}>{reasonText(r.key, r.params)}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="empty">{card.dragonState === 'loading' ? '正在算…' : '没有排位局，算不出龙区分'}</div>
          )}
        </section>

        {/* 档案 */}
        <section>
          <h3>档案</h3>
          {info ? (
            <>
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
                  <b>{d?.summary.kdAgg ?? info.kd ?? '—'}</b>
                  <span>K/D</span>
                </div>
                <div>
                  <b>{info.dmr ?? '—'}</b>
                  <span>伤害交换比</span>
                </div>
              </div>
              {!!info.categories.length && (
                <div className="dim">
                  花费偏好：
                  {info.categories.map((c) => (CAT_NAME[c.key] || c.key) + ' ' + Math.round(c.pct) + '%').join(' · ')}
                </div>
              )}
              {!!info.favUnits.length && (
                <table className="t" style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>最爱单位</th>
                      <th>出场</th>
                      <th>伤害</th>
                      <th title="平均每点花费打出的收益">回报</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.favUnits.map((u) => (
                      <tr key={u.name}>
                        <td>{u.name}</td>
                        <td>{u.spawn}</td>
                        <td>{num(u.val)}</td>
                        <td>{u.roi ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="empty">{card.infoState === 'loading' ? '正在查…' : card.error || '没有档案'}</div>
          )}
        </section>

        {/* 地图 */}
        {!!info?.mapStats.length && (
          <section>
            <h3>地图表现</h3>
            <table className="t">
              <thead>
                <tr>
                  <th>地图</th>
                  <th>局数</th>
                  <th>胜率</th>
                </tr>
              </thead>
              <tbody>
                {info.mapStats.map((m) => (
                  <tr key={m.mapId}>
                    <td>{m.name}</td>
                    <td>{m.matchCount}</td>
                    <td>{Math.round(m.winRate)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* 羁绊 */}
        {bond && bond.matches > 0 && (
          <section>
            <h3>调查羁绊</h3>
            <div className="kv">
              <div>
                <b>{bond.matches}</b>
                <span>一起打过</span>
              </div>
              <div>
                <b>
                  {bond.withWin} 胜 {bond.withLose} 负
                </b>
                <span>同队时</span>
              </div>
              <div>
                <b>
                  {bond.vsWin} 胜 {bond.vsLose} 负
                </b>
                <span>敌对时（你的战绩）</span>
              </div>
              <div>
                <b>{bond.avgScore ?? '—'}</b>
                <span>他的平均龙区分</span>
              </div>
            </div>
            <div className="dim">
              {bond.firstSeen ? '第一次见：' + new Date(bond.firstSeen).toLocaleDateString('zh-CN') : ''}
              {bond.names.length > 1 ? ' · 用过的名字：' + bond.names.join('、') : ''}
              {bond.banned ? ' · ⚠ 在封禁名单上' : ''}
            </div>
          </section>
        )}

        {/* 最近对局 */}
        {!!info?.recentMatches.length && (
          <section className="wide">
            <h3>最近对局</h3>
            <table className="t">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>结果</th>
                  <th>ELO</th>
                  <th>K/D</th>
                  <th>摧毁</th>
                  <th>损失</th>
                  <th>占点</th>
                </tr>
              </thead>
              <tbody>
                {info.recentMatches.map((m) => (
                  <tr key={String(m.matchId)}>
                    <td>{m.endTime ? new Date(m.endTime * 1000).toLocaleDateString('zh-CN') : '—'}</td>
                    <td style={{ color: m.win ? 'var(--good)' : 'var(--bad)' }}>{m.win ? '胜' : '负'}</td>
                    <td style={{ color: (m.eloDelta ?? 0) > 0 ? 'var(--good)' : 'var(--bad)' }}>
                      {m.eloDelta != null ? (m.eloDelta > 0 ? '+' : '') + m.eloDelta : '—'}
                    </td>
                    <td>{m.kd != null ? m.kd.toFixed(2) : '—'}</td>
                    <td>{num(m.destruction)}</td>
                    <td>{num(m.losses)}</td>
                    <td>{m.objectives}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
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
    conscript: `有 ${p.n} 场是被大佬带 / 被拉去填坑`,
    afkGames: `有 ${p.n} 场掉线或挂机`,
    shortGames: `有 ${p.n} 场很短`,
    roleUnknown: '没有生涯兵种数据，角色构成按全体平均算',
    fewMatches: `只有 ${p.n} 场排位，分数不太稳`
  }
  return T[key] || key
}
