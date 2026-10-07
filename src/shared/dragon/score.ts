// ================= 龙区分 =================
// 越高越像龙，越低越像区。两种用法：
//   computeDragonScore —— 玩家的龙区分：最近 20 场排位局逐场打分，卡尔曼滤波汇总成 1~10
//   analyzeMatch       —— 单局复盘：一局里每个人的龙/区/泯（和同分段同角色比）+ 称号（titles.ts）
// 所有参数都来自真实数据拟合（model.json），这里只有公式，没有拍脑袋的数字。纯函数、无 I/O。
//
// 每场三个表现指标 + 一个胜负项：
//   K/D    —— log2(摧毁分 ÷ 损失分)，两边都按兵种加权（见 TRADE）
//   贡献   —— log2(本人摧毁分 ÷ 本队在线队员人均摧毁分)，摧毁分同样加权
//   占点   —— log2(本人占点 ÷ 本队在线队员人均占点)（照算但权重为 0：和地图、选位强相关，不计入）
//   胜负   —— 实际结果 − Elo 预期胜率（按两队在线队员的赛前平均 ELO；缺人的一方按弱若干分算）
//             权重 MODEL.weights.out：v1.0.8 及以前 1，v1.0.9 改成 0（输赢是五个人的事），
//             v1.0.10 折中为 0.5——完全不看输赢时，胜率远高于预期但 K/D 一般的人被罚得太狠
// 表现指标先按「同角色构成、同 ELO、同分差的玩家通常打成什么样」标准化，再换算成百分位。
import { num, type MatchEntry, type MatchInfo, type PlayerData } from '../types/batrace'
import { FRONT, MODEL, ROLE_KEYS, type Norm, type RoleKey, type RoleShare, type Roles } from './model'
import { defaultRoles, rolesFromCareer, rolesFromUnits, type UnitMap } from './roles'
import { awardTitles, type Title } from './titles'
import type { CategoryPreference, HighlightUnit } from '../types/batrace'

// 接口是 protobuf 转 JSON，值为 0 的字段会被省略 —— TeamId 缺失 = 队伍 A(0)，
// 摧毁分/损失分/占点缺失 = 0。
export const teamOf = (p: PlayerData): number => (p.TeamId == null ? 0 : p.TeamId)
export const hasRating = (p: PlayerData): boolean =>
  typeof p.OldRating === 'number' && typeof p.NewRating === 'number'
export const isRated = (p: PlayerData): boolean =>
  hasRating(p) && Math.abs((p.NewRating as number) - (p.OldRating as number)) >= 0.01

/** 掉线/挂机的判定参数 */
export const AFK = { lastSpawnFrac: 0.4, contribFrac: 0.15 }

/** 掉线/挂机：本局既没摧毁也没损失；或最后一次出兵早于对局前 40% 且摧毁分不到本队人均的 15% */
export function detectInactive(mi: MatchInfo): Set<string> {
  const all = Object.values(mi?.Data || {})
  const out = new Set<string>()
  const start = num(mi?.StartTime)
  const dur = num(mi?.TotalPlayTimeInSec)
  for (const t of [0, 1]) {
    const team = all.filter((p) => teamOf(p) === t)
    const avgD = team.reduce((a, p) => a + num(p.DestructionScore), 0) / (team.length || 1)
    for (const p of team) {
      const D = num(p.DestructionScore)
      const L = num(p.LossesScore)
      if (D + L === 0) {
        out.add(String(p.Id))
        continue
      }
      const spawns = Object.values(p.UnitData || {}).map((u) => num(u.SpawnTime)).filter(Boolean)
      if (!spawns.length || !start || !dur) continue
      const lastSpawnFrac = (Math.max(...spawns) - start) / dur
      if (lastSpawnFrac < AFK.lastSpawnFrac && D < AFK.contribFrac * avgD) out.add(String(p.Id))
    }
  }
  return out
}

/**
 * 交换加权：死什么兵、拿什么兵杀的，分量不一样。
 * 这是设计取舍（玩家反馈：正面填线的人 K/D 挨罚太狠），不是拟合出来的：
 *   损失 —— 步兵、坦克是填线的正常消耗，罚轻一点；炮兵躲在后面还被摸掉，罚重一点
 *   击杀 —— 正面（装甲/步兵/侦察）拿到的奖励多一点，炮兵和固定翼的少一点
 * 两张表各自按真实对局（backtest 的 1199 局）缩放过：全体玩家的平均倍数是 1，
 * 所以普通人的分数不动，只在「兵种构成不同的人之间」挪分。运输/后勤不加权（按 1 算）。
 */
export const TRADE: { kill: RoleShare; loss: RoleShare } = {
  kill: { armor: 1.2, inf: 1.2, recon: 1.1, aa: 1, heli: 0.9, jet: 0.8, arty: 0.75 },
  loss: { armor: 0.75, inf: 0.7, recon: 0.9, aa: 1, heli: 1, jet: 1.1, arty: 1.4 }
}
/** 上面两张表的缩放系数（scripts/fit-trade.ts 算的：让全体的 log2 平均倍数为 0） */
export const TRADE_NORM = { kill: 0.9719, loss: 1.1218 }

export interface TradeMult {
  /** 摧毁分乘的倍数 */
  k: number
  /** 损失分乘的倍数 */
  l: number
}

const mix = (w: RoleShare, share: Partial<Record<RoleKey | '_', number>>): number | null => {
  let s = 0
  let n = 0
  // 只认 7 个兵种和「_」（运输/后勤），Roles 上还挂着 known 之类的字段
  for (const k of [...ROLE_KEYS, '_'] as const) {
    const v = share[k]
    if (!v) continue
    s += v * (k === '_' ? 1 : w[k])
    n += v
  }
  return n > 0 ? s / n : null
}

/**
 * 一个人这一局的交换倍数。
 * 有单位数据时：击杀按各单位的击杀数分摊到兵种，损失按阵亡单位的价格分摊；
 * 没有（列表接口只给总分）或者这一边是 0 时，按他的兵种构成（花钱比例）估。
 */
export function tradeMult(p: PlayerData, roles?: RoleShare | null, unitMap?: UnitMap): TradeMult {
  const um = unitMap || MODEL.units || {}
  const kShare: Partial<Record<RoleKey | '_', number>> = {}
  const lShare: Partial<Record<RoleKey | '_', number>> = {}
  for (const u of Object.values(p?.UnitData || {})) {
    const e = um[u.Id]
    const r: RoleKey | '_' = (e && e[0]) || '_'
    const kills = num(u.KilledCount)
    if (kills) kShare[r] = (kShare[r] || 0) + kills
    if (u.DeathTime && !u.WasRefunded) lShare[r] = (lShare[r] || 0) + ((e && e[1]) || 1)
  }
  const fb = roles ? mix(TRADE.kill, roles) : null
  const fl = roles ? mix(TRADE.loss, roles) : null
  const k = mix(TRADE.kill, kShare) ?? fb ?? 1 / TRADE_NORM.kill
  const l = mix(TRADE.loss, lShare) ?? fl ?? 1 / TRADE_NORM.loss
  return { k: k * TRADE_NORM.kill, l: l * TRADE_NORM.loss }
}

const C_SCORE = 200 // 摧毁/损失分的平滑量（避免 0 分时 log 爆掉）
const eloExpect = (own: number, opp: number, scale: number): number =>
  1 / (1 + Math.pow(10, (opp - own) / scale))

export interface MatchFeatures {
  fid: string
  mapId: number | null
  endTime: number | null
  minutes: number
  rated: boolean
  team: number
  teamSize: number
  oppSize: number
  outnumbered: boolean
  afk: boolean
  won: boolean | null
  S: number | null
  E: number
  expected: number
  eloBefore: number | null
  eloDelta: number | null
  teamElo: number | null
  oppElo: number | null
  matchElo: number | null
  eloN: number
  gapN: number
  kd: number
  contrib: number | null
  obj: number | null
  destruction: number
  losses: number
  objectives: number
  conscript: boolean
  x: { kd: number; con: number; obj: number; dpm: number }
}

export interface FeatureOpts {
  /** 允许自定义局（单局复盘用；预期胜率按 0.5） */
  allowUnrated?: boolean
  /** 已知胜方（0/1），非排位局判胜负用 */
  winnerTeam?: number | null
  /** 掉线/挂机玩家 ID（不传则按「无摧毁无损失」自动识别） */
  inactive?: Set<string>
  /** 玩家ID → 缺席比例 0~1（不传按整局缺席） */
  absence?: Map<string, number>
  expect?: { scale: number; afkPenalty: number }
  /** 玩家ID → 交换倍数（不传或查不到按 1，即不加权） */
  trade?: Map<string, TradeMult>
}

/** 一场 → 某玩家这一场的特征。观战、数据不全、（未允许时）非排位局返回 null */
export function matchFeatures(
  raw: MatchEntry,
  stbid: string | number,
  opts: FeatureOpts = {}
): MatchFeatures | null {
  const d = raw?.data || {}
  const all = Object.values(d.Data || {})
  const me = all.find((p) => String(p.Id) === String(stbid))
  if (!me || (teamOf(me) !== 0 && teamOf(me) !== 1)) return null
  const rated = isRated(me)
  if (!rated && !opts.allowUnrated) return null // 自定义局 / 未计分
  const team = all.filter((p) => teamOf(p) === teamOf(me))
  const opp = all.filter((p) => teamOf(p) === 1 - teamOf(me))
  if (!opp.length) return null
  const inactiveAll = opts.inactive || detectInactive(d)
  const afk = inactiveAll.has(String(stbid))
  // 缺人修正只剔除别人：本人挂机不给自己「以少打多」的减免
  const inactive = new Set([...inactiveAll].filter((id) => String(id) !== String(stbid)))
  const active = (list: PlayerData[]): PlayerData[] => list.filter((p) => !inactive.has(String(p.Id)))
  const avgElo = (list: PlayerData[]): number | null => {
    const r = list.filter(hasRating)
    return r.length ? r.reduce((a, p) => a + (p.OldRating as number), 0) / r.length : null
  }
  const absent = (p: PlayerData): number => opts.absence?.get(String(p.Id)) ?? 1
  const missing = (list: PlayerData[]): number =>
    list.filter((p) => inactive.has(String(p.Id))).reduce((s, p) => s + absent(p), 0)
  const teamElo = avgElo(active(team))
  const oppElo = avgElo(active(opp))
  const matchElo = avgElo(team.concat(opp))
  // 本队人均只算在线的人：掉线/挂机的队友不拉低人均
  const onTeam = active(team).length ? active(team) : team
  const sum = (list: PlayerData[], k: keyof PlayerData): number =>
    list.reduce((a, p) => a + num(p[k]), 0)
  const D = num(me.DestructionScore)
  const L = num(me.LossesScore)
  const O = num(me.ObjectivesCaptured)
  const avgD = sum(onTeam, 'DestructionScore') / onTeam.length
  // 模型用的加权分：摧毁分乘击杀倍数、损失分乘损失倍数；队均也用各人加权后的摧毁分
  const tm = (p: PlayerData): TradeMult => opts.trade?.get(String(p.Id)) || { k: 1, l: 1 }
  const Dw = D * tm(me).k
  const Lw = L * tm(me).l
  const avgDw = onTeam.reduce((a, p) => a + num(p.DestructionScore) * tm(p).k, 0) / onTeam.length
  const avgO = sum(onTeam, 'ObjectivesCaptured') / onTeam.length
  const minutes = num(d.TotalPlayTimeInSec) / 60
  let won: boolean | null = null
  if (rated) won = (me.NewRating as number) > (me.OldRating as number) // 排位局：赢必涨、输必跌
  else if (opts.winnerTeam === 0 || opts.winnerTeam === 1) won = opts.winnerTeam === teamOf(me)
  const ex = opts.expect || MODEL.expect
  let E = 0.5
  if (rated && teamElo != null && oppElo != null) {
    E = eloExpect(teamElo - ex.afkPenalty * missing(team), oppElo - ex.afkPenalty * missing(opp), ex.scale)
  }
  const elo = hasRating(me) ? (me.OldRating as number) : null
  return {
    fid: String(raw.matchId != null ? raw.matchId : ''),
    mapId: d.MapId != null ? d.MapId : null,
    endTime: d.EndTime ? d.EndTime * 1000 : null,
    minutes,
    rated,
    team: teamOf(me),
    teamSize: team.length,
    oppSize: opp.length,
    outnumbered: active(team).length < active(opp).length,
    afk,
    won,
    S: won == null ? null : won ? 1 : 0,
    E,
    expected: E,
    eloBefore: elo,
    eloDelta: hasRating(me) ? (me.NewRating as number) - (me.OldRating as number) : null,
    teamElo,
    oppElo,
    matchElo,
    eloN: elo != null && rated ? (elo - 2100) / 400 : 0,
    gapN: elo != null && rated && matchElo != null ? (elo - matchElo) / 400 : 0,
    // 显示用的原始倍数
    kd: L > 0 ? D / L : D > 0 ? 10 : 1,
    contrib: avgD > 0 ? D / avgD : null,
    obj: avgO > 0 ? O / avgO : null,
    destruction: D,
    losses: L,
    objectives: O,
    conscript: rated && matchElo != null && elo != null && elo < matchElo - 200,
    // 模型用的 log 指标
    x: {
      kd: Math.log2((Dw + C_SCORE) / (Lw + C_SCORE)),
      con: Math.log2((Dw + C_SCORE) / (avgDw + C_SCORE)),
      obj: Math.log2((O + 1) / (avgO + 1)),
      dpm: Math.log2((D + C_SCORE) / Math.max(minutes, 5))
    }
  }
}

/** 按「同角色构成、同 ELO、同分差的人通常打成什么样」标准化 */
export function zScores(
  f: MatchFeatures,
  roles: RoleShare,
  norm: Norm
): { kd: number; con: number; obj: number } {
  const z = {} as { kd: number; con: number; obj: number }
  for (const k of ['kd', 'con', 'obj'] as const) {
    const n = norm[k]
    let mu = n.elo * f.eloN + n.gap * f.gapN
    let v = 0
    for (const q of ROLE_KEYS) {
      mu += (roles[q] || 0) * n.mu[q]
      v += (roles[q] || 0) * n.sigma[q] * n.sigma[q]
    }
    z[k] = (f.x[k] - mu) / Math.sqrt(v || 1)
  }
  return z
}

/** 标准正态分布函数（没有分布表时的兜底） */
export function phi(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

/** 在分位表 q（101 个点，从小到大）里查百分位 0~1 */
export function pctOf(v: number, q?: number[]): number {
  if (!Array.isArray(q) || q.length < 2) return phi(v)
  const n = q.length - 1
  if (v <= q[0]) return 0
  if (v >= q[n]) return 1
  let lo = 0
  let hi = n
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (q[mid] <= v) lo = mid
    else hi = mid
  }
  const span = q[hi] - q[lo]
  return (lo + (span > 0 ? (v - q[lo]) / span : 0.5)) / n
}

/** 占点的权重按角色打折：前线（装甲/步兵/侦察）才负责占点 */
export const objFactor = (roles: RoleShare): number =>
  FRONT.reduce((s, k) => s + (roles[k] || 0), 0) +
  0.2 * ROLE_KEYS.filter((k) => !FRONT.includes(k)).reduce((s, k) => s + (roles[k] || 0), 0)

export interface ScoreParts {
  kd: number | null
  contrib: number | null
  obj: number | null
  outcome: number | null
}

/** 单场综合分（标准分尺度）+ 各分项百分位 */
export function scoreMatch(
  f: MatchFeatures,
  roles: RoleShare,
  kind: 'match' | 'career'
): { c: number; pct: number; parts: ScoreParts } {
  const norm = MODEL.norm?.[kind] || null
  const w = MODEL.weights
  const outSd = MODEL.outSd
  const parts: ScoreParts = { kd: null, contrib: null, obj: null, outcome: null }
  let stat = 0
  if (norm) {
    const z = zScores(f, roles, norm)
    const of = objFactor(roles)
    stat = (w.kd * z.kd + w.con * z.con + w.obj * of * z.obj) / (w.kd + w.con + w.obj * of)
    parts.kd = pctOf(z.kd, norm.kd.q)
    parts.contrib = pctOf(z.con, norm.con.q)
    parts.obj = pctOf(z.obj, norm.obj.q)
  }
  const out = f.S == null ? 0 : (f.S - f.E) / outSd
  // 胜负项不计分时也不显示这一项，免得看起来像是还在算
  if (f.S != null && w.out) parts.outcome = phi(out)
  const c = stat + w.out * out
  const pct = pctOf(c, MODEL.matchPct?.[kind])
  return { c, pct, parts }
}

export const to10 = (p: number): number => Math.round((1 + 9 * p) * 10) / 10

export type Mark = 'dragon' | 'qu' | 'min'
/** 按显示出来的分数判断（边界上不会出现「2.8 却标泯」）：前 20% 龙、后 20% 区 */
export function markOf(pct: number): Mark {
  const mk = MODEL.marks
  const v = to10(pct)
  return v >= to10(mk.dragon) ? 'dragon' : v <= to10(mk.qu) ? 'qu' : 'min'
}
export function tierOf(pct: number): string {
  const t = MODEL.tiers
  const v = to10(pct) // 同样按显示分数判断
  return (t.find(([p]) => v >= to10(p)) || t[t.length - 1])[1]
}

/** 卡尔曼滤波：玩家水平每场缓慢漂移，每场表现是带噪声的观测；短局噪声更大 */
export function kalman(scores: number[], minutesList: number[]): { m: number; P: number; P0: number } {
  const k = MODEL.kalman
  let m = 0
  let P = k.P0
  for (let i = 0; i < scores.length; i++) {
    P += k.q
    const R = k.r / Math.min(1, Math.max(0.3, (minutesList[i] || 0) / k.shortMin))
    const K = P / (P + R)
    m += K * (scores[i] - m)
    P *= 1 - K
  }
  return { m, P, P0: k.P0 }
}

const median = (a: number[]): number | null => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}

export interface DragonReason {
  key: string
  weight: number
  params: Record<string, unknown>
}
/**
 * 龙区分里的单场一行：就是 MatchFeatures 去掉只给算法用的中间量（c/x/S/E/eloN/gapN），
 * 加上这一场的分项百分位、单场分和龙/区/泯。
 * `map` 是地图名，shared 里查不到表，由主进程按 mapId 补上（见 services/players.ts）。
 */
export interface DragonRow extends Omit<MatchFeatures, 'x' | 'S' | 'E' | 'eloN' | 'gapN'> {
  parts: ScoreParts
  score: number
  mark: Mark
  map?: string
}
export interface DragonScore {
  stbid: string
  value: number
  range: [number, number]
  tier: string
  confidence: number
  matchCount: number
  roles: { known: boolean } & Record<RoleKey, number>
  parts: Record<string, number | null>
  summary: {
    kdMedian: number | null
    /** 这 20 场的总体 K/D：Σ摧毁分 ÷ Σ损失分（比逐场取平均稳，界面上显示的是它） */
    kdAgg: number | null
    contribMedian: number | null
    objMedian: number | null
    avgExpected: number
    winRate: number
  }
  reasons: DragonReason[]
  rows: DragonRow[]
  error?: undefined
}

/** 玩家的龙区分。有效排位局为 0 时返回 { error: 'noRated' } */
export function computeDragonScore(input: {
  stbid: string | number
  matches?: MatchEntry[]
  categoryPreferences?: CategoryPreference[]
  highlightUnits?: HighlightUnit[]
}): DragonScore | { error: 'noRated'; stbid: string } {
  const { stbid, matches, categoryPreferences, highlightUnits } = input
  const roles: Roles = rolesFromCareer(categoryPreferences, highlightUnits) || defaultRoles()
  const feats = (Array.isArray(matches) ? matches : [])
    // 列表接口没有单位数据：按生涯兵种构成估自己的交换倍数，队友按 1（全体平均）
    .map((m) => matchFeatures(m, stbid, { trade: new Map([[String(stbid), tradeMult({ Id: stbid }, roles)]]) }))
    .filter((f): f is MatchFeatures => !!f)
    .slice(0, 20)
  if (!feats.length) return { error: 'noRated', stbid: String(stbid) }

  const rows = feats.map((f) => {
    const s = scoreMatch(f, roles, 'career')
    return { ...f, x: undefined, c: s.c, parts: s.parts, score: to10(s.pct), mark: markOf(s.pct) }
  })
  // 卡尔曼从旧到新
  const chron = [...rows].reverse()
  const k = kalman(chron.map((r) => r.c), chron.map((r) => r.minutes))
  const playerQ = MODEL.playerPct
  const pct = pctOf(k.m, playerQ)
  const sdM = Math.sqrt(k.P)
  const range: [number, number] = [to10(pctOf(k.m - sdM, playerQ)), to10(pctOf(k.m + sdM, playerQ))]
  const value = to10(pct)
  const tier = tierOf(pct)
  const parts: Record<string, number | null> = {}
  for (const key of ['kd', 'contrib', 'obj', 'outcome'] as const) {
    const v = rows.map((r) => r.parts[key]).filter((x): x is number => x != null)
    parts[key] = v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null
  }

  // 解释：挑出偏离普通最明显的几项（分项是同条件玩家里的百分位，0.5 = 普通）
  const kdMed = median(feats.map((f) => f.kd))
  const contribMed = median(feats.map((f) => f.contrib).filter((x): x is number => x != null))
  const objMed = median(feats.map((f) => f.obj).filter((x): x is number => x != null))
  const avgExp = feats.reduce((a, f) => a + f.E, 0) / feats.length
  const winRate = feats.filter((f) => f.won).length / feats.length
  const frontShare = FRONT.reduce((s, q) => s + roles[q], 0)
  const reasons: DragonReason[] = []
  const push = (key: string, weight: number, params: Record<string, unknown> = {}): void => {
    reasons.push({ key, weight: Math.round(weight * 100) / 100, params })
  }
  const dev = (p: number | null): number => (p == null ? 0 : p - 0.5)
  if (dev(parts.kd) <= -0.12) {
    push(frontShare >= 0.5 ? 'kdLowFront' : 'kdLowSupport', dev(parts.kd) * 4, {
      kd: (kdMed as number).toFixed(2), p: Math.round((parts.kd as number) * 100)
    })
  } else if (dev(parts.kd) >= 0.12) {
    push('kdHigh', dev(parts.kd) * 4, { kd: (kdMed as number).toFixed(2), p: Math.round((parts.kd as number) * 100) })
  }
  if (Math.abs(dev(parts.contrib)) >= 0.12) {
    push((parts.contrib as number) > 0.5 ? 'contribHigh' : 'contribLow', dev(parts.contrib) * 4, {
      x: contribMed != null ? contribMed.toFixed(2) : '-'
    })
  }
  const over = winRate - avgExp
  if (MODEL.weights.out && Math.abs(over) >= 0.1) {
    push(over > 0 ? 'overperform' : 'underperform', over * 3, {
      win: Math.round(winRate * 100), exp: Math.round(avgExp * 100)
    })
  }
  if (avgExp <= 0.42) push('underdog', 0, { exp: Math.round(avgExp * 100) })
  const nConscript = feats.filter((f) => f.conscript).length
  if (nConscript) push('conscript', 0, { n: nConscript })
  const nAfk = feats.filter((f) => f.afk).length
  if (nAfk) push('afkGames', -0.3 * nAfk, { n: nAfk })
  const nShort = feats.filter((f) => f.minutes < 10).length
  if (nShort >= 3) push('shortGames', 0, { n: nShort })
  if (!roles.known) push('roleUnknown', 0)
  if (feats.length < 8) push('fewMatches', 0, { n: feats.length })
  reasons.sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))

  const roleOut = { known: roles.known } as DragonScore['roles']
  for (const q of ROLE_KEYS) roleOut[q] = Math.round(roles[q] * 100)
  return {
    stbid: String(stbid),
    value,
    range,
    tier,
    confidence: Math.round((1 - k.P / (k.P0 + MODEL.kalman.q * feats.length)) * 100) / 100,
    matchCount: feats.length,
    roles: roleOut,
    parts,
    summary: {
      kdMedian: kdMed,
      kdAgg: (() => {
        const d = feats.reduce((a, f) => a + f.destruction, 0)
        const l = feats.reduce((a, f) => a + f.losses, 0)
        return l > 0 ? Math.round((d / l) * 100) / 100 : null
      })(),
      contribMedian: contribMed,
      objMedian: objMed,
      avgExpected: Math.round(avgExp * 100) / 100,
      winRate: Math.round(winRate * 100) / 100
    },
    reasons,
    rows: rows.map(({ c, x, S, E, eloN, gapN, ...r }) => r)
  }
}

export interface ReviewPlayer {
  id: string
  name: string
  teamId: number
  score: number
  mark: Mark
  titles: Title[]
  mvp: boolean
  blame: boolean
  afk: boolean
  impact: number
  outnumbered: boolean
  conscript: boolean
  won: boolean | null
  rated: boolean
  roleKnown: boolean
  roles: Record<string, number>
  parts: ScoreParts
  kd: number
  contrib: number | null
  obj: number | null
}
export interface MatchReview {
  fid: string
  winnerTeam: number | null
  rated: boolean
  players: ReviewPlayer[]
}

/**
 * 单局复盘：每个人的龙/区/泯（和同分段、同角色比）+ 称号（只看本局实际作用）
 * @param opts.rolesById 没有单位数据时的后备：{ [玩家ID]: { categoryPreferences, highlightUnits } }
 */
export function analyzeMatch(
  mi: MatchInfo,
  fid: string | number,
  opts: {
    winnerTeam?: number | null
    rolesById?: Record<string, { categoryPreferences?: CategoryPreference[]; highlightUnits?: HighlightUnit[] }>
    unitMap?: UnitMap
    /** false = 不做交换加权（和老版对拍用） */
    trade?: boolean
  } = {}
): MatchReview {
  const raw: MatchEntry = { matchId: fid, data: mi }
  // 胜方：排位局看 ELO 涨跌（赢必涨），否则用传入的胜方
  let winnerTeam: number | null = null
  const ratedP = Object.values(mi.Data || {}).find(
    (p) => isRated(p) && (teamOf(p) === 0 || teamOf(p) === 1)
  )
  if (ratedP) {
    winnerTeam = (ratedP.NewRating as number) > (ratedP.OldRating as number) ? teamOf(ratedP) : 1 - teamOf(ratedP)
  } else if (opts.winnerTeam === 0 || opts.winnerTeam === 1) {
    winnerTeam = opts.winnerTeam
  }
  // 称号（含功劳最大 / 背锅 / 掉线）：只看这一局的实际作用，不看 ELO
  const aw = awardTitles(mi, { winnerTeam, unitMap: opts.unitMap })
  const inactive = new Set(Object.keys(aw).filter((id) => aw[id].gone))
  const absence = new Map(
    Object.entries(aw).filter(([, v]) => v.gone).map(([id, v]) => [id, v.absence] as const)
  )
  const rolesOf = (p: PlayerData): Roles => {
    const career = opts.rolesById?.[String(p.Id)]
    return (
      rolesFromUnits(p, opts.unitMap) ||
      (career && rolesFromCareer(career.categoryPreferences, career.highlightUnits, opts.unitMap)) ||
      defaultRoles()
    )
  }
  const trade = new Map<string, TradeMult>()
  if (opts.trade !== false) {
    for (const p of Object.values(mi.Data || {})) trade.set(String(p.Id), tradeMult(p, rolesOf(p), opts.unitMap))
  }
  const players: ReviewPlayer[] = []
  for (const p of Object.values(mi.Data || {})) {
    const tid = teamOf(p)
    if (tid !== 0 && tid !== 1) continue // 观战
    const f = matchFeatures(raw, p.Id, { allowUnrated: true, winnerTeam, inactive, absence, trade })
    if (!f) continue
    const roles = rolesOf(p)
    // 龙/区/泯：和同角色构成、同分段的玩家比（这里才考虑 ELO）
    const s = scoreMatch(f, roles, 'match')
    const a = aw[String(p.Id)]
    players.push({
      id: String(p.Id),
      name: p.Name || '',
      teamId: tid,
      score: to10(s.pct),
      mark: markOf(s.pct),
      titles: a?.titles || [],
      mvp: !!a?.mvp,
      blame: !!a?.blame,
      afk: !!a?.gone,
      impact: a?.impact ?? 0,
      outnumbered: f.outnumbered,
      conscript: f.conscript,
      won: f.won,
      rated: f.rated,
      roleKnown: roles.known,
      roles: Object.fromEntries(ROLE_KEYS.map((q) => [q, Math.round((roles[q] || 0) * 100)])),
      parts: s.parts,
      kd: f.kd,
      contrib: f.contrib,
      obj: f.obj
    })
  }
  return { fid: String(fid), winnerTeam, rated: players.some((p) => p.rated), players }
}
