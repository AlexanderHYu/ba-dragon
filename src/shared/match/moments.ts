// ================= 关键时刻 =================
// 从每个单位每次出场的记录里找出这一局的高光、犯罪、大量阵亡和侦察时刻。
//
// 数据的边界（写在界面说明里）：
//   - 出兵时间、阵亡时间是精确的（秒）。
//   - 击杀只有「这次出场一共杀了几个」，没有时间、不知道杀的是谁。
//     所以击杀只能推断到这次出场的存活时间段里：存活越短越准，太长（> maxKillWindow）就不标时间。
//     「同时段对方阵亡了什么」只说时间重叠，不说是他杀的。
//   - 侦察和炮击的关系也只说时间上前后相邻，不说因果。
// 纯函数、无 I/O，门槛都是参数，默认值用本地档案的对局分布定（scripts 里有统计脚本）。
import type { RoleKey } from '../dragon'

/** 一个单位的一次出场（飞机是一个架次） */
export interface Sortie {
  pid: string
  name: string
  team: number
  unitId: number
  unitName: string
  role: RoleKey | null
  /** 单价（含配装；没有游戏数据时是估算） */
  cost: number
  /** 阵亡时算进损失的价值 */
  lossCost: number
  /** 相对开战的秒数；部署阶段出的兵是负数 */
  spawn: number
  /** 相对开战的秒数；没阵亡是 null */
  death: number | null
  kills: number
  /** 这次出场造成的伤害 */
  dmg: number
  refunded: boolean
}

export type MomentKind = 'highlight' | 'blunder' | 'wipe' | 'recon'

export interface Moment {
  kind: MomentKind
  /** 细分：收割 / 秒送 / 连续损失 / 大量阵亡 / 侦察后对方大量损失 / 侦察出兵 */
  sub: 'reap' | 'quickDeath' | 'burst' | 'wipe' | 'reconStrike' | 'reconSpawn'
  team: number
  /** 属于哪个玩家（大量阵亡是全队的，为 null） */
  pid: string | null
  name: string | null
  /** 相对开战的秒数 */
  t0: number
  t1: number
  /** 一句话 */
  text: string
  /** 补充说明（同时段对方阵亡了什么、这一波死了哪些兵种） */
  detail: string
  /** 排序用：越大越值得看 */
  weight: number
  /** 只在时间线上画个小标记，不进本局要点 */
  minor: boolean
}

export interface MomentOpts {
  /** 收割：一次出场至少击杀几个 */
  reapKills: number
  /** 收割：存活超过这么久（秒）就不标时间（击杀时间定不下来） */
  maxKillWindow: number
  /** 秒送：至少多贵 */
  quickCost: number
  /** 连续损失：一个人在这么长的窗口里（秒） */
  burstSec: number
  /** 连续损失：至少丢几个 */
  burstCount: number
  /** 连续损失：至少丢多少价值 */
  burstValue: number
  /** 大量阵亡：一队在 burstSec 窗口里至少损失多少 */
  wipeValue: number
  /** 大量阵亡：还要至少是这一队平均每分钟损失的几倍 */
  wipeVsAvg: number
  /** 侦察：出兵后这么多秒内对方的损失算「之后」 */
  reconFollowSec: number
  /** 侦察：之后对方至少损失多少才连起来写 */
  reconFollowValue: number
  /** 侦察：之后对方的损失还要至少是他们平时同样长时间损失的几倍 */
  reconVsAvg: number
}

/**
 * 默认门槛：本地档案 167 局统计（scripts/stat-moments.ts），让每类时刻出现在约三到五成的对局里，
 * 进本局要点的平均每局约 3 条。收割 56%、秒送 50%、连续损失 32%、大量阵亡 50%、侦察后对方大量损失 32%。
 */
export const MOMENT_DEFAULTS: MomentOpts = {
  reapKills: 5,
  maxKillWindow: 120,
  quickCost: 220,
  burstSec: 60,
  burstCount: 6,
  burstValue: 1200,
  wipeValue: 1800,
  wipeVsAvg: 3,
  reconFollowSec: 150,
  reconFollowValue: 600,
  reconVsAvg: 1.8
}

/**
 * 秒送的时间线：每个兵种阵亡单位存活时间的第 5 百分位（秒）。
 * 不同兵种差得很多：固定翼一个架次本来就只活半分钟左右（中位 34 秒），炮兵中位要将近 10 分钟，
 * 用同一个秒数会把所有正常的飞机架次都算成「秒送」。
 * 数据：本地档案 167 局、约 4.3 万次阵亡（2026-11，scripts/stat-moments.ts 同一批）。
 */
export const QUICK_LIFE: Record<string, number> = {
  armor: 112, inf: 138, recon: 68, arty: 147, aa: 108, heli: 52, jet: 19, null: 41
}

const ROLE_CN: Record<string, string> = {
  armor: '装甲', inf: '步兵', recon: '侦察', arty: '炮兵', aa: '防空', heli: '直升机', jet: '固定翼', null: '运输'
}
const TEAM = (t: number): string => (t === 0 ? 'A 队' : 'B 队')

/** 秒 → 6:05 */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.round(s))
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0')
}

const DRONE = /\b(RQ-|MQ-)|Global Hawk|Okhotnik|Orion|Forpost|Korsar|Shadow/i
const SNIPER = /Snip|Snaip/i
/** 值得标出来的侦察单位：无人机和狙击手（侦察车、侦察坦克到处都是，标了没意义） */
export function notableRecon(s: Pick<Sortie, 'role' | 'unitName'>): boolean {
  if (s.role !== 'recon') return false
  return DRONE.test(s.unitName) || SNIPER.test(s.unitName)
}

/** 一段时间里一队阵亡了什么：「装甲 3、步兵 1（价值 640）」 */
function deathsIn(sorties: Sortie[], team: number, t0: number, t1: number): { text: string; value: number; n: number } {
  const dead = sorties.filter((s) => s.team === team && s.death != null && s.death >= t0 && s.death <= t1)
  const by = new Map<string, number>()
  for (const s of dead) by.set(String(s.role), (by.get(String(s.role)) || 0) + 1)
  const value = dead.reduce((a, s) => a + s.lossCost, 0)
  const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => (ROLE_CN[r] || r) + ' ' + n)
  return { text: parts.join('、'), value: Math.round(value), n: dead.length }
}

/** 一串阵亡里，固定长度窗口内价值最大的那一段 */
function worstWindow(dead: Sortie[], sec: number): { t0: number; t1: number; value: number; list: Sortie[] } | null {
  const d = dead.filter((s) => s.death != null).sort((a, b) => (a.death as number) - (b.death as number))
  let best: { t0: number; t1: number; value: number; list: Sortie[] } | null = null
  let j = 0
  let sum = 0
  for (let i = 0; i < d.length; i++) {
    sum += d[i].lossCost
    while ((d[i].death as number) - (d[j].death as number) > sec) {
      sum -= d[j].lossCost
      j++
    }
    if (!best || sum > best.value) {
      best = { t0: d[j].death as number, t1: d[i].death as number, value: sum, list: d.slice(j, i + 1) }
    }
  }
  return best
}

export function findMoments(sorties: Sortie[], durSec: number, o: Partial<MomentOpts> = {}): Moment[] {
  const opt = { ...MOMENT_DEFAULTS, ...o }
  const out: Moment[] = []
  const live = sorties.filter((s) => !Number.isNaN(s.spawn))

  // ---------- 高光：一次出场在短时间内杀了很多 ----------
  for (const s of live) {
    if (s.kills < opt.reapKills) continue
    const t0 = Math.max(0, s.spawn)
    const t1 = s.death != null ? s.death : durSec
    const win = t1 - t0
    if (win > opt.maxKillWindow) continue
    const enemy = deathsIn(live, 1 - s.team, t0, t1)
    out.push({
      kind: 'highlight',
      sub: 'reap',
      team: s.team,
      pid: s.pid,
      name: s.name,
      t0,
      t1,
      text:
        TEAM(s.team) + ' ' + s.name + ' 的 ' + s.unitName + ' ' +
        (s.death != null ? '出动 ' + Math.round(win) + ' 秒' : '最后 ' + Math.round(win) + ' 秒') +
        '击杀 ' + s.kills + ' 个',
      detail: enemy.n ? '同时段 ' + TEAM(1 - s.team) + '阵亡：' + enemy.text + '（价值 ' + enemy.value + '）' : '',
      // 杀得多、时间短的排前面
      weight: s.kills * (1 + 60 / Math.max(20, win)),
      minor: false
    })
  }

  // ---------- 犯罪 1：贵的单位出兵后很快阵亡，一个没杀到、一点伤害都没打出来 ----------
  for (const s of live) {
    if (s.refunded || s.death == null || s.kills > 0 || s.dmg > 0 || s.cost < opt.quickCost) continue
    const life = s.death - Math.max(0, s.spawn)
    if (life > (QUICK_LIFE[String(s.role)] ?? 60)) continue
    out.push({
      kind: 'blunder',
      sub: 'quickDeath',
      team: s.team,
      pid: s.pid,
      name: s.name,
      t0: Math.max(0, s.spawn),
      t1: s.death,
      text: TEAM(s.team) + ' ' + s.name + ' 的 ' + s.unitName + '（' + Math.round(s.cost) + '）出兵 ' + Math.round(Math.max(0, life)) + ' 秒阵亡，没有造成伤害',
      detail: '',
      weight: s.cost / 50,
      minor: false
    })
  }

  // ---------- 犯罪 2：一个人短时间内连续丢很多 ----------
  const byPlayer = new Map<string, Sortie[]>()
  for (const s of live) if (s.death != null) byPlayer.set(s.pid, [...(byPlayer.get(s.pid) || []), s])
  for (const list of byPlayer.values()) {
    const w = worstWindow(list, opt.burstSec)
    if (!w || w.list.length < opt.burstCount || w.value < opt.burstValue) continue
    const s = w.list[0]
    const roles = deathsIn(list, s.team, w.t0, w.t1)
    out.push({
      kind: 'blunder',
      sub: 'burst',
      team: s.team,
      pid: s.pid,
      name: s.name,
      t0: w.t0,
      t1: w.t1,
      text: TEAM(s.team) + ' ' + s.name + ' 在 ' + Math.max(1, Math.round(w.t1 - w.t0)) + ' 秒内连续损失 ' + w.list.length + ' 个单位（价值 ' + Math.round(w.value) + '）',
      detail: roles.text,
      weight: w.value / 100,
      minor: false
    })
  }

  // ---------- 大量阵亡：一队在一分钟内损失特别多 ----------
  const minutes = Math.max(1, durSec / 60)
  for (const t of [0, 1]) {
    const dead = live.filter((s) => s.team === t && s.death != null)
    const total = dead.reduce((a, s) => a + s.lossCost, 0)
    const w = worstWindow(dead, opt.burstSec)
    if (!w || w.value < opt.wipeValue || w.value < (total / minutes) * opt.wipeVsAvg) continue
    const roles = deathsIn(dead, t, w.t0, w.t1)
    // 这一波主要是谁的
    const who = new Map<string, number>()
    for (const s of w.list) who.set(s.name, (who.get(s.name) || 0) + s.lossCost)
    const top = [...who.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)
    out.push({
      kind: 'wipe',
      sub: 'wipe',
      team: t,
      pid: null,
      name: null,
      t0: w.t0,
      t1: w.t1,
      text: TEAM(t) + ' 在 ' + clock(w.t0) + '–' + clock(w.t1) + ' 损失 ' + w.list.length + ' 个单位（价值 ' + Math.round(w.value) + '）',
      detail: roles.text + (top.length ? '；主要是 ' + top.join('、') + ' 的' : ''),
      weight: w.value / 80,
      minor: false
    })
  }

  // ---------- 侦察 ----------
  // 平时每秒损失多少（按队），用来判断侦察之后对方的损失是不是明显偏多
  const lossRate = [0, 1].map(
    (t) => live.filter((s) => s.team === t && s.death != null).reduce((a, s) => a + s.lossCost, 0) / Math.max(60, durSec)
  )
  for (const s of live) {
    if (s.refunded || !notableRecon(s)) continue
    const t0 = Math.max(0, s.spawn)
    const t1 = t0 + opt.reconFollowSec
    const enemy = deathsIn(live, 1 - s.team, t0, t1)
    // 这段时间里自己这队有没有炮兵在场
    const arty = live.some(
      (a) => a.team === s.team && a.role === 'arty' && !a.refunded && a.spawn <= t1 && (a.death == null || a.death >= t0)
    )
    // 只在「自己炮兵在场 + 对方损失明显多于平时」时才把侦察和对方的损失连起来写
    const linked =
      arty &&
      enemy.value >= opt.reconFollowValue &&
      enemy.value >= lossRate[1 - s.team] * opt.reconFollowSec * opt.reconVsAvg
    out.push({
      kind: 'recon',
      sub: linked ? 'reconStrike' : 'reconSpawn',
      team: s.team,
      pid: s.pid,
      name: s.name,
      t0,
      t1: linked ? t1 : t0,
      text:
        TEAM(s.team) + ' ' + s.name + ' 在 ' + clock(t0) + ' 出了 ' + s.unitName +
        (linked ? '，之后 ' + Math.round(opt.reconFollowSec / 60 * 10) / 10 + ' 分钟内 ' + TEAM(1 - s.team) + ' 损失 ' + enemy.value : ''),
      detail: linked ? TEAM(1 - s.team) + '阵亡：' + enemy.text + '；' + TEAM(s.team) + '炮兵当时在场' : '',
      weight: linked ? enemy.value / 120 : 0.5,
      minor: !linked
    })
  }

  return out.sort((a, b) => a.t0 - b.t0)
}

/**
 * 进本局要点的那几条：每类挑最重要的几条，每个人每类最多一条，免得一个人刷屏。
 * 有的局一条都没有，这是正常的。
 */
export function topMoments(all: Moment[], perKind: Partial<Record<MomentKind, number>> = {}): Moment[] {
  const cap: Record<MomentKind, number> = { highlight: 3, blunder: 3, wipe: 2, recon: 2, ...perKind }
  const out: Moment[] = []
  for (const kind of ['highlight', 'blunder', 'wipe', 'recon'] as MomentKind[]) {
    const seen = new Set<string>()
    const list = all.filter((m) => m.kind === kind && !m.minor).sort((a, b) => b.weight - a.weight)
    for (const m of list) {
      if (out.filter((x) => x.kind === kind).length >= cap[kind]) break
      const k = m.pid ?? 'team' + m.team
      if (seen.has(k)) continue
      seen.add(k)
      out.push(m)
    }
  }
  return out.sort((a, b) => a.t0 - b.t0)
}
