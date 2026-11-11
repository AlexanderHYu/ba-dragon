// 玩家详情：左边档案卡（龙区分、可能范围、在同分段里的位置、分项、档案数字），
// 右边和你的羁绊、兵种构成、原因、常用单位、地图表现、最近 20 场。
// 30 分钟内查过的直接读本地库，不会再发请求；要强制重查点「重新查询」。
import { useEffect, useState } from 'react'
import { IconAlertTriangle, IconCopy, IconExternalLink, IconRefresh } from '@tabler/icons-react'
import type { Bond, PlayerCard } from '@shared/ipc'
import { MODEL, to10, type DragonRow } from '@shared/dragon'
import { goodBad, scoreColor } from '../../components/scoreColor'
import Mark from '../../components/Mark'
import Ico from '../../components/Icon'

const ROLE_NAME: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼'
}
/** 兵种颜色：避开蓝、红、金 */
const ROLE_COLOR: Record<string, string> = {
  armor: 'var(--r-armor)', inf: 'var(--r-inf)', recon: 'var(--r-recon)', arty: 'var(--r-arty)',
  aa: 'var(--r-aa)', heli: 'var(--r-heli)', jet: 'var(--r-jet)'
}
const CAT_NAME: Record<string, string> = {
  recon: '侦察', infantry: '步兵', vehicles: '载具', support: '支援', logistic: '后勤',
  helicopters: '直升机', aircrafts: '固定翼'
}

/** 分档文案沿用 4.0.3（名单行那个方块徽章是另一套，只有一个字） */
const TIER_LABEL: Record<string, string> = {
  dragon: '真龙',
  solid: '有龙样',
  average: '泯然众人',
  weak: '有点区',
  qu: '纯区'
}

/** 分项，固定这个顺序（胜负预期不计分时没有值，不显示） */
const PARTS: { key: string; name: string }[] = [
  { key: 'kd', name: '分值 K/D' },
  { key: 'contrib', name: '摧毁贡献' },
  { key: 'obj', name: '占点贡献' },
  { key: 'outcome', name: '胜负预期' }
]

const num = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString('zh-CN'))
/** 1~10 的分数 → 刻度上的位置（%） */
const posOf = (v: number): number => Math.max(0, Math.min(100, ((v - 1) / 9) * 100))
const winCls = (v: number | null | undefined): string => goodBad(v, 60, 40)
const kdCls = (v: number | null | undefined): string => goodBad(v, 1.2, 0.8)
const partCls = (v: number | null | undefined): string => goodBad(v, 0.62, 0.38)

/**
 * 同分段位置刻度的五段：龙区分是同分段、同角色玩家里的百分位，所以这些人在 1~10 上均匀分布，
 * 每一段的宽度就是这一档的人数占比。分段线直接取模型的分档阈值，和徽章的判定一致。
 */
const BANDS: { tier: string; lo: number; hi: number }[] = (() => {
  const t = [...MODEL.tiers].sort((a, b) => a[0] - b[0]) // 从低到高
  return t.map(([p, tier], i) => ({ tier, lo: to10(p), hi: i + 1 < t.length ? to10(t[i + 1][0]) : 10 }))
})()

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
  const kd = d?.summary.kdAgg ?? info?.kd ?? null

  return (
    <div className="pdetail">
      {/* ---------- 左：档案卡 ---------- */}
      <div className="card pd-profile">
        <div className="pd-name">{card.name || card.id}</div>
        <div className="pd-id mono">
          ID {card.id}
          {card.level != null && ' · Lv.' + card.level}
        </div>
        {bond && bond.names.length > 1 && <div className="pd-id">曾用名：{bond.names.filter((n) => n !== card.name).join('、')}</div>}

        {d ? (
          <>
            <div className="pd-big">
              <Mark tier={d.tier} big />
              <span className="pd-num mono" style={{ color: scoreColor(d.value, d.tier) }}>
                {d.value.toFixed(1)}
              </span>
              <span className="pd-tier">
                {TIER_LABEL[d.tier] || d.tier}
                <small className="mono">
                  可能范围 {d.range[0].toFixed(1)} – {d.range[1].toFixed(1)}
                </small>
              </span>
            </div>

            {/* 同分段位置刻度：五段分档 + 可能范围 + 指针 */}
            <div className="pd-scale-cap">同分段、同兵种构成的玩家里的位置</div>
            <div className="pd-scale" title={'龙区分 ' + d.value.toFixed(1) + '，可能范围 ' + d.range[0].toFixed(1) + '~' + d.range[1].toFixed(1)}>
              {BANDS.map((b) => (
                <i
                  key={b.tier}
                  className={'band ' + b.tier}
                  style={{ left: posOf(b.lo) + '%', width: posOf(b.hi) - posOf(b.lo) + '%' }}
                  title={(TIER_LABEL[b.tier] || b.tier) + '：' + b.lo.toFixed(1) + '~' + b.hi.toFixed(1)}
                />
              ))}
              <i
                className="range"
                style={{ left: posOf(d.range[0]) + '%', width: Math.max(0.5, posOf(d.range[1]) - posOf(d.range[0])) + '%' }}
              />
              <i className="ind" style={{ left: posOf(d.value) + '%' }} />
            </div>
            <div className="pd-scale-ticks mono">
              {BANDS.map((b) => (
                <span key={b.tier} style={{ left: posOf(b.lo) + '%' }}>
                  {b.lo === 1 ? '1' : b.lo.toFixed(1)}
                </span>
              ))}
              <span style={{ left: '100%' }}>10</span>
            </div>

            <div className="dg-parts">
              {PARTS.filter(({ key }) => key !== 'outcome' || d.parts[key] != null).map(({ key, name }) => {
                const v = d.parts[key]
                return (
                  <div className="dg-part" key={key}>
                    <span className="dg-part-name">{name}</span>
                    <span className="dg-bar" title="50 为同条件玩家的平均水平">
                      <i style={{ width: (v == null ? 0 : Math.round(v * 100)) + '%' }} />
                    </span>
                    <b className={'mono ' + partCls(v)}>{v == null ? '—' : Math.round(v * 100)}</b>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="empty">{card.dragonState === 'loading' ? '计算中…' : '无排位对局，无法计算龙区分'}</div>
        )}

        {info ? (
          <div className="kv">
            <div>
              <b>{info.elo != null ? Math.round(info.elo) : '—'}</b>
              <span>ELO</span>
            </div>
            <div>
              <b className={kdCls(kd)}>{kd ?? '—'}</b>
              <span>{d ? '近 ' + d.matchCount + ' 场 K/D' : 'K/D'}</span>
            </div>
            <div>
              <b className={winCls(info.winRate)}>{info.winRate}%</b>
              <span>
                胜率（{info.wins} 胜 {info.losses} 负）
              </span>
            </div>
            <div>
              <b>{info.dmr ?? '—'}</b>
              <span>伤害交换比</span>
            </div>
          </div>
        ) : (
          <div className="empty">{card.infoState === 'loading' ? '查询中…' : card.error || '无档案'}</div>
        )}
        {d && (
          <div className="pd-note">
            最近 {d.matchCount} 场排位胜率 {Math.round(d.summary.winRate * 100)}%，按 ELO 预期{' '}
            {Math.round(d.summary.avgExpected * 100)}%
          </div>
        )}

        <div className="row wrap" style={{ marginTop: 12 }}>
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
            <Ico i={IconRefresh} />
            {busy ? '查询中…' : '重新查询'}
          </button>
          <button onClick={() => void navigator.clipboard.writeText(card.id)}>
            <Ico i={IconCopy} />
            复制 ID
          </button>
          <button onClick={() => window.BA.openExternal('https://dash.batrace.top/player/' + card.id)}>
            <Ico i={IconExternalLink} />
            BATrace
          </button>
        </div>
        {card.updatedAt && (
          <div className="pd-note">更新于 {new Date(card.updatedAt).toLocaleString('zh-CN')}</div>
        )}
      </div>

      {/* ---------- 右 ---------- */}
      <div className="pd-right">
        {bond && bond.matches > 0 && (
          <div className="card flush">
            <h2>
              和你的羁绊<span className="sub">本地记录 · 共同对局 {bond.matches} 局</span>
            </h2>
            <div className="pd-bond">
              <div>
                <span>同队时</span>
                <b>
                  {bond.withWin} 胜 {bond.withLose} 负
                </b>
              </div>
              <div>
                <span>敌对时（你的战绩）</span>
                <b>
                  {bond.vsWin} 胜 {bond.vsLose} 负
                </b>
              </div>
              <div>
                <span>他的平均单局分</span>
                <b>{bond.avgScore ?? '—'}</b>
              </div>
              <div>
                <span>首次相遇</span>
                <b>{bond.firstSeen ? new Date(bond.firstSeen).toLocaleDateString('zh-CN') : '—'}</b>
              </div>
            </div>
            {bond.banned && (
              <div className="banner err" style={{ margin: 0, borderWidth: '1px 0 0' }}>
                <Ico i={IconAlertTriangle} />
                在 BATrace 封禁名单中
              </div>
            )}
          </div>
        )}

        {d && (!!roleList.length || !!d.reasons.length) && (
          <div className="card">
            <h2>
              兵种构成与评分依据
              {roles && roles.known === false && <span className="sub">无兵种数据，按全体玩家平均构成计算</span>}
            </h2>
            {!!roleList.length && (
              <div className="rolewrap">
                <div className="rolebar">
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
          </div>
        )}

        {info && (!!info.favUnits.length || !!info.mapStats.length) && (
          <div className="cols even">
            {!!info.favUnits.length && (
              <div className="card flush">
                <h2>
                  常用单位
                  {!!info.categories.length && (
                    <span className="sub">
                      {info.categories
                        .slice(0, 3)
                        .map((c) => (CAT_NAME[c.key] || c.key) + ' ' + Math.round(c.pct) + '%')
                        .join(' · ')}
                    </span>
                  )}
                </h2>
                <table className="t">
                  <thead>
                    <tr>
                      <th>单位</th>
                      <th>出场</th>
                      <th>伤害</th>
                      <th title="平均每点花费的收益">回报</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.favUnits.map((u) => (
                      <tr key={u.name}>
                        <td className="pd-text">{u.name}</td>
                        <td>{u.spawn}</td>
                        <td>{num(u.val)}</td>
                        <td>{u.roi ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!!info.mapStats.length && (
              <div className="card flush">
                <h2>地图表现</h2>
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
                        <td className="pd-text">{m.name}</td>
                        <td>{m.matchCount}</td>
                        <td className={winCls(m.winRate)}>{Math.round(m.winRate)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {d && !!d.rows.length && (
          <div className="card flush">
            <h2>
              最近 {d.rows.length} 场排位<span className="sub">龙区分就是用这些局算的</span>
            </h2>
            <table className="t dg-rows">
              <thead>
                <tr>
                  <th>单场</th>
                  <th>结果</th>
                  <th>地图</th>
                  <th>时长</th>
                  <th>预期胜率</th>
                  <th>K/D</th>
                  <th>摧毁</th>
                  <th>ELO</th>
                  <th />
                  <th>对局</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r: DragonRow) => (
                  <tr key={r.fid}>
                    <td>
                      <span className="pd-score">
                        <Mark tier={r.mark} />
                        <span style={{ color: scoreColor(r.score, r.mark) }}>{r.score.toFixed(1)}</span>
                      </span>
                    </td>
                    <td>
                      {r.won == null ? (
                        <span className="faint">—</span>
                      ) : (
                        <span className={r.won ? 'res-win' : 'res-loss'}>{r.won ? '胜' : '负'}</span>
                      )}
                    </td>
                    <td className="pd-text">{r.map || '—'}</td>
                    <td className="dim">{Math.round(r.minutes)} 分</td>
                    <td className="dim">{Math.round(r.expected * 100)}%</td>
                    <td className={kdCls(r.kd)}>{r.kd.toFixed(2)}</td>
                    <td>{r.contrib != null ? r.contrib.toFixed(2) + '×' : '—'}</td>
                    <td className={r.eloDelta == null || r.eloDelta === 0 ? '' : r.eloDelta > 0 ? 'pos' : 'neg'}>
                      {r.eloDelta != null ? (r.eloDelta > 0 ? '+' : r.eloDelta < 0 ? '−' : '') + Math.abs(r.eloDelta).toFixed(1) : '—'}
                    </td>
                    <td className="dim dg-flags">
                      {[r.conscript ? '壮丁' : '', r.minutes < 10 ? '短局' : ''].filter(Boolean).join(' ')}
                    </td>
                    <td
                      className="faint dg-fid"
                      title="在 BATrace 中打开本局"
                      onClick={() => window.BA.openExternal('https://dash.batrace.top/match/' + r.fid)}
                    >
                      {r.fid}
                    </td>
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
    kdHigh: `K/D 中位数 ${p.kd}，同条件玩家中第 ${p.p} 百分位`,
    kdLowFront: `K/D 中位数 ${p.kd}，正面兵种玩家中偏低（第 ${p.p} 百分位）`,
    kdLowSupport: `K/D 中位数 ${p.kd}，同类玩家中偏低（第 ${p.p} 百分位）`,
    contribHigh: `摧毁贡献为队友人均的 ${p.x} 倍`,
    contribLow: `摧毁贡献仅为队友人均的 ${p.x} 倍`,
    overperform: `胜率 ${p.win}%，高于 ELO 预期的 ${p.exp}%`,
    underperform: `胜率 ${p.win}%，低于 ELO 预期的 ${p.exp}%`,
    underdog: `对手平均更强，预期胜率仅 ${p.exp}%`,
    conscript: `${p.n} 场为壮丁局（被高分玩家带或临时补位）`,
    afkGames: `${p.n} 场掉线或挂机`,
    shortGames: `${p.n} 场为短局`,
    roleUnknown: '无生涯兵种数据，角色构成按全体平均计算',
    fewMatches: `仅 ${p.n} 场排位，分数可能不稳定`
  }
  return T[key] || key
}
