// ================= 单局复盘页 =================
// 把 /api/match 的单局原始数据（每个玩家的战绩 + 每个单位的出生/阵亡/伤害/击杀）整理成复盘页要的东西：
//   总览（双方对比、阵营、预期胜率）、玩家明细、单位使用率/死亡率/效率、兵力时间线、本局要点。
// 纯函数、无 I/O；龙/区/泯和称号由 dragon/score.ts 的 analyzeMatch 算好后传进来。
//
// 两处是估算，界面上要标出来：
//   单位价格：单位库只有基础价格（不含配装），所以每个玩家按他自己的官方总数等比例缩放——
//     出兵花费对齐「出兵分 − 退款分」，损失对齐「损失分」。队伍总数和官方一致，单个单位的花费仍是估算。
//   单位的击杀分：数据里每个单位只有击杀数、没有击杀分，所以把这个人的总击杀分按各单位击杀数分下去。
// WasRefunded 不是「取消出兵」，而是单位回收了：飞机返航、卡车开回、开局卖掉。返航的飞机照样打了仗，
// 所以每条记录都算一次出兵（飞机就是一个架次）；官方按原价全额退款，所以花费里不算它。
import { num, type MatchInfo, type PlayerData } from '../types/batrace'
import {
  MODEL,
  ROLE_KEYS,
  absenceOf,
  hasRating,
  isGone,
  isRated,
  matchFeatures,
  teamOf,
  titleMetrics,
  rolesFromUnits,
  type Mark,
  type MatchReview,
  type ReviewPlayer,
  type RoleKey,
  type Title,
  type UnitEntry,
  type UnitMap
} from '../dragon'

const median = (a: number[]): number | null => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const h = s.length >> 1
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
const r1 = (x: number): number => Math.round(x * 10) / 10
const r2 = (x: number): number => Math.round(x * 100) / 100

export const ROLE_NAME: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼', null: '运输'
}

export interface ReportUnit {
  id: number
  /** 配装（OptionIds 排序后拼起来） */
  options: string
  name: string
  role: RoleKey | null
  roleName: string
  team: number
  /** 估算单价（含配装） */
  cost: number
  /** 出动价值：架次 × 单价（返航的也算，使用率用这个） */
  value: number
  count: number
  deployed: number
  refunded: number
  dead: number
  spent: number
  lost: number
  deathRate: number | null
  lifeMedian: number | null
  dmg: number
  kills: number
  dmgPerCost: number | null
  /** 击杀分（估算） */
  destr: number
  destrPerCost: number | null
  killsPer1k: number | null
  users: string[]
}

export interface ReportPlayer {
  id: string
  name: string
  team: number
  me: boolean
  eloBefore: number | null
  eloAfter: number | null
  score: number | null
  mark: Mark | null
  titles: Title[]
  afk: boolean
  parts: ReviewPlayer['parts'] | null
  roles: Record<string, number> | null
  D: number
  L: number
  net: number
  kd: number | null
  kills: number
  deaths: number
  dmg: number
  dmgTaken: number
  obj: number
  spent: number
  spawnScore: number
  refundScore: number
  lostValue: number
  unitsDeployed: number
  unitsRefunded: number
  unitsDead: number
  survival: number | null
  lifeMedian: number | null
  dmgPerCost: number | null
  dPerCost: number | null
  supply: number
  supplyFromAllies: number
  supplyByAllies: number
  supplyCaptured: number
  supplyLostToEnemy: number
  airdrop: number
  ffDestroyed: number
  ffLost: number
  buildings: number
  exp: number
  medals: number
  deserter: boolean
  leftAtMin: number | null
  units: ReportUnit[]
}

export interface ReportTeam {
  team: number
  won: boolean | null
  faction: 'RU' | 'US' | null
  players: number
  gone: string[]
  avgElo: number | null
  eloDelta: number | null
  expected: number | null
  D: number
  L: number
  kills: number
  deaths: number
  dmg: number
  dmgTaken: number
  obj: number
  spent: number
  lostValue: number
  supply: number
  supplyCaptured: number
  unitsDeployed: number
  unitsDead: number
  roles: Record<string, number>
}

export interface TimelineEvent {
  min: number
  team: number
  type: 'leave' | 'spike'
  text: string
}
export interface Insight {
  kind: 'good' | 'bad' | 'neutral'
  text: string
}
export interface MatchReport {
  fid: string
  map: string
  startTime: number
  durationSec: number
  endReason: number | null
  victoryLevel: number | null
  objectiveZones: number | null
  winnerTeam: number | null
  rated: boolean
  teams: ReportTeam[]
  players: ReportPlayer[]
  units: ReportUnit[]
  timeline: {
    minutes: number
    spawn: number[][]
    loss: number[][]
    field: number[][]
    events: TimelineEvent[]
  }
  insights: Insight[]
}

interface UnitAgg {
  id: number
  /** 配装（OptionIds 排序后拼起来），空串 = 没有配装信息 */
  options: string
  name: string
  role: RoleKey | null
  country: number
  team: number
  count: number
  refunded: number
  dead: number
  dmg: number
  kills: number
  lives: number[]
  users: Set<string>
  spent: number
  lost: number
  destr: number
  price: number
}

export interface ReportOpts {
  fid: string | number
  /** analyzeMatch 的结果（龙/区/泯、称号） */
  review?: MatchReview
  /** 本机账号 ID（高亮「我」） */
  localIds?: string[]
  mapName?: (id?: number) => string
  unitMap?: UnitMap
  /**
   * 同一个单位的不同配装分开统计（默认开）。
   * BATrace 的公开接口没有配装名字，所以只能显示「配装 A / B」，
   * 但至少能把 Airborne 和 Airborne NGWS 的数据分开看。对拍老版时传 false。
   */
  groupByLoadout?: boolean
}

/** 配装签名：OptionIds 排序后拼起来 */
function optionsKey(ids?: number[]): string {
  if (!Array.isArray(ids) || !ids.length) return ''
  return [...ids].sort((a, b) => a - b).join(',')
}

/**
 * 同一个单位出现了多种配装就给名字加上「配装 A / B」，按出兵次数排，出得多的是 A。
 * 只出现一种配装的单位名字不动。
 */
function labelLoadouts(units: ReportUnit[]): void {
  const byUnit = new Map<string, ReportUnit[]>()
  for (const u of units) {
    const k = u.team + ':' + u.id
    const list = byUnit.get(k)
    if (list) list.push(u)
    else byUnit.set(k, [u])
  }
  for (const list of byUnit.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => b.deployed - a.deployed)
    sorted.forEach((u, i) => {
      u.name = u.name + '（配装 ' + String.fromCharCode(65 + i) + '）'
    })
  }
}

export function buildMatchReport(mi: MatchInfo, opts: ReportOpts): MatchReport {
  const um: UnitMap = opts.unitMap || MODEL.units || {}
  const start = num(mi.StartTime)
  const dur = num(mi.TotalPlayTimeInSec) || Math.max(0, num(mi.EndTime) - start)
  const minutes = Math.max(1, Math.ceil(dur / 60))
  const all = Object.values(mi.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1)
  const review: MatchReview = opts.review || ({ players: [] } as unknown as MatchReview)
  const revById = Object.fromEntries((review.players || []).map((p) => [p.id, p]))
  const localIds = new Set((opts.localIds || []).map(String))
  const metrics = Object.fromEntries(titleMetrics(mi, um).map((m) => [m.id, m]))
  const winner = review.winnerTeam != null ? review.winnerTeam : null

  // ---------- 玩家 ----------
  const unitAgg = new Map<string, UnitAgg>()
  const timeline = [0, 1].map(() => ({
    spawn: new Array<number>(minutes).fill(0),
    loss: new Array<number>(minutes).fill(0),
    deathsN: new Array<number>(minutes).fill(0)
  }))
  const minuteOf = (t: unknown): number =>
    Math.max(0, Math.min(minutes - 1, Math.floor((num(t) - start) / 60)))

  const players: ReportPlayer[] = all.map((p) => {
    const id = String(p.Id)
    const team = teamOf(p)
    const rv = revById[id]
    const m = metrics[id]
    const units = Object.values(p.UnitData || {})
    // 缩放系数：官方出兵/损失总数 ÷ 按基础价格算的总数
    let baseDeployed = 0
    let baseLost = 0
    for (const u of units) {
      const c = um[u.Id]?.[1] || 0
      if (!u.WasRefunded) baseDeployed += c
      if (u.DeathTime) baseLost += c
    }
    const kSpawn =
      baseDeployed > 0 && num(p.TotalSpawnedUnitScore) > 0
        ? Math.max(0.5, (num(p.TotalSpawnedUnitScore) - num(p.TotalRefundedUnitScore)) / baseDeployed)
        : 1
    const kLoss = baseLost > 0 && num(p.LossesScore) > 0 ? num(p.LossesScore) / baseLost : kSpawn
    // 这个人平均每次击杀值多少击杀分（分配单位击杀分用）
    const unitKills = units.reduce((s, u) => s + num(u.KilledCount), 0)
    const dPerKill = unitKills > 0 ? num(p.DestructionScore) / unitKills : 0
    let spent = 0
    let refundN = 0
    let deadN = 0
    let deployedN = 0
    let lostValue = 0
    const lives: number[] = []
    const mine = new Map<string, UnitAgg>()
    for (const u of units) {
      const e: UnitEntry = um[u.Id] || [null, 0, '单位#' + u.Id, 0, -1]
      const cost = (e[1] || 0) * kSpawn // 估算的实际价格（含配装）
      const lossCost = (e[1] || 0) * kLoss
      const refunded = !!u.WasRefunded
      const dead = !!u.DeathTime
      const life = dead && u.SpawnTime ? Math.max(0, num(u.DeathTime) - num(u.SpawnTime)) : null
      deployedN++
      if (refunded) refundN++
      else {
        spent += cost
        if (u.SpawnTime) timeline[team].spawn[minuteOf(u.SpawnTime)] += cost
      }
      if (dead) {
        deadN++
        lostValue += lossCost
        if (life != null) lives.push(life)
        timeline[team].loss[minuteOf(u.DeathTime)] += lossCost
        timeline[team].deathsN[minuteOf(u.DeathTime)]++
      }
      // 按单位型号聚合；开了配装分组就连配装一起分（同一个单位的不同挂载分开统计）
      const optKey = opts.groupByLoadout === false ? '' : optionsKey(u.OptionIds)
      for (const [map, key] of [
        [mine, u.Id + '|' + optKey],
        [unitAgg, team + ':' + u.Id + '|' + optKey]
      ] as [Map<string, UnitAgg>, string][]) {
        const a: UnitAgg = map.get(key) || {
          id: u.Id, options: optKey, name: e[2], role: e[0], country: e[3], team,
          count: 0, refunded: 0, dead: 0, dmg: 0, kills: 0, lives: [],
          users: new Set<string>(), spent: 0, lost: 0, destr: 0, price: cost
        }
        a.count++
        if (!refunded) a.spent += cost
        if (dead) a.lost += lossCost
        if (refunded) a.refunded++
        if (dead) a.dead++
        a.dmg += num(u.TotalDamageDealt)
        a.kills += num(u.KilledCount)
        a.destr += num(u.KilledCount) * dPerKill
        if (life != null) a.lives.push(life)
        a.users.add(p.Name || id)
        map.set(key, a)
      }
    }
    const roles = rolesFromUnits(p, um)
    const D = num(p.DestructionScore)
    const L = num(p.LossesScore)
    const unitList = [...mine.values()].map(finishUnit).sort((a, b) => b.spent - a.spent)
    if (opts.groupByLoadout !== false) labelLoadouts(unitList)
    return {
      id, name: p.Name || id, team, me: localIds.has(id),
      eloBefore: hasRating(p) ? r2(p.OldRating as number) : null,
      eloAfter: hasRating(p) ? r2(p.NewRating as number) : null,
      score: rv?.score ?? null,
      mark: rv?.mark || null,
      titles: rv?.titles || [],
      afk: !!rv?.afk,
      parts: rv?.parts || null,
      roles: roles ? Object.fromEntries(ROLE_KEYS.map((k) => [k, Math.round(roles[k] * 100)])) : null,
      D, L, net: D - L, kd: L > 0 ? r2(D / L) : null,
      kills: num(p.Destruction), deaths: num(p.Losses),
      dmg: num(p.DamageDealt), dmgTaken: num(p.DamageReceived),
      obj: num(p.ObjectivesCaptured),
      spent: Math.round(spent), spawnScore: num(p.TotalSpawnedUnitScore),
      refundScore: num(p.TotalRefundedUnitScore), lostValue: Math.round(lostValue),
      unitsDeployed: deployedN, unitsRefunded: refundN, unitsDead: deadN,
      survival: deployedN ? Math.round(((deployedN - deadN) / deployedN) * 100) : null,
      lifeMedian: lives.length ? Math.round(median(lives) as number) : null,
      dmgPerCost: spent ? r2(num(p.DamageDealt) / spent) : null,
      // 每 1 点花费打出的击杀分（玩家级是精确值）
      dPerCost: spent ? r2(num(p.DestructionScore) / spent) : null,
      supply: num(p.SupplyPointsConsumed),
      supplyFromAllies: num(p.SupplyPointsConsumedFromAllies),
      supplyByAllies: num(p.SupplyPointsConsumedByAllies),
      supplyCaptured: num(p.SupplyCaptured),
      supplyLostToEnemy: num(p.SupplyCapturedByEnemy),
      airdrop: num(p.SupplyAirdropped),
      ffDestroyed: num(p.DestructionFriendlyFireCost),
      ffLost: num(p.LossesByFriendlyFireScore),
      buildings: m?.buildings || 0,
      exp: num(p.TotalExp),
      medals: Array.isArray(p.Medals) ? p.Medals.length : 0,
      deserter: !!p.Deserter,
      leftAtMin: rv?.afk && m?.lastSpawnFrac != null ? Math.round((m.lastSpawnFrac * dur) / 60) : null,
      units: unitList
    }
  })

  // ---------- 队伍 ----------
  const sum = <T,>(list: T[], k: keyof T): number => list.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const teams: ReportTeam[] = [0, 1].map((t) => {
    const ps = players.filter((p) => p.team === t)
    const us = [...unitAgg.values()].filter((u) => u.team === t)
    let ru = 0
    let us2 = 0
    for (const u of us) {
      if (u.country === 1) ru += u.count
      else if (u.country === 2) us2 += u.count
    }
    const roleCost = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as Record<string, number>
    for (const u of us) if (u.role && roleCost[u.role] != null) roleCost[u.role] += u.spent
    const rc = Object.values(roleCost).reduce((a, b) => a + b, 0) || 1
    const rated = ps.filter((p) => p.eloBefore != null)
    return {
      team: t,
      won: winner == null ? null : winner === t,
      faction: ru + us2 === 0 ? null : ru > us2 ? 'RU' : 'US',
      players: ps.length,
      gone: ps.filter((p) => p.afk).map((p) => p.name),
      avgElo: rated.length ? Math.round(sum(rated, 'eloBefore') / rated.length) : null,
      eloDelta: rated.length
        ? r1(rated.reduce((s, p) => s + ((p.eloAfter as number) - (p.eloBefore as number)), 0) / rated.length)
        : null,
      expected: null,
      D: sum(ps, 'D'), L: sum(ps, 'L'), kills: sum(ps, 'kills'), deaths: sum(ps, 'deaths'),
      dmg: sum(ps, 'dmg'), dmgTaken: sum(ps, 'dmgTaken'),
      obj: sum(ps, 'obj'), spent: sum(ps, 'spent'), lostValue: sum(ps, 'lostValue'),
      supply: sum(ps, 'supply'), supplyCaptured: sum(ps, 'supplyCaptured'),
      unitsDeployed: sum(ps, 'unitsDeployed'), unitsDead: sum(ps, 'unitsDead'),
      roles: Object.fromEntries(ROLE_KEYS.map((k) => [k, Math.round((roleCost[k] / rc) * 100)]))
    }
  })
  // 赛前预期胜率（两队在线队员平均分，缺人按模型扣分）：用胜方一名在线玩家的特征取
  let expected: [number, number] | null = null
  const anyRated = all.find((p) => isRated(p) && teamOf(p) === 0)
  if (anyRated) {
    const gone = new Map(titleMetrics(mi, um).filter(isGone).map((m) => [m.id, absenceOf(m)] as const))
    const f = matchFeatures({ matchId: opts.fid, data: mi }, anyRated.Id, {
      inactive: new Set(gone.keys()),
      absence: gone
    })
    if (f) expected = [r2(f.E), r2(1 - f.E)]
  }
  teams[0].expected = expected ? expected[0] : null
  teams[1].expected = expected ? expected[1] : null

  // ---------- 单位 ----------
  const units = [...unitAgg.values()].map(finishUnit).sort((a, b) => b.spent - a.spent)
  if (opts.groupByLoadout !== false) labelLoadouts(units)

  // ---------- 时间线：场上兵力 = 累计出兵 − 累计损失（估算） ----------
  const field = timeline.map((tl) => {
    let acc = 0
    return tl.spawn.map((s, i) => (acc += s - tl.loss[i]))
  })
  const events: TimelineEvent[] = []
  for (const p of players) {
    if (p.afk && p.leftAtMin != null) {
      events.push({ min: p.leftAtMin, team: p.team, type: 'leave', text: p.name + ' 掉线/挂机' })
    }
  }
  for (const t of [0, 1]) {
    // 损失最惨的一分钟（至少是全场每分钟平均损失的 2.5 倍才算）
    const loss = timeline[t].loss
    const avg = loss.reduce((a, b) => a + b, 0) / minutes
    let mx = -1
    let at = -1
    loss.forEach((v, i) => {
      if (v > mx) {
        mx = v
        at = i
      }
    })
    if (at >= 0 && mx > avg * 2.5 && mx >= 800) {
      events.push({ min: at, team: t, type: 'spike', text: '一分钟内损失 ' + Math.round(mx) })
    }
  }
  events.sort((a, b) => a.min - b.min)

  const report: MatchReport = {
    fid: String(opts.fid || ''),
    map: opts.mapName ? opts.mapName(mi.MapId) : String(mi.MapId ?? ''),
    startTime: start * 1000,
    durationSec: dur,
    endReason: mi.EndMatchReason ?? null,
    victoryLevel: mi.VictoryLevel ?? null,
    objectiveZones: mi.TotalObjectiveZonesCount ?? null,
    winnerTeam: winner,
    rated: !!review.rated,
    teams,
    players,
    units,
    timeline: { minutes, spawn: timeline.map((t) => t.spawn), loss: timeline.map((t) => t.loss), field, events },
    insights: []
  }
  report.insights = insights(report)
  return report
}

function finishUnit(a: UnitAgg): ReportUnit {
  const deployed = a.count // 每条记录都是一次出兵（返航的也算）
  const spent = a.spent
  return {
    id: a.id,
    options: a.options,
    name: a.name,
    role: a.role,
    roleName: ROLE_NAME[String(a.role)] || ROLE_NAME.null,
    team: a.team,
    cost: Math.round(a.price),
    value: Math.round(a.count * a.price),
    count: a.count,
    deployed,
    refunded: a.refunded,
    dead: a.dead,
    spent: Math.round(spent),
    lost: Math.round(a.lost),
    deathRate: deployed ? Math.round((a.dead / deployed) * 100) : null,
    lifeMedian: a.lives.length ? Math.round(median(a.lives) as number) : null,
    dmg: Math.round(a.dmg),
    kills: a.kills,
    dmgPerCost: spent ? r2(a.dmg / spent) : null,
    destr: Math.round(a.destr),
    destrPerCost: spent ? r2(a.destr / spent) : null,
    killsPer1k: spent ? r1((a.kills / spent) * 1000) : null,
    users: [...a.users]
  }
}

// 本局要点：挑几条明显的事实，给复盘一个开头
function insights(r: MatchReport): Insight[] {
  const out: Insight[] = []
  const [A, B] = r.teams
  const tn = (t: number): string => (t === 0 ? 'A 队' : 'B 队')
  const fac = (t: number): string =>
    r.teams[t].faction === 'RU' ? '（俄）' : r.teams[t].faction === 'US' ? '（美）' : ''
  if (r.winnerTeam != null && A.expected != null) {
    const w = r.teams[r.winnerTeam]
    if ((w.expected as number) < 0.35) {
      out.push({ kind: 'good', text: tn(r.winnerTeam) + fac(r.winnerTeam) + '以弱胜强：赛前预期胜率只有 ' + Math.round((w.expected as number) * 100) + '%' })
    } else if ((w.expected as number) > 0.75) {
      out.push({ kind: 'neutral', text: tn(r.winnerTeam) + fac(r.winnerTeam) + '赢得不意外：赛前预期胜率 ' + Math.round((w.expected as number) * 100) + '%' })
    }
  }
  // 交换比
  if (A.L && B.L) {
    const better = A.D - A.L >= B.D - B.L ? 0 : 1
    const o = r.teams[better]
    const x = r.teams[1 - better]
    const ratio = x.D ? o.D / Math.max(1, x.D) : null
    if (ratio && ratio >= 1.3) {
      out.push({
        kind: better === r.winnerTeam ? 'neutral' : 'bad',
        text: tn(better) + '摧毁是对面的 ' + r2(ratio) + ' 倍' + (r.winnerTeam != null && better !== r.winnerTeam ? '，却输了' : '')
      })
    }
  }
  for (const t of [0, 1]) {
    const T = r.teams[t]
    if (T.gone.length) out.push({ kind: 'bad', text: tn(t) + '有人掉线/挂机：' + T.gone.join('、') })
    // 空军损失占比
    const air = r.units
      .filter((u) => u.team === t && (u.role === 'heli' || u.role === 'jet'))
      .reduce((s, u) => s + u.lost, 0)
    if (T.lostValue && air / T.lostValue >= 0.35 && air >= 1500) {
      out.push({ kind: 'bad', text: tn(t) + '损失里 ' + Math.round((air / T.lostValue) * 100) + '% 是飞机（' + Math.round(air) + '）' })
    }
  }
  // 最赚、最亏的单位（出了至少 2 个；运输单位本来就不打伤害，不参与）
  const pool = r.units.filter((u) => u.role && u.deployed >= 2 && u.spent >= 300)
  const best = [...pool].sort((a, b) => (b.destrPerCost as number) - (a.destrPerCost as number))[0]
  const worst = [...pool]
    .filter((u) => (u.deathRate as number) >= 80)
    .sort((a, b) => (a.destrPerCost as number) - (b.destrPerCost as number))[0]
  if (best) {
    out.push({ kind: 'good', text: '最赚的单位：' + tn(best.team) + '的 ' + best.name + '（出了 ' + best.deployed + ' 个，每 1 点花费打出 ' + best.destrPerCost + ' 击杀分，估算）' })
  }
  if (worst) {
    out.push({ kind: 'bad', text: '最亏的单位：' + tn(worst.team) + '的 ' + worst.name + '（出了 ' + worst.deployed + ' 个、死了 ' + worst.dead + ' 个，每 1 点花费只打出 ' + worst.destrPerCost + ' 击杀分，估算）' })
  }
  for (const ev of r.timeline.events) {
    if (ev.type === 'spike') out.push({ kind: 'neutral', text: '第 ' + (ev.min + 1) + ' 分钟 ' + tn(ev.team) + ev.text })
  }
  return out
}
