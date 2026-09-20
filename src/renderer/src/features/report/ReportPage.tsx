// 单局复盘：整页版（以前是右侧抽屉）。总览、玩家明细、单位、时间线、本局要点。
// 数字都是主进程算好的（shared/match），这里只负责摆出来。
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { MatchReport, ReportPlayer, ReportUnit } from '@shared/match'
import './report.css'

// 从 current/PlayerRow 复制过来的：复盘页不再依赖对局页的文件。
export function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'var(--dim)'
  if (v >= 8) return 'var(--gold)'
  if (v >= 6.5) return 'var(--good)'
  if (v >= 4) return 'var(--text)'
  if (v >= 2.5) return 'var(--warn)'
  return 'var(--bad)'
}

const ROLE_COLOR: Record<string, string> = {
  armor: '#6e9bd8', inf: '#63b06a', recon: '#c9a227', arty: '#d07b3f',
  aa: '#b06ec4', heli: '#4bb3ad', jet: '#d1607a'
}
const ROLE_NAME: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼'
}
const TITLE_NAME: Record<string, string> = {
  carry: '大腿', blame: '背锅侠', deserter: '掉线狗', tryhard: '带不动', passenger: '躺赢狗', lonewolf: '孤勇者',
  reaper: '收割机', untouched: '保活能手', landlord: '地产大亨', artygod: '大炮兵主义', bandit: '土匪', canteen: '奶妈',
  weightlifter: '举重冠军', killsteal: '抢人头', demolition: '拆迁队', courier: '快递员', refund: '七天无理由退货',
  backstabbed: '被背刺', atm: '开送', scraper: '刮痧师傅', boxed: '落地成盒', camper: '蹲逼', convoy: '运输大队长',
  freeloader: '吃白食', spender: '败家子', traitor: '内鬼', crash: '曼巴out'
}

const num = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString('zh-CN')
const sec = (s: number | null | undefined): string => {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  return m + '′' + String(Math.round(s % 60)).padStart(2, '0') + '″'
}
const teamName = (t: number): string => (t === 0 ? 'A 队' : 'B 队')

const TABS = [
  ['overview', '总览'],
  ['players', '玩家'],
  ['units', '单位'],
  ['timeline', '时间线']
] as const

export default function ReportPage({ fid, onBack }: { fid: string; onBack: () => void }): React.JSX.Element {
  const [report, setReport] = useState<MatchReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'players' | 'units' | 'timeline'>('overview')

  useEffect(() => {
    let alive = true
    setReport(null)
    setError(null)
    void window.BA.getMatchReport(fid).then((r) => {
      if (!alive) return
      if ('error' in r) setError(r.error === 'notYet' ? 'BATrace 还没有这一局的数据，过几分钟再看' : r.error)
      else setReport(r)
    })
    return () => {
      alive = false
    }
  }, [fid])

  return (
    <div className="rp">
      <div className="rp-head">
        <button className="rp-back" onClick={onBack} title="回到上一个页面">
          ← 返回
        </button>
        <h1 className="rp-title">
          复盘 {report?.map || ''} <span className="dim">#{fid}</span>
        </h1>
        <span className="grow" />
        <button
          onClick={() => window.BA.openExternal('https://app.batrace.top/match/' + fid)}
          title="在浏览器里打开 BATrace 的这一局"
        >
          BATrace ↗
        </button>
      </div>
      {!report ? (
        <div className="empty">{error ? error : <>正在算…（第一次要拉一次对局数据）</>}</div>
      ) : (
        <>
          <div className="rp-tabs">
            {TABS.map(([k, label]) => (
              <button key={k} className={'rp-tab' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
            <span className="grow" />
            <span className="dim rp-meta">
              {report.durationSec ? sec(report.durationSec) : ''} ·{' '}
              {report.startTime ? new Date(report.startTime).toLocaleString('zh-CN') : ''}
            </span>
          </div>
          {tab === 'overview' && <Overview r={report} />}
          {tab === 'players' && <Players r={report} />}
          {tab === 'units' && <Units r={report} />}
          {tab === 'timeline' && <Timeline r={report} />}
        </>
      )}
    </div>
  )
}

function RoleBar({ roles, small }: { roles: Record<string, number>; small?: boolean }): React.JSX.Element {
  return (
    <div className="rolebar" style={{ height: small ? 12 : 16 }}>
      {Object.entries(roles)
        .filter(([k, v]) => ROLE_NAME[k] && v > 0)
        .map(([k, v]) => (
          <i key={k} style={{ width: v + '%', background: ROLE_COLOR[k] }} title={ROLE_NAME[k] + ' ' + v + '%'}>
            {v >= 4 ? v + '%' : ''}
          </i>
        ))}
    </div>
  )
}

function RoleLegend(): React.JSX.Element {
  return (
    <div className="legend">
      {Object.keys(ROLE_NAME).map((k) => (
        <span key={k}>
          <i style={{ background: ROLE_COLOR[k] }} />
          {ROLE_NAME[k]}
        </span>
      ))}
    </div>
  )
}

function Overview({ r }: { r: MatchReport }): React.JSX.Element {
  const [A, B] = r.teams
  const row = (label: string, a: React.ReactNode, b: React.ReactNode, tip?: string): React.JSX.Element => (
    <tr key={label}>
      <td style={{ textAlign: 'right' }}>{a}</td>
      <th style={{ textAlign: 'center' }} title={tip} className={tip ? 'tip' : ''}>
        {label}
      </th>
      <td style={{ textAlign: 'left' }}>{b}</td>
    </tr>
  )
  return (
    <>
      <div className="card">
        <div className="rp-vs">
          <table className="t vs">
            <thead>
              <tr>
                <th style={{ textAlign: 'right' }} className="t0">
                  {teamName(0)} {A.faction ? (A.faction === 'RU' ? '（俄）' : '（美）') : ''}
                  {A.won && ' 🏆'}
                </th>
                <th />
                <th style={{ textAlign: 'left' }} className="t1">
                  {teamName(1)} {B.faction ? (B.faction === 'RU' ? '（俄）' : '（美）') : ''}
                  {B.won && ' 🏆'}
                </th>
              </tr>
            </thead>
            <tbody>
              {row('平均 ELO', num(A.avgElo), num(B.avgElo))}
              {row(
                '赛前预期胜率',
                A.expected != null ? Math.round(A.expected * 100) + '%' : '—',
                B.expected != null ? Math.round(B.expected * 100) + '%' : '—',
                '按两队在线队员的赛前平均分算，缺人的一方按模型扣分'
              )}
              {row('摧毁分', num(A.D), num(B.D))}
              {row('损失分', num(A.L), num(B.L))}
              {row('净交换', num(A.D - A.L), num(B.D - B.L))}
              {row('击杀 / 阵亡', A.kills + ' / ' + A.deaths, B.kills + ' / ' + B.deaths)}
              {row('出兵花费', num(A.spent), num(B.spent), '按官方「出兵分 − 退款分」缩放过')}
              {row('占点', num(A.obj), num(B.obj))}
              {row('掉线', A.gone.join('、') || '—', B.gone.join('、') || '—')}
            </tbody>
          </table>
          <div className="roles-row">
            <span className="t0">{teamName(0)}</span>
            <RoleBar roles={A.roles} />
          </div>
          <div className="roles-row">
            <span className="t1">{teamName(1)}</span>
            <RoleBar roles={B.roles} />
          </div>
          <RoleLegend />
        </div>
      </div>
      {!!r.insights.length && (
        <div className="card">
          <h2>
            <span className="ico">💡</span>
            本局要点
          </h2>
          <ul className="rp-insights">
            {r.insights.map((i, n) => (
              <li key={n} className={i.kind === 'good' ? 'lit-ok' : i.kind === 'bad' ? 'lit-bad' : ''}>
                {i.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

const PCOLS: [keyof ReportPlayer | 'name', string, (p: ReportPlayer) => React.ReactNode, string?][] = [
  ['name', '玩家', (p) => (
    <span>
      <b style={{ color: p.me ? 'var(--accent)' : undefined }}>{p.name}</b>
      {p.titles.map((t) => (
        <span key={t.id} className={'tag ' + t.kind} style={{ marginLeft: 4 }}>
          {TITLE_NAME[t.id] || t.id}
        </span>
      ))}
    </span>
  )],
  ['team', '队', (p) => <span className={'t' + p.team}>{teamName(p.team)}</span>],
  ['score', '龙区分', (p) => (
    <b style={{ color: scoreColor(p.score) }}>{p.score != null ? p.score.toFixed(1) : '—'}</b>
  ), '和同分段、同兵种构成的人比，这一局打得怎么样'],
  ['eloBefore', 'ELO', (p) => (p.eloBefore == null ? '—' : Math.round(p.eloBefore))],
  ['net', '净交换', (p) => num(p.net), '摧毁分 − 损失分，这一局的实际功劳'],
  ['D', '摧毁分', (p) => num(p.D)],
  ['L', '损失分', (p) => num(p.L)],
  ['kills', '击杀', (p) => p.kills],
  ['deaths', '阵亡', (p) => p.deaths],
  ['survival', '存活率', (p) => (p.survival == null ? '—' : p.survival + '%')],
  ['dPerCost', '击杀分/花费', (p) => p.dPerCost ?? '—', '每 1 点花费打出多少击杀分'],
  ['spent', '花费', (p) => num(p.spent)]
]

function Players({ r }: { r: MatchReport }): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'net', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  const list = useMemo(() => {
    const v = [...r.players]
    v.sort((a, b) => {
      const x = a[sort.key as keyof ReportPlayer]
      const y = b[sort.key as keyof ReportPlayer]
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * sort.dir
      return ((Number(y) || 0) - (Number(x) || 0)) * (sort.dir === -1 ? 1 : -1)
    })
    return v
  }, [r, sort])

  return (
    <div className="card">
      <div className="rp-scroll">
        <table className="t rp-wide">
          <thead>
            <tr>
              {PCOLS.map(([k, label, , tip]) => (
                <th
                  key={String(k)}
                  title={tip}
                  className={'rp-sort' + (sort.key === k ? ' sorted' : '')}
                  onClick={() => setSort((s) => ({ key: String(k), dir: s.key === k && s.dir === -1 ? 1 : -1 }))}
                >
                  {label}
                  {sort.key === k ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <Fragment key={p.id}>
                <tr
                  className={'rp-prow' + (open === p.id ? ' open' : '')}
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                  title={open === p.id ? '点一下收起' : '点一下看这个人的单位明细'}
                >
                  {PCOLS.map(([k, , render]) => (
                    <td key={String(k)}>{render(p)}</td>
                  ))}
                </tr>
                {open === p.id && (
                  <tr className="rp-detail-row">
                    <td colSpan={PCOLS.length}>
                      <PlayerDetail p={p} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PlayerDetail({ p }: { p: ReportPlayer }): React.JSX.Element {
  return (
    <div className="rp-detail">
      {p.roles && (
        <>
          <RoleBar roles={p.roles} small />
          <RoleLegend />
        </>
      )}
      <div className="kv">
        <div>
          <b>{num(p.dmg)}</b>
          <span>造成伤害</span>
        </div>
        <div>
          <b>{num(p.dmgTaken)}</b>
          <span>承受伤害</span>
        </div>
        <div>
          <b>{sec(p.lifeMedian)}</b>
          <span title="已阵亡单位从出兵到阵亡的时间，取中位数（活到结束的和返航回收的不算）">阵亡存活·中位</span>
        </div>
        <div>
          <b>
            {p.unitsDeployed}
            {p.unitsRefunded ? <span className="dim">（回收 {p.unitsRefunded}）</span> : null}
          </b>
          <span title="出动次数，飞机按架次算">出兵</span>
        </div>
        <div>
          <b>{p.obj}</b>
          <span>占点</span>
        </div>
        <div>
          <b>{num(p.supply)}</b>
          <span>补给消耗</span>
        </div>
      </div>
      <div className="rp-scroll">
        <table className="t rp-wide">
          <thead>
            <tr>
              <th>单位</th>
              <th>兵种</th>
              <th title="出动次数，飞机按架次算；括号里是其中返航/回收的">出兵</th>
              <th>阵亡</th>
              <th>死亡率</th>
              <th>阵亡存活·中位</th>
              <th>伤害</th>
              <th>击杀</th>
              <th title="把这个人的总击杀分按各单位击杀数分下去的估算">击杀分（估）</th>
              <th>花费</th>
            </tr>
          </thead>
          <tbody>
            {p.units.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="dim">{u.roleName}</td>
                <td>
                  {u.deployed}
                  {u.refunded ? <span className="dim">（回收 {u.refunded}）</span> : null}
                </td>
                <td>{u.dead}</td>
                <td>{u.deathRate == null ? '—' : u.deathRate + '%'}</td>
                <td>{sec(u.lifeMedian)}</td>
                <td>{num(u.dmg)}</td>
                <td>{u.kills}</td>
                <td>{num(u.destr)}</td>
                <td>{num(u.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Units({ r }: { r: MatchReport }): React.JSX.Element {
  const [team, setTeam] = useState<'all' | '0' | '1'>('all')
  const [sort, setSort] = useState<{ key: keyof ReportUnit | 'usage'; dir: 1 | -1 }>({ key: 'usage', dir: -1 })
  const teamValue = [0, 1].map(
    (t) => r.units.filter((u) => u.team === t).reduce((s, u) => s + (u.value || 0), 0) || 1
  )
  const list = r.units
    .filter((u) => team === 'all' || String(u.team) === team)
    .map((u) => ({ ...u, usage: Math.round(((u.value || 0) / teamValue[u.team]) * 1000) / 10 }))
    .sort((a, b) => {
      const x = a[sort.key as keyof typeof a]
      const y = b[sort.key as keyof typeof b]
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * -sort.dir
      return ((Number(y) || 0) - (Number(x) || 0)) * (sort.dir === -1 ? 1 : -1)
    })

  const cols: [string, string, (u: (typeof list)[0]) => React.ReactNode, string?][] = [
    ['name', '单位', (u) => <b>{u.name}</b>],
    ['roleName', '兵种', (u) => <span className="dim">{u.roleName}</span>],
    ['team', '队', (u) => <span className={'t' + u.team}>{teamName(u.team)}</span>],
    ['usage', '使用率', (u) => (
      <span className="usage">
        <i style={{ width: Math.min(100, u.usage * 3) + '%' }} />
        {u.usage}%
      </span>
    ), '出动价值（出兵 × 单价）占本队的比例'],
    ['deployed', '出兵', (u) => (
      <>
        {u.deployed}
        {u.refunded ? <span className="dim">（回收 {u.refunded}）</span> : null}
      </>
    ), '出动次数，飞机按架次算；回收 = 返航/开回/开局卖掉，官方全额退款，不算花费'],
    ['cost', '单价', (u) => num(u.cost)],
    ['deathRate', '死亡率', (u) => (
      <span style={{ color: (u.deathRate ?? 0) >= 80 ? 'var(--bad)' : (u.deathRate ?? 100) <= 30 ? 'var(--good)' : undefined }}>
        {u.deathRate == null ? '—' : u.deathRate + '%'}
      </span>
    )],
    ['lifeMedian', '阵亡存活·中位', (u) => sec(u.lifeMedian), '已阵亡单位从出兵到阵亡的时间，取中位数'],
    ['dmg', '伤害', (u) => num(u.dmg)],
    ['kills', '击杀', (u) => u.kills],
    ['destr', '击杀分（估）', (u) => num(u.destr)],
    ['destrPerCost', '击杀分/花费', (u) => u.destrPerCost ?? '—'],
    ['users', '使用者', (u) => <span className="dim rp-users">{u.users.join('、')}</span>]
  ]

  return (
    <div className="card">
      <div className="rp-subbar">
        {(
          [
            ['all', '全部'],
            ['0', 'A 队'],
            ['1', 'B 队']
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={'rp-tab' + (team === k ? ' active' : '')} onClick={() => setTeam(k)}>
            {label}
          </button>
        ))}
        <span className="dim rp-note">单位的击杀分是把玩家的总击杀分按各单位击杀数分下去的估算</span>
      </div>
      <div className="rp-scroll">
        <table className="t rp-wide">
          <thead>
            <tr>
              {cols.map(([k, label, , tip]) => (
                <th
                  key={k}
                  title={tip}
                  className={'rp-sort' + (sort.key === k ? ' sorted' : '')}
                  onClick={() => setSort((s) => ({ key: k as keyof ReportUnit, dir: s.key === k && s.dir === -1 ? 1 : -1 }))}
                >
                  {label}
                  {sort.key === k ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.team + ':' + u.id}>
                {cols.map(([k, , render]) => (
                  <td key={k}>{render(u)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 整页以后图表要跟着容器变宽：量一下容器宽度，viewBox 用同样的宽，
// 这样线宽和字号不会被一起放大（以前固定 860 等比缩放，字会跟着变大）。
function useBoxWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (raw: number): void => {
      if (raw > 0) setW(Math.round(Math.max(360, raw)))
    }
    apply(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function Timeline({ r }: { r: MatchReport }): React.JSX.Element {
  const { minutes, field, loss, events } = r.timeline
  const [boxRef, W] = useBoxWidth(900)
  const H = 260
  const pad = { l: 56, r: 14, t: 12, b: 24 }
  const maxField = Math.max(1, ...field.flat())
  const x = (i: number): number => pad.l + (i / Math.max(1, minutes - 1)) * (W - pad.l - pad.r)
  const y = (v: number): number => H - pad.b - (v / maxField) * (H - pad.t - pad.b)
  const path = (arr: number[]): string => arr.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join(' ')
  const maxLoss = Math.max(1, ...loss.flat())
  // 宽了以后横轴可以多标几个刻度
  const last = Math.max(0, minutes - 1)
  const ticks = [...new Set([0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last])]

  return (
    <div className="card">
      <h2>
        场上兵力（估算：累计出兵 − 累计损失）
        <span className="legend rp-chart-legend">
          <span>
            <i style={{ background: 'var(--t0)' }} />
            {teamName(0)}
          </span>
          <span>
            <i style={{ background: 'var(--t1)' }} />
            {teamName(1)}
          </span>
        </span>
      </h2>
      <div className="rp-chart" ref={boxRef}>
        <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H}>
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--line)" />
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={pad.l}
                y1={y(maxField * f)}
                x2={W - pad.r}
                y2={y(maxField * f)}
                stroke="var(--line)"
                strokeDasharray="3 4"
              />
              <text x={pad.l - 8} y={y(maxField * f) + 4} textAnchor="end" fontSize="10" fill="var(--dim)">
                {num(maxField * f)}
              </text>
            </g>
          ))}
          <path d={path(field[0])} fill="none" stroke="var(--t0)" strokeWidth="2" />
          <path d={path(field[1])} fill="none" stroke="var(--t1)" strokeWidth="2" />
          {events.map((e, i) => (
            <g key={i}>
              <line
                x1={x(e.min)}
                y1={pad.t}
                x2={x(e.min)}
                y2={H - pad.b}
                stroke={e.type === 'leave' ? 'var(--bad)' : 'var(--warn)'}
                strokeDasharray="2 3"
              />
              <title>{'第 ' + (e.min + 1) + ' 分钟 ' + teamName(e.team) + ' ' + e.text}</title>
            </g>
          ))}
          {ticks.map((i) => (
            <text key={i} x={x(i)} y={H - 7} textAnchor="middle" fontSize="10" fill="var(--dim)">
              {i + 1}′
            </text>
          ))}
        </svg>
      </div>
      <h2 style={{ marginTop: 16 }}>每分钟损失</h2>
      <div className="lossbars">
        {Array.from({ length: minutes }, (_, i) => (
          <div key={i} className="lb" title={'第 ' + (i + 1) + ' 分钟：A ' + num(loss[0][i]) + ' / B ' + num(loss[1][i])}>
            <i style={{ height: (loss[0][i] / maxLoss) * 100 + '%', background: 'var(--t0)' }} />
            <i style={{ height: (loss[1][i] / maxLoss) * 100 + '%', background: 'var(--t1)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
