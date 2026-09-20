// 玩家详情：4.0.x 里「粗查」和「龙区分」两个窗口的内容合在一起。
// 龙区分那一块照着 4.0.3 的面板做：大号分数 + 分档药丸、区→龙 渐变横条、四条分项、原因、最近 20 场。
// 30 分钟内查过的直接读本地库，不会再发请求；要强制重查点「重新查询」。
import { useEffect, useState } from 'react'
import type { Bond, PlayerCard } from '@shared/ipc'
import type { DragonRow } from '@shared/dragon'
import { scoreColor } from '../current/PlayerRow'
import Mark from '../../components/Mark'

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

/** 分档文案沿用 4.0.3（名单行那个方块徽章是另一套，只有一个字） */
const TIER_LABEL: Record<string, string> = {
  dragon: '🐉 真龙',
  solid: '有龙样',
  average: '泯然众人',
  weak: '有点区',
  qu: '纯区'
}

/** 四个分项，固定这个顺序 */
const PARTS: { key: string; name: string }[] = [
  { key: 'kd', name: '分值 K/D' },
  { key: 'contrib', name: '摧毁贡献' },
  { key: 'obj', name: '占点贡献' },
  { key: 'outcome', name: '胜负预期' }
]

const num = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString('zh-CN'))
/** 1~10 的分数 → 横条上的位置（%） */
const posOf = (v: number): number => Math.max(0, Math.min(100, ((v - 1) / 9) * 100))
/** 百分位（0~1）→ 颜色：明显好绿、明显差红，中间留白，不然满屏是色 */
/** 胜率：60% 以上绿、40% 以下红 */
const winColor = (v: number | null | undefined): string =>
  v == null ? 'var(--dim)' : v >= 60 ? 'var(--good)' : v <= 40 ? 'var(--bad)' : 'var(--text)'
/** K/D：1.2 以上绿、0.8 以下红 */
const kdColor = (v: number | null | undefined): string =>
  v == null ? 'var(--dim)' : v >= 1.2 ? 'var(--good)' : v <= 0.8 ? 'var(--bad)' : 'var(--text)'
const partColor = (v: number | null | undefined): string =>
  v == null ? 'var(--dim)' : v >= 0.62 ? 'var(--good)' : v <= 0.38 ? 'var(--bad)' : 'var(--text)'

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
  const roleList = roles
    ? Object.keys(ROLE_NAME)
        .map((k) => [k, (roles as unknown as Record<string, number>)[k] || 0] as const)
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
    : []

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
        {/* 龙区分：通栏，老版 4.0.3 的面板 */}
        <section className="wide dgpanel">
          {d ? (
            <>
              <div className="dg-head">
                <div className="dg-score">
                  <span className="dg-num" style={{ color: scoreColor(d.value) }}>
                    {d.value.toFixed(1)}
                  </span>
                  <span
                    className="dg-tier"
                    style={{ color: scoreColor(d.value), borderColor: scoreColor(d.value) }}
                  >
                    {TIER_LABEL[d.tier] || d.tier}
                  </span>
                </div>
                <div className="dg-meta">
                  <div className="dg-line">
                    最近 {d.matchCount} 场排位 · 可能范围 {d.range[0].toFixed(1)}~{d.range[1].toFixed(1)} · 胜率{' '}
                    <b style={{ color: partColor(d.parts.outcome) }}>{Math.round(d.summary.winRate * 100)}%</b>
                    （按 ELO 预期 {Math.round(d.summary.avgExpected * 100)}%）
                  </div>
                  <div className="dg-line">
                    {roles && roles.known === false
                      ? '角色：没有兵种数据，按全体玩家的平均构成计算'
                      : '角色：' +
                        roleList
                          .filter(([, v]) => v >= 5)
                          .map(([k, v]) => ROLE_NAME[k] + ' ' + v + '%')
                          .join(' · ')}
                  </div>
                </div>
              </div>

              {/* 区 → 龙 的渐变横条，上面叠可能范围带和当前分数的指针 */}
              <div className="dg-meter">
                <span className="dg-end lo">区</span>
                <div className="dg-track">
                  <div
                    className="dg-range"
                    style={{
                      left: posOf(d.range[0]) + '%',
                      width: Math.max(0, posOf(d.range[1]) - posOf(d.range[0])) + '%'
                    }}
                    title={'可能范围 ' + d.range[0].toFixed(1) + '~' + d.range[1].toFixed(1)}
                  />
                  <div
                    className="dg-ind"
                    style={{ left: posOf(d.value) + '%' }}
                    title={'龙区分 ' + d.value.toFixed(1)}
                  />
                </div>
                <span className="dg-end hi">龙</span>
              </div>

              <div className="dg-parts">
                {PARTS.map(({ key, name }) => {
                  const v = d.parts[key]
                  return (
                    <div className="dg-part" key={key}>
                      <span className="dg-part-name">{name}</span>
                      <span className="dg-bar" title="50 = 同条件玩家里的普通水平">
                        <i style={{ width: (v == null ? 0 : Math.round(v * 100)) + '%' }} />
                      </span>
                      <b style={{ color: partColor(v) }}>{v == null ? '—' : Math.round(v * 100)}</b>
                    </div>
                  )
                })}
              </div>

              {/* 兵种使用率：通栏一条，放在四个分项下面（这也是重要数据） */}
              {!!roleList.length && (
                <div className="rolewrap">
                  <div className="rolebar tall">
                    {roleList.map(([k, v]) => (
                      <i key={k} style={{ width: v + '%', background: ROLE_COLOR[k] }} title={ROLE_NAME[k] + ' ' + v + '%'}>
                        {v >= 7 ? v + '%' : ''}
                      </i>
                    ))}
                  </div>
                  <div className="legend">
                    {roleList.map(([k, v]) => (
                      <span key={k}>
                        <i style={{ background: ROLE_COLOR[k] }} />
                        {ROLE_NAME[k]} {v}%
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!!d.reasons.length && (
                <ul className="dg-reasons">
                  {d.reasons.slice(0, 6).map((r) => (
                    <li key={r.key} className={r.weight > 0 ? 'good' : r.weight < 0 ? 'bad' : 'flat'}>
                      {reasonText(r.key, r.params)}
                    </li>
                  ))}
                </ul>
              )}

              {/* 档案 + 地图表现：不单独开卡片，融进这个面板，排在战绩表上面 */}
              <div className="dg-sub">
                <div className="dg-sub-col">
                  <h4>档案</h4>
                  {info ? (
                    <>
                      <div className="kv">
                        <div>
                          <b>{info.elo != null ? Math.round(info.elo) : '—'}</b>
                          <span>ELO</span>
                        </div>
                        <div>
                          <b style={{ color: winColor(info.winRate) }}>{info.winRate}%</b>
                          <span>
                            胜率（{info.wins}胜 {info.losses}负）
                          </span>
                        </div>
                        <div>
                          <b>{info.matchCount}</b>
                          <span>统计局数</span>
                        </div>
                        <div>
                          <b style={{ color: kdColor(d?.summary.kdAgg ?? info.kd) }}>
                            {d?.summary.kdAgg ?? info.kd ?? '—'}
                          </b>
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
                          {info.categories
                            .map((c) => (CAT_NAME[c.key] || c.key) + ' ' + Math.round(c.pct) + '%')
                            .join(' · ')}
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
                </div>
                {!!info?.mapStats.length && (
                  <div className="dg-sub-col">
                    <h4>地图表现</h4>
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
                            <td style={{ color: winColor(m.winRate) }}>{Math.round(m.winRate)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {!!d.rows.length && (
                <table className="t dg-rows">
                  <thead>
                    <tr>
                      <th />
                      <th>结果</th>
                      <th>地图</th>
                      <th>时长</th>
                      <th>预期胜率</th>
                      <th>K/D</th>
                      <th>摧毁</th>
                      <th>ELO</th>
                      <th>单场</th>
                      <th />
                      <th>对局ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r: DragonRow) => (
                      <tr key={r.fid}>
                        <td>
                          <Mark tier={r.mark} />
                        </td>
                        <td className={r.won == null ? 'dim' : r.won ? 'w' : 'l'}>
                          {r.won == null ? '—' : r.won ? '胜' : '负'}
                        </td>
                        <td>{r.map || '—'}</td>
                        <td className="dim">{Math.round(r.minutes)}′</td>
                        <td className="dim">{Math.round(r.expected * 100)}%</td>
                        <td>{r.kd.toFixed(2)}</td>
                        <td>{r.contrib != null ? r.contrib.toFixed(2) + '×' : '—'}</td>
                        <td style={{ color: (r.eloDelta ?? 0) >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                          {r.eloDelta != null ? (r.eloDelta > 0 ? '+' : '') + r.eloDelta.toFixed(2) : '—'}
                        </td>
                        <td>
                          <b style={{ color: scoreColor(r.score) }}>{r.score.toFixed(1)}</b>
                        </td>
                        <td className="dim dg-flags">
                          {[r.conscript ? '壮丁' : '', r.minutes < 10 ? '短局' : ''].filter(Boolean).join(' ')}
                        </td>
                        <td
                          className="dim dg-fid"
                          title="在 BATrace 上打开这一局"
                          onClick={() => window.BA.openExternal('https://app.batrace.top/match/' + r.fid)}
                        >
                          {r.fid}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="empty">{card.dragonState === 'loading' ? '正在算…' : '没有排位局，算不出龙区分'}</div>
          )}
        </section>

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
    overperform: `胜率 ${p.win}%，高于 ELO 预期的 ${p.exp}%，打得比匹配到的对手好`,
    underperform: `胜率 ${p.win}%，低于 ELO 预期的 ${p.exp}%`,
    underdog: `对手平均更强，预期胜率只有 ${p.exp}%`,
    conscript: `有 ${p.n} 场是被大佬带 / 被拉去填坑`,
    afkGames: `有 ${p.n} 场掉线或挂机`,
    shortGames: `有 ${p.n} 场很短`,
    roleUnknown: '没有生涯兵种数据，角色构成按全体平均算',
    fewMatches: `只有 ${p.n} 场排位，分数不太稳`
  }
  return T[key] || key
}
