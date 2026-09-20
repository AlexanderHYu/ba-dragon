// ================= 龙区分 =================
// 越高越像龙，越低越像区。两种用法：
//   computeDragonScore —— 玩家的龙区分：最近 20 场排位局逐场打分，卡尔曼滤波汇总成 1~10
//   analyzeMatch       —— 单局复盘：一局里每个人的龙/区/泯（和同分段同角色比）+ 称号（titles.ts）
// 所有参数都来自真实数据拟合（model.json），这里只有公式，没有拍脑袋的数字。纯函数、无 I/O。
//
// 每场三个表现指标 + 一个胜负项：
//   K/D    —— log2(摧毁分 ÷ 损失分)
//   贡献   —— log2(本人摧毁分 ÷ 本队在线队员人均摧毁分)
//   占点   —— log2(本人占点 ÷ 本队在线队员人均占点)（照算但权重为 0：和地图、选位强相关，不计入）
//   胜负   —— 实际结果 − Elo 预期胜率（按两队在线队员的赛前平均 ELO；缺人的一方按弱若干分算）
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
      kd: Math.log2((D + C_SCORE) / (L + C_SCORE)),
      con: Math.log2((D + C_SCORE) / (avgD + C_SCORE)),
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
  if (f.S != null) parts.outcome = phi(out)
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
  rows: unknown[]
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
    .map((m) => matchFeatures(m, stbid))
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
  if (Math.abs(over) >= 0.1) {
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
  const players: ReviewPlayer[] = []
  for (const p of Object.values(mi.Data || {})) {
    const tid = teamOf(p)
    if (tid !== 0 && tid !== 1) continue // 观战
    const f = matchFeatures(raw, p.Id, { allowUnrated: true, winnerTeam, inactive, absence })
    if (!f) continue
    const career = opts.rolesById?.[String(p.Id)]
    const roles =
      rolesFromUnits(p, opts.unitMap) ||
      (career && rolesFromCareer(career.categoryPreferences, career.highlightUnits, opts.unitMap)) ||
      defaultRoles()
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
