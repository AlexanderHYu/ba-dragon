// 单局复盘：整页版（以前是右侧抽屉）。玩家、总览、单位、时间线。
// 排版对齐 4.0.3 的 matchReport.js：总览是「要点 + 双方对比横条 + 兵种构成 + 全场之最」，
// 玩家表是老版 MR_PCOLS 那一串列。数字都是主进程算好的（shared/match），这里只负责摆出来。
import { Fragment, useEffect, useRef, useState } from 'react'
import type { MatchReport, ReportPlayer, ReportTeam } from '@shared/match'
import Mark from '../../components/Mark'
import ContextMenu, { type MenuState } from '../../components/ContextMenu'
import Flag from '../../components/Flag'
import { scoreColor } from '../../components/scoreColor'
import { useStore } from '../../store'
import './report.css'


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

/** 称号的说明（鼠标放上去看），{x} 换成这一局的数字 */
const TITLE_TIP: Record<string, string> = {
  carry: '赢方净交换最高：摧毁 {d} − 损失 {l} = {net}',
  blame: '输方净交换最低：摧毁 {d} − 损失 {l} = {net}',
  deserter: '被游戏记为逃兵或中途挂机，最后一次出兵在第 {min} 分钟；本队输了由他背锅',
  tryhard: '输了，但净交换全场第一',
  passenger: '赢了，但净交换为负且全场垫底：摧毁 {d} − 损失 {l} = {net}',
  lonewolf: '本队 {n} 人掉线，他的表现本队第一、全场前 3',
  reaper: '摧毁分占全场 {p}%',
  untouched: '损失只占本队 {p}%，摧毁却是队均的 {x} 倍',
  weightlifter: '击杀 {k}、阵亡 {d}，均为全场前列，但分值 K/D 仅 {kd}，基本是对换',
  atm: '损失分占全场 {p}%，K/D 仅 {kd}',
  scraper: '伤害占全场 {p}%，摧毁分仅为队均的 {x} 倍',
  killsteal: '每点伤害对应 {x} 摧毁分，全场最高',
  boxed: '阵亡单位平均只活了 {s} 秒（中位数）',
  camper: '损失很少（本队的 {p}%），战果也很少（队均的 {x} 倍）',
  landlord: '占点 {n} 个，占本队的 {p}%',
  demolition: '摧毁建筑 {n} 栋',
  convoy: '补给被敌方缴获 {n}',
  bandit: '缴获敌方补给 {n}',
  canteen: '队友使用了他的补给 {n}',
  freeloader: '使用了队友的补给 {n}',
  courier: '空投补给 {n}',
  refund: '{p}% 的出兵被回收退款',
  spender: '出兵花费占全场 {p}%，摧毁只有队均的 {x} 倍',
  traitor: '误伤摧毁友军，价值 {n}',
  backstabbed: '被友军误伤损失 {n}',
  crash: '直升机/固定翼损失 {n}',
  artygod: '以炮兵为主（{a}%），摧毁分占全场 {p}%',
  'deserter:silent': '全场无任何战果（掉线或挂机）；本队输了由他背锅'
}
/** 称号说明：套上这一局的数字；掉线狗分「全场零战果」和「中途走了」两种说法 */
function titleTip(t: { id: string; params: Record<string, unknown> }): string {
  const tpl = (t.params.silent ? TITLE_TIP[t.id + ':silent'] : undefined) || TITLE_TIP[t.id] || ''
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (t.params[k] == null ? '?' : String(t.params[k])))
}

const num = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString('zh-CN')
const sec = (s: number | null | undefined): string => {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  return m + '′' + String(Math.round(s % 60)).padStart(2, '0') + '″'
}
const pct = (v: number | null | undefined): string => (v == null ? '—' : Math.round(v * 100) + '%')
const teamName = (t: number): string => (t === 0 ? 'A 队' : 'B 队')
/** 阵营：旗子 + 中文名（旗子比文字一眼就能认出来） */
/** 阵营：旗子 + 一个字。旗子是自己画的 SVG，Windows 上没有国旗 emoji 字形 */
function Fac({ f }: { f: ReportTeam['faction'] }): React.JSX.Element | null {
  if (f !== 'RU' && f !== 'US') return null
  return (
    <span className="fac">
      <Flag code={f} />
      {f === 'RU' ? '俄' : '美'}
    </span>
  )
}

// 标签顺序照老版：玩家在最前，默认就打开玩家页
const TABS = [
  ['players', '玩家'],
  ['overview', '总览'],
  ['units', '单位'],
  ['timeline', '时间线']
] as const

export default function ReportPage({ fid, onBack }: { fid: string; onBack: () => void }): React.JSX.Element {
  const [report, setReport] = useState<MatchReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'overview' | 'players' | 'units' | 'timeline'>('players')

  useEffect(() => {
    let alive = true
    setReport(null)
    setError(null)
    void window.BA.getMatchReport(fid).then((r) => {
      if (!alive) return
      if ('error' in r) setError(r.error === 'notYet' ? 'BATrace 暂无本局数据，请几分钟后再试' : r.error)
      else setReport(r)
    })
    return () => {
      alive = false
    }
  }, [fid])

  return (
    <div className="rp">
      <div className="rp-head">
        <button className="rp-back" onClick={onBack} title="返回上一页">
          ← 返回
        </button>
        <h1 className="rp-title">
          复盘 {report?.map || ''} <span className="dim">#{fid}</span>
        </h1>
        <span className="grow" />
        <button
          onClick={() => window.BA.openExternal('https://dash.batrace.top/match/' + fid)}
          title="在浏览器中打开本局的 BATrace 页面"
        >
          BATrace ↗
        </button>
      </div>
      {!report ? (
        <div className="empty">{error ? error : <>计算中…（首次需下载对局数据）</>}</div>
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
    <div className="rolebar" style={{ height: small ? 14 : 20 }}>
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

// ---------- 总览 ----------
// 老版 .mr-cmp：[左数值] [中间一条双色横条，条上压着指标名] [右数值]，宽度按 a/(a+b) 分。
function CmpBar({ label, a, b }: { label: string; a: number | null; b: number | null }): React.JSX.Element {
  const tot = (a || 0) + (b || 0) || 1
  return (
    <div className="rp-cmp">
      <span className="rp-cmp-a">{num(a)}</span>
      <div
        className="rp-cmp-bar"
        title={label + '：' + teamName(0) + ' ' + num(a) + ' / ' + teamName(1) + ' ' + num(b)}
      >
        <i className="a" style={{ width: ((a || 0) / tot) * 100 + '%' }} />
        <i className="b" style={{ width: ((b || 0) / tot) * 100 + '%' }} />
        <em>{label}</em>
      </div>
      <span className="rp-cmp-b">{num(b)}</span>
    </div>
  )
}

const CMP_ROWS: [string, keyof ReportTeam][] = [
  ['摧毁分', 'D'],
  ['损失分', 'L'],
  ['击杀（单位数）', 'kills'],
  ['阵亡（单位数）', 'deaths'],
  ['造成伤害', 'dmg'],
  ['承受伤害', 'dmgTaken'],
  ['出兵花费', 'spent'],
  ['出兵数量', 'unitsDeployed'],
  ['补给消耗', 'supply'],
  ['占点', 'obj'],
  ['缴获敌方补给', 'supplyCaptured']
]

// 老版对比表里没有的（预期胜率 / 平均 ELO / 阵营 / 掉线）放在总览顶上做一行摘要
function TeamSummary({ T }: { T: ReportTeam }): React.JSX.Element {
  return (
    <div className={'rp-sum-team t' + T.team}>
      <b className="rp-sum-name">
        {teamName(T.team)}
        <Fac f={T.faction} />
        {T.won ? ' 🏆' : ''}
      </b>
      <span className="dim">
        平均 ELO <b>{T.avgElo ?? '—'}</b>
        {' · '}赛前预期 <b>{pct(T.expected)}</b>
        {T.eloDelta != null && (
          <>
            {' · '}ELO{' '}
            <b className={T.eloDelta > 0 ? 'lit-ok' : T.eloDelta < 0 ? 'lit-bad' : ''}>
              {(T.eloDelta > 0 ? '+' : '') + T.eloDelta}
            </b>
          </>
        )}
      </span>
      {!!T.gone.length && <span className="rp-sum-gone">掉线 {T.gone.join('、')}</span>}
    </div>
  )
}

function Overview({ r }: { r: MatchReport }): React.JSX.Element {
  const [A, B] = r.teams
  const surv = (T: ReportTeam): number | null =>
    T.unitsDeployed ? Math.round(((T.unitsDeployed - T.unitsDead) / T.unitsDeployed) * 100) : null
  // 全场之最：掉线/挂机的人不算（老版一样）
  const best = (key: keyof ReportPlayer, fmt: (v: number) => React.ReactNode): React.ReactNode => {
    const ps = r.players.filter((p) => !p.afk && p[key] != null)
    const p = [...ps].sort((x, y) => (Number(y[key]) || 0) - (Number(x[key]) || 0))[0]
    if (!p) return '—'
    return (
      <>
        <span className={'t' + p.team}>{p.name}</span> <b>{fmt(Number(p[key]))}</b>
      </>
    )
  }
  const BESTS: [string, keyof ReportPlayer, (v: number) => React.ReactNode][] = [
    ['净交换最高', 'net', (v) => num(v)],
    ['K/D 最高', 'kd', (v) => v],
    ['伤害最高', 'dmg', (v) => num(v)],
    ['出兵最多', 'unitsDeployed', (v) => v + ' 个'],
    ['单位存活率最高', 'survival', (v) => v + '%'],
    ['每点花费击杀分最高', 'dPerCost', (v) => v],
    ['补给消耗最多', 'supply', (v) => num(v)],
    ['占点最多', 'obj', (v) => v]
  ]

  return (
    <>
      <div className="card rp-sum">
        <TeamSummary T={A} />
        <span className="rp-sum-vs">⟷</span>
        <TeamSummary T={B} />
      </div>

      {!!r.insights.length && (
        <div className="card">
          <h2>
            <span className="ico">💡</span>本局要点
          </h2>
          <ul className="rp-insights">
            {r.insights.map((i, n) => (
              <li key={n} className={i.kind === 'good' ? 'ins-good' : i.kind === 'bad' ? 'ins-bad' : ''}>
                {i.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>
          双方对比
          <span className="dim rp-sub">
            （左 {teamName(0)}，右 {teamName(1)}；花费按官方出兵分折算）
          </span>
        </h2>
        <div className="rp-cmp-list">
          {CMP_ROWS.map(([label, k]) => (
            <CmpBar key={label} label={label} a={Number(A[k]) || 0} b={Number(B[k]) || 0} />
          ))}
          <CmpBar label="单位存活率（%）" a={surv(A)} b={surv(B)} />
        </div>
      </div>

      <div className="card">
        <h2>
          兵种构成<span className="dim rp-sub">（按出兵花费）</span>
        </h2>
        <div className="rp-roles">
          <span className="t0">{teamName(0)}</span>
          <RoleBar roles={A.roles} />
        </div>
        <div className="rp-roles">
          <span className="t1">{teamName(1)}</span>
          <RoleBar roles={B.roles} />
        </div>
        <div className="rp-roles">
          <span />
          <RoleLegend />
        </div>
      </div>

      <div className="card">
        <h2>
          全场之最<span className="dim rp-sub">（不含掉线/挂机玩家）</span>
        </h2>
        <div className="rp-bests">
          {BESTS.map(([label, k, fmt]) => (
            <div key={label}>
              {label}：{best(k, fmt)}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ---------- 玩家 ----------
const PCOLS: [keyof ReportPlayer, string, (p: ReportPlayer) => React.ReactNode, string?][] = [
  [
    'score',
    '龙区',
    (p) =>
      p.mark ? (
        <span className="rp-dg">
          <Mark tier={p.mark} />
          <b style={{ color: scoreColor(p.score, p.mark) }}>{p.score != null ? p.score.toFixed(1) : '—'}</b>
        </span>
      ) : (
        '—'
      ),
    '与同分段、同兵种构成的玩家相比，本局的表现评分'
  ],
  [
    'name',
    '玩家',
    (p) => (
      <span>
        <b>{p.name}</b>
        {p.me && <span className="rp-me">我</span>}
        {!!p.titles.length && (
          <span className="rp-titles">
            {p.titles.map((t) => (
              <span key={t.id} className={'tag ' + t.kind} title={titleTip(t)}>
                {TITLE_NAME[t.id] || t.id}
              </span>
            ))}
          </span>
        )}
      </span>
    )
  ],
  [
    'eloAfter',
    'ELO',
    (p) =>
      p.eloBefore == null || p.eloAfter == null ? (
        '—'
      ) : (
        <>
          {Math.round(p.eloAfter)}{' '}
          <span className={p.eloAfter >= p.eloBefore ? 'lit-ok' : 'lit-bad'}>
            {(p.eloAfter >= p.eloBefore ? '+' : '') + Math.round((p.eloAfter - p.eloBefore) * 10) / 10}
          </span>
        </>
      ),
    '赛后 ELO 及本局涨跌'
  ],
  [
    'net',
    '净交换',
    (p) => <span className={p.net >= 0 ? 'lit-ok' : 'lit-bad'}>{(p.net >= 0 ? '+' : '') + num(p.net)}</span>,
    '摧毁分 − 损失分'
  ],
  ['D', '摧毁 / 损失', (p) => num(p.D) + ' / ' + num(p.L)],
  ['kd', 'K/D', (p) => p.kd ?? '—', '摧毁分 ÷ 损失分'],
  ['kills', '击杀 / 阵亡', (p) => p.kills + ' / ' + p.deaths],
  ['dmg', '伤害 / 承伤', (p) => num(p.dmg) + ' / ' + num(p.dmgTaken)],
  ['spent', '出兵', (p) => p.unitsDeployed + ' 个 · ' + num(p.spent), '出动次数（飞机按架次计）· 花费'],
  ['survival', '存活率', (p) => (p.survival == null ? '—' : p.survival + '%')],
  ['dPerCost', '击杀分/花费', (p) => p.dPerCost ?? '—', '每点花费对应的击杀分'],
  ['supply', '补给', (p) => num(p.supply)]
]

function sortList<T>(list: T[], key: string, dir: 1 | -1): T[] {
  return [...list].sort((a, b) => {
    const x = (a as Record<string, unknown>)[key]
    const y = (b as Record<string, unknown>)[key]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    if (typeof x === 'string' || typeof y === 'string') return dir * String(x).localeCompare(String(y))
    return dir * ((Number(x) || 0) - (Number(y) || 0))
  })
}

function Players({ r }: { r: MatchReport }): React.JSX.Element {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'score', dir: -1 })
  const [open, setOpen] = useState<string | null>(null)
  // 右键一个人：调查羁绊 / 复制 ID / 去 BATrace（老版就是这几项）
  const [menu, setMenu] = useState<MenuState | null>(null)
  const { setPage, setOpenPlayer } = useStore()
  const head = (
    <tr>
      {PCOLS.map(([k, label, , tip]) => (
        <th
          key={String(k)}
          title={tip}
          className={'rp-sort' + (sort.key === k ? ' sorted' : '')}
          onClick={() =>
            setSort((s) =>
              s.key === k
                ? { key: s.key, dir: (-s.dir) as 1 | -1 }
                : { key: String(k), dir: k === 'name' ? 1 : -1 }
            )
          }
        >
          {label}
          {sort.key === k ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
        </th>
      ))}
    </tr>
  )
  // 赢的一队排在上面（老版一样）
  const order = r.winnerTeam === 1 ? [1, 0] : [0, 1]

  return (
    <>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {order.map((t) => {
        const T = r.teams[t]
        const rows = sortList(
          r.players.filter((p) => p.team === t),
          sort.key,
          sort.dir
        )
        return (
          <div className="card" key={t}>
            <h2 className={'t' + t}>
              {teamName(t)}
              <Fac f={T.faction} />
              {T.won == null ? null : (
                <span className={T.won ? 'lit-ok' : 'lit-bad'} style={{ marginLeft: 6 }}>
                  {T.won ? '胜' : '负'}
                </span>
              )}
            </h2>
            <div className="rp-scroll">
              <table className="t rp-wide rp-ptable">
                <thead>{head}</thead>
                <tbody>
                  {rows.map((p) => (
                    <Fragment key={p.id}>
                      <tr
                        className={'rp-prow' + (p.me ? ' me' : '') + (open === p.id ? ' open' : '')}
                        onClick={() => setOpen(open === p.id ? null : p.id)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          setMenu({
                            x: e.clientX,
                            y: e.clientY,
                            title: p.name,
                            items: [
                              {
                                label: '🔍 调查羁绊',
                                onClick: () => {
                                  setOpenPlayer(p.id)
                                  setPage({ name: 'home' })
                                }
                              },
                              { label: '📋 复制 ID', onClick: () => void navigator.clipboard.writeText(p.id) },
                              {
                                label: '🌐 在 BATrace 打开',
                                onClick: () => window.BA.openExternal('https://dash.batrace.top/player/' + p.id)
                              }
                            ]
                          })
                        }}
                        title={open === p.id ? '单击收起' : '单击查看单位明细，右键查看更多操作'}
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
      })}
    </>
  )
}

function PlayerDetail({ p }: { p: ReportPlayer }): React.JSX.Element {
  // 老版 mrPlayerDetail 的那一串零碎事实
  const extra = [
    p.supplyByAllies ? '队友使用其补给 ' + num(p.supplyByAllies) : '',
    p.supplyFromAllies ? '使用队友补给 ' + num(p.supplyFromAllies) : '',
    p.supplyCaptured ? '缴获敌方补给 ' + num(p.supplyCaptured) : '',
    p.supplyLostToEnemy ? '补给被缴获 ' + num(p.supplyLostToEnemy) : '',
    p.airdrop ? '空投 ' + num(p.airdrop) : '',
    p.buildings ? '摧毁建筑 ' + p.buildings + ' 栋' : '',
    p.ffDestroyed ? '误伤友军 ' + num(p.ffDestroyed) : '',
    p.ffLost ? '被友军误伤 ' + num(p.ffLost) : '',
    p.unitsRefunded ? '返航/回收 ' + p.unitsRefunded + ' 次（退回 ' + num(p.refundScore) + '）' : '',
    p.leftAtMin != null ? '第 ' + p.leftAtMin + ' 分钟离开' : '',
    p.exp ? '经验 ' + num(p.exp) : ''
  ].filter(Boolean)

  return (
    <div className="rp-detail">
      {p.roles && (
        <>
          <RoleBar roles={p.roles} small />
          <RoleLegend />
        </>
      )}
      {p.parts && (
        <div className="rp-parts">
          <span>
            <span title="按兵种加权：步兵、坦克阵亡扣分少，炮兵阵亡扣分多；正面单位击杀加分多，炮兵和固定翼加分少">K/D（按兵种加权）</span>
            同角色同分段中 <b>第 {Math.round((p.parts.kd || 0) * 100)} 百分位</b>
          </span>
          <span>
            摧毁贡献 <b>第 {Math.round((p.parts.contrib || 0) * 100)} 百分位</b>
          </span>
          {p.parts.outcome != null && (
            <span>
              胜负项 <b>第 {Math.round(p.parts.outcome * 100)} 百分位</b>
            </span>
          )}
        </div>
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
          <span title="已阵亡单位从出兵到阵亡的时间中位数（不含存活到结束和返航回收的单位）">阵亡存活·中位</span>
        </div>
        <div>
          <b>
            {p.unitsDeployed}
            {p.unitsRefunded ? <span className="dim">（回收 {p.unitsRefunded}）</span> : null}
          </b>
          <span title="出动次数，飞机按架次计">出兵</span>
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
      {!!extra.length && (
        <div className="rp-extra">
          {extra.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
      )}
      <div className="rp-scroll">
        <table className="t rp-wide rp-mini">
          <thead>
            <tr>
              <th>单位</th>
              <th>兵种</th>
              <th title="出动次数，飞机按架次计；括号内为其中返航/回收的次数">出兵</th>
              <th>阵亡</th>
              <th>死亡率</th>
              <th title="已阵亡单位从出兵到阵亡的时间中位数（不含存活到结束和返航回收的单位）">阵亡存活·中位</th>
              <th>伤害</th>
              <th>击杀</th>
              <th title="按各单位击杀数分摊该玩家总击杀分的估算值">击杀分（估）</th>
              <th>花费</th>
            </tr>
          </thead>
          <tbody>
            {p.units.map((u) => (
              <tr key={u.id + '|' + u.options}>
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

// ---------- 单位 ----------
function Units({ r }: { r: MatchReport }): React.JSX.Element {
  const [team, setTeam] = useState<'all' | '0' | '1'>('all')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'spent', dir: -1 })
  const teamValue = [0, 1].map(
    (t) => r.units.filter((u) => u.team === t).reduce((s, u) => s + (u.value || 0), 0) || 1
  )
  const list = sortList(
    r.units
      .filter((u) => team === 'all' || String(u.team) === team)
      .map((u) => ({ ...u, usage: Math.round(((u.value || 0) / teamValue[u.team]) * 1000) / 10 })),
    sort.key,
    sort.dir
  )

  const cols: [string, string, (u: (typeof list)[0]) => React.ReactNode, string?][] = [
    [
      'name',
      '单位',
      (u) => (
        <>
          <b>{u.name}</b>
          {!!u.loadout && <div className="rp-loadout dim">{u.loadout}</div>}
        </>
      )
    ],
    ['roleName', '兵种', (u) => <span className="dim">{u.roleName}</span>],
    ['team', '队伍', (u) => <span className={'t' + u.team}>{teamName(u.team)}</span>],
    [
      'usage',
      '使用率',
      (u) => (
        <span className="rp-usage">
          <i style={{ width: Math.min(100, u.usage * 3) + '%' }} />
          {u.usage}%
        </span>
      ),
      '出动价值（出兵 × 单价）占本队总出动价值的比例'
    ],
    [
      'deployed',
      '出兵',
      (u) => (
        <>
          {u.deployed}
          {u.refunded ? <span className="dim">（回收 {u.refunded}）</span> : null}
        </>
      ),
      '出动次数，飞机按架次计；括号内为其中返航/回收的次数（回收：飞机返航、卡车撤回、开局出售，官方全额退款，不计花费）'
    ],
    [
      'cost',
      '单价',
      (u) => num(u.cost),
      r.priced === 'estimate'
        ? '按官方出兵总数等比例分摊的估算值'
        : '单位基础价 + 配装加价（取自游戏单位表，精确值）'
    ],
    [
      'deathRate',
      '死亡率',
      (u) => (
        <span className={(u.deathRate ?? 0) >= 80 ? 'lit-bad' : (u.deathRate ?? 100) <= 30 ? 'lit-ok' : ''}>
          {u.deathRate == null ? '—' : u.deathRate + '%'}
        </span>
      ),
      '阵亡 ÷ 出兵'
    ],
    [
      'lifeMedian',
      '阵亡存活·中位',
      (u) => sec(u.lifeMedian),
      '已阵亡单位从出兵到阵亡的时间中位数（不含存活到结束和返航回收的单位）'
    ],
    ['dmg', '伤害', (u) => num(u.dmg)],
    ['kills', '击杀', (u) => u.kills],
    ['destr', '击杀分（估）', (u) => num(u.destr), '按各单位击杀数分摊该玩家总击杀分的估算值'],
    ['destrPerCost', '击杀分/花费', (u) => u.destrPerCost ?? '—', '每点花费对应的击杀分'],
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
        <span className="dim rp-note">
          出兵：出动次数，飞机按架次计，返航后再出动计两次。使用率：出动价值（出兵 × 单价）占本队的比例。死亡率：
          阵亡 ÷ 出兵。回收：飞机返航、卡车撤回、开局出售，官方全额退款，不计花费。单位击杀分：按各单位击杀数分摊该玩家总击杀分的估算值
          {r.priced === 'local'
            ? '。单价取自本机游戏单位表，含配装，精确值'
            : r.priced === 'bundled'
              ? '。单价取自软件内置游戏单位表，含配装，精确值（游戏更新后可能过时）'
              : '。单价按官方出兵总数等比例分摊，为估算值'}
        </span>
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
                  onClick={() =>
                    setSort((s) =>
                      s.key === k
                        ? { key: s.key, dir: (-s.dir) as 1 | -1 }
                        : { key: k, dir: ['name', 'roleName', 'users'].includes(k) ? 1 : -1 }
                    )
                  }
                >
                  {label}
                  {sort.key === k ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.team + ':' + u.id + '|' + u.options}>
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

// ---------- 时间线 ----------
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
  // 三种看法：兵力本身、双方差、每分钟的净变化（谁在推谁）
  const [mode, setMode] = useState<'field' | 'diff' | 'slope'>('field')
  const H = 260
  const pad = { l: 56, r: 14, t: 12, b: 24 }

  // 每分钟净变化 = 这一分钟的兵力 − 上一分钟的兵力
  const slope = field.map((arr) => arr.map((v, i) => (i ? v - arr[i - 1] : 0)))
  const diff = field[0].map((v, i) => v - field[1][i])
  const series: { rows: number[][]; colors: string[]; zero: boolean; split?: boolean } =
    mode === 'field'
      ? { rows: field, colors: ['var(--t0)', 'var(--t1)'], zero: false }
      : mode === 'slope'
        ? { rows: slope, colors: ['var(--t0)', 'var(--t1)'], zero: true }
        : { rows: [diff], colors: ['var(--t0)'], zero: true, split: true }

  const flat = series.rows.flat()
  // 绝对兵力从数据最低点开始画（从 0 开始的话，几千点的底座会把变化压平）
  const lo = series.zero ? -Math.max(1, ...flat.map(Math.abs)) : Math.min(...flat)
  const hi = series.zero ? Math.max(1, ...flat.map(Math.abs)) : Math.max(...flat)
  const spanRaw = Math.max(1, hi - lo)
  const padY = spanRaw * 0.08
  const top = hi + padY
  const bottom = lo - padY
  const span = Math.max(1, top - bottom)

  const x = (i: number): number => pad.l + (i / Math.max(1, minutes - 1)) * (W - pad.l - pad.r)
  const y = (v: number): number => H - pad.b - ((v - bottom) / span) * (H - pad.t - pad.b)
  const path = (arr: number[]): string => arr.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join(' ')
  // 差值/变化率：折线和 0 线之间填色，更容易一眼看出谁在上风
  const area = (arr: number[]): string =>
    path(arr) + ' L' + x(arr.length - 1) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z'
  const maxLoss = Math.max(1, ...loss.flat())
  const last = Math.max(0, minutes - 1)
  const ticks = [...new Set([0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last])]
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => bottom + span * f)

  const TITLE: Record<typeof mode, string> = {
    field: '场上兵力（估算：累计出兵 − 累计损失）',
    diff: '兵力差（A 队 − B 队，正值为 A 队领先）',
    slope: '每分钟净变化（正值为兵力增加）'
  }

  return (
    <div className="card">
      <h2>
        {TITLE[mode]}
        <span className="grow" />
        {(
          [
            ['field', '兵力'],
            ['diff', '兵力差'],
            ['slope', '变化率']
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={'rp-tab' + (mode === k ? ' active' : '')} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
        <span className="legend rp-chart-legend">
          {mode === 'diff' ? (
            <>
              <span>
                <i style={{ background: 'var(--t0)' }} />
                {teamName(0)}领先
              </span>
              <span>
                <i style={{ background: 'var(--t1)' }} />
                {teamName(1)}领先
              </span>
            </>
          ) : (
            <>
              <span>
                <i style={{ background: 'var(--t0)' }} />
                {teamName(0)}
              </span>
              <span>
                <i style={{ background: 'var(--t1)' }} />
                {teamName(1)}
              </span>
            </>
          )}
        </span>
      </h2>
      <div className="rp-chart" ref={boxRef}>
        <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H}>
          {gridVals.map((v, i) => (
            <g key={i}>
              <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="var(--line)" strokeDasharray="3 4" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--dim)">
                {num(v)}
              </text>
            </g>
          ))}
          {series.zero && (
            <line x1={pad.l} y1={y(0)} x2={W - pad.r} y2={y(0)} stroke="var(--line-hi)" strokeWidth="1.5" />
          )}
          {series.split ? (
            // 兵力差：0 线以上 = A 队占上风（蓝），以下 = B 队占上风（红）
            <>
              <defs>
                <clipPath id="rp-tl-up">
                  <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={Math.max(0, y(0) - pad.t)} />
                </clipPath>
                <clipPath id="rp-tl-dn">
                  <rect x={pad.l} y={y(0)} width={W - pad.l - pad.r} height={Math.max(0, H - pad.b - y(0))} />
                </clipPath>
              </defs>
              {(
                [
                  ['rp-tl-up', 'var(--t0)'],
                  ['rp-tl-dn', 'var(--t1)']
                ] as const
              ).map(([clip, color]) => (
                <g key={clip} clipPath={'url(#' + clip + ')'}>
                  <path d={area(series.rows[0])} fill={color} opacity="0.18" />
                  <path d={path(series.rows[0])} fill="none" stroke={color} strokeWidth="2" />
                </g>
              ))}
            </>
          ) : (
            series.rows.map((row, i) => (
              <g key={i}>
                {series.zero && <path d={area(row)} fill={series.colors[i]} opacity="0.16" />}
                <path d={path(row)} fill="none" stroke={series.colors[i]} strokeWidth="2" />
              </g>
            ))
          )}
          {events.map((e, i) => {
            const color = e.team === 1 ? 'var(--t1)' : 'var(--t0)'
            // 「一分钟内损失 XXXX」指的是整个第 N 分钟，所以标成一条带，
            // 左右两条虚线就是这一分钟的开始和结束；掉线是一个时刻，还是一条线。
            if (e.type === 'spike') {
              const x1 = x(e.min)
              const x2 = x(Math.min(minutes - 1, e.min + 1))
              return (
                <g key={i}>
                  <rect x={x1} y={pad.t} width={Math.max(1, x2 - x1)} height={H - pad.t - pad.b} fill={color} opacity="0.14" />
                  <line x1={x1} y1={pad.t} x2={x1} y2={H - pad.b} stroke={color} strokeDasharray="2 3" />
                  <line x1={x2} y1={pad.t} x2={x2} y2={H - pad.b} stroke={color} strokeDasharray="2 3" />
                  <title>{'第 ' + (e.min + 1) + ' 分钟（整分钟）' + teamName(e.team) + ' ' + e.text}</title>
                </g>
              )
            }
            return (
              <g key={i}>
                <line x1={x(e.min)} y1={pad.t} x2={x(e.min)} y2={H - pad.b} stroke="var(--bad)" strokeDasharray="2 3" />
                <title>{'第 ' + (e.min + 1) + ' 分钟 ' + teamName(e.team) + ' ' + e.text}</title>
              </g>
            )
          })}
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
          <div
            key={i}
            className="lb"
            title={'第 ' + (i + 1) + ' 分钟：A ' + num(loss[0][i]) + ' / B ' + num(loss[1][i])}
          >
            <i style={{ height: (loss[0][i] / maxLoss) * 100 + '%', background: 'var(--t0)' }} />
            <i style={{ height: (loss[1][i] / maxLoss) * 100 + '%', background: 'var(--t1)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
