// ================= 配装计算器的算法 =================
// 数据全部来自游戏自带的表（见 docs/game-db.md）。这里分两类：
//
//   【直读】伤害、穿深、装甲、射速、射程、AOE 半径、ECM/诱饵/APS 的参数——游戏里怎么写的就怎么用。
//   【推算】穿甲判定、打死要几发几秒、AOE 随距离怎么衰减、枪炮的命中率——
//           游戏没把公式写进数据里，这些是按数值推出来的模型，界面上都标了「推算」。
//
// 推算部分的依据：
//   · 穿深 840 的 M829A4 对 M1A2 SEP v3 正面 850 打不动，侧面 120 随便穿——
//     数值是照着「穿深 ≥ 装甲才有伤害」调的，所以按这个判定。
//   · 穿深从近距到「地面射程」线性掉（两个值一样的导弹就不掉）。
//   · AOE 没有衰减曲线，只有半径，所以给两种常见模型让人自己选。
import {
  A,
  B,
  COMBAT,
  M,
  U,
  W,
  type CAmmo,
  type CombatData,
  type CWeapon
} from '../game/combat'

export type Facing = 'front' | 'side' | 'rear' | 'top'
export type UnitClass = 'inf' | 'armor' | 'light' | 'heli' | 'plane'
/** AOE 怎么随距离衰减——游戏没给，这是两种常见写法 */
export type Falloff = 'linear' | 'quadratic'

export interface AmmoProfile {
  id: number
  name: string
  /** 携带量 */
  qty: number
  dmg: number
  stress: number
  penMin: number
  penFar: number
  range: number
  lowAlt: number
  highAlt: number
  targetMask: number
  /** 0 无 / 1 动能 / 2 破甲 */
  armorType: number
  aoe: number
  aoeStress: number
  overpressure: number
  topAttack: boolean
  intercept: boolean
  laser: boolean
  dispH: number
  dispV: number
  minRange: number
}

export interface WeaponProfile {
  id: number
  name: string
  /** 班组里几个人拿着这把（车辆固定 1） */
  count: number
  mag: number
  reload: number
  burst: number
  dtShot: number
  dtBurst: number
  aim: number
  onMove: boolean
  radar: boolean
  ammo: AmmoProfile[]
  /** 从哪个炮塔来的（车辆）或哪个班组位（步兵） */
  from: string
}

export interface Abilities {
  aps: { name: string; qty: number; cooldown: number; coverage: number } | null
  /** 来袭导弹命中率乘数，1 = 没有 ECM */
  ecm: number
  decoy: { qty: number; mul: number; duration: number; cooldown: number } | null
  smoke: boolean
  laser: boolean
  radar: boolean
}

export interface UnitProfile {
  /** 选了配装之后实际生效的单位（步兵换班组是整个换单位） */
  unitId: number
  baseUnitId: number
  name: string
  cost: number
  klass: UnitClass
  hp: number
  /** 动能装甲 前/侧/后/顶 */
  kin: [number, number, number, number]
  heat: [number, number, number, number]
  /** 步兵护甲值（步兵没有四面装甲） */
  infArmor: number
  maxStress: number
  size: { len: number; wid: number; hei: number }
  weapons: WeaponProfile[]
  abilities: Abilities
  sensor: { name: string; ground: number; lowAlt: number; highAlt: number } | null
  mobility: { name: string; road: number; cross: number; loiter: number; afterburner: number } | null
}

const FACE_IDX: Record<Facing, number> = { front: 0, side: 1, rear: 2, top: 3 }

export const FACE_NAME: Record<Facing, string> = {
  front: '正面',
  side: '侧面',
  rear: '背面',
  top: '顶部'
}

export const CLASS_NAME: Record<UnitClass, string> = {
  inf: '步兵',
  armor: '装甲',
  light: '轻装甲',
  heli: '直升机',
  plane: '飞机'
}

/** 目标类型位图里的位（拿真实弹药对着验的：斯汀格 24 = 直升机+飞机，AMRAAM 16 = 只打飞机） */
const MASK = { inf: 1, light: 2, armor: 4, heli: 8, plane: 16 }

function classOf(cat: number, kinFront: number): UnitClass {
  if (cat === 1) return 'inf'
  if (cat === 5) return 'heli'
  if (cat === 6) return 'plane'
  return kinFront >= 50 ? 'armor' : 'light'
}

/** 这发弹药能不能锁这类目标（AOE 弹药落地就炸，不受这个限制） */
export function canTarget(a: AmmoProfile, k: UnitClass): boolean {
  if (a.aoe > 0) return true
  const m = a.targetMask
  if (!m) return false
  return !!(m & MASK[k])
}

/** 一套配装下这个单位长什么样 */
export function profileOf(unitId: number, optionIds: number[] = [], data: CombatData = COMBAT): UnitProfile | null {
  const base = data.units[unitId]
  if (!base) return null

  // 配装可能整个换掉单位（步兵的班组变体），也可能换装甲、换炮塔、加能力
  let eff = unitId
  let armorId = 0
  let sensorId = 0
  let mobilityId = 0
  const slotTurret: Record<number, number> = {}
  const extraAbilities: number[] = []
  for (const oid of optionIds) {
    const e = data.options[oid]
    if (!e) continue
    if (e.u) eff = e.u
    if (e.a) armorId = e.a
    if (e.s) sensorId = e.s
    if (e.m) mobilityId = e.m
    if (e.b) extraAbilities.push(...e.b)
    if (e.t) for (const [slot, tid] of Object.entries(e.t)) slotTurret[Number(slot)] = tid
  }

  const u = data.units[eff] || base
  const armor = data.armors[armorId || data.unitArmor[eff] || data.unitArmor[unitId] || 0] || [
    10, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]
  const klass = classOf(u[U.cat], armor[A.kf])

  // ---- 武器 ----
  const weapons: WeaponProfile[] = []
  const squad = data.squad[eff]
  if (squad?.length) {
    // 步兵：一个班里每个人的主武器 + 特殊武器，按武器聚合
    const count = new Map<number, number>()
    for (const [primary, special] of squad) {
      if (primary) count.set(primary, (count.get(primary) || 0) + 1)
      if (special) count.set(special, (count.get(special) || 0) + 1)
    }
    for (const [wid, c] of count) {
      const w = weaponProfile(data, eff, wid, c, c + ' 人')
      if (w) weapons.push(w)
    }
  } else {
    // 车辆/飞机：炮塔上挂的武器。同一个「类别 + 槽位」只留一个炮塔：
    // 配装选了就用选的，没选就用默认的那个
    const mounts = data.turrets[eff] || []
    const picked = new Map<string, number>()
    for (const [tid, order, cls, isDefault] of mounts) {
      const key = cls + '#' + order
      const chosen = Object.values(slotTurret).includes(tid)
      if (chosen) picked.set(key, tid)
      else if (!picked.has(key) && isDefault) picked.set(key, tid)
    }
    // 配装指定了但不在这个单位的炮塔表里（换了型号）也要算上
    for (const tid of Object.values(slotTurret)) {
      if (![...picked.values()].includes(tid) && data.turretWeapons[tid]) picked.set('opt#' + tid, tid)
    }
    for (const tid of picked.values()) {
      for (const wid of data.turretWeapons[tid] || []) {
        const w = weaponProfile(data, eff, wid, 1, '')
        if (w) weapons.push(w)
      }
    }
  }

  // ---- 能力 ----
  const abilityIds = [...(data.unitAbilities[eff] || []), ...extraAbilities]
  const ab: Abilities = { aps: null, ecm: 1, decoy: null, smoke: false, laser: false, radar: false }
  for (const id of abilityIds) {
    const x = data.abilities[id]
    if (!x) continue
    if (x[B.isAPS]) ab.aps = { name: x[B.name], qty: x[B.apsQty], cooldown: x[B.apsCd], coverage: x[B.apsProp] }
    if (x[B.ecm] && x[B.ecm] < ab.ecm) ab.ecm = x[B.ecm]
    if (x[B.isDecoy])
      ab.decoy = { qty: x[B.decoyQty], mul: x[B.decoyMul], duration: x[B.decoyDur], cooldown: x[B.decoyCd] }
    if (x[B.isSmoke]) ab.smoke = true
    if (x[B.isLaser]) ab.laser = true
    if (x[B.isRadar]) ab.radar = true
  }

  const sens = data.sensors[sensorId]
  const mob = data.mobility[mobilityId]
  return {
    unitId: eff,
    baseUnitId: unitId,
    name: u[U.name],
    cost: u[U.cost],
    klass,
    hp: armor[A.hp],
    kin: [armor[A.kf], armor[A.ks], armor[A.kr], armor[A.kt]],
    heat: [armor[A.hf], armor[A.hs], armor[A.hr], armor[A.ht]],
    infArmor: armor[A.inf],
    maxStress: u[U.stress] || 1000,
    size: { len: u[U.len], wid: u[U.wid], hei: u[U.hei] },
    weapons: weapons.sort((a, c) => topDamage(c) - topDamage(a)),
    abilities: ab,
    sensor: sens ? { name: sens[0], ground: sens[1], lowAlt: sens[2], highAlt: sens[3] } : null,
    mobility: mob ? { name: mob[0], road: mob[1], cross: mob[2], loiter: mob[7], afterburner: mob[8] } : null
  }
}

const topDamage = (w: WeaponProfile): number => Math.max(0, ...w.ammo.map((a) => a.dmg))

function weaponProfile(
  data: CombatData,
  unitId: number,
  weaponId: number,
  count: number,
  from: string
): WeaponProfile | null {
  const w: CWeapon | undefined = data.weapons[weaponId]
  if (!w) return null
  const list = data.weaponAmmo[unitId + ':' + weaponId] || []
  const ammo: AmmoProfile[] = []
  const seen = new Set<number>()
  for (const [aid, qty] of list) {
    if (seen.has(aid)) continue
    seen.add(aid)
    const a: CAmmo | undefined = data.ammo[aid]
    if (!a) continue
    ammo.push({
      id: aid,
      name: a[M.name],
      qty,
      dmg: a[M.dmg],
      stress: a[M.stress],
      penMin: a[M.penMin],
      penFar: a[M.penFar],
      range: a[M.range],
      lowAlt: a[M.lowAlt],
      highAlt: a[M.highAlt],
      targetMask: a[M.target],
      armorType: a[M.armorType],
      aoe: a[M.aoe],
      aoeStress: a[M.aoeStress],
      overpressure: a[M.overpressure],
      topAttack: !!a[M.topAttack],
      intercept: !!a[M.intercept],
      laser: !!a[M.laser],
      dispH: a[M.dispH],
      dispV: a[M.dispV],
      minRange: a[M.minRange]
    })
  }
  if (!ammo.length) return null
  return {
    id: weaponId,
    name: w[W.name],
    count,
    mag: w[W.mag] || 1,
    reload: (w[W.reloadMin] + w[W.reloadMax]) / 2 || w[W.reloadMin],
    burst: Math.max(1, Math.round((w[W.burstMin] + w[W.burstMax]) / 2) || 1),
    dtShot: w[W.dtShot],
    dtBurst: (w[W.dtBurstMin] + w[W.dtBurstMax]) / 2 || w[W.dtBurstMin],
    aim: (w[W.aimMin] + w[W.aimMax]) / 2 || w[W.aimMin],
    onMove: !!w[W.move],
    radar: !!w[W.radar],
    ammo,
    from
  }
}

// ---------- 打起来什么样 ----------

/** 穿深随距离掉：近距穿深 → 地面射程处的穿深，中间按线性（两个值一样就是不掉） */
export function penAt(a: AmmoProfile, dist: number): number {
  if (a.penFar === a.penMin || a.range <= 0) return a.penMin
  const t = Math.min(1, Math.max(0, dist / a.range))
  return Math.round(a.penMin + (a.penFar - a.penMin) * t)
}

/** 这一面的装甲值（步兵用护甲值，没有面的概念） */
export function armorAt(target: UnitProfile, a: AmmoProfile, facing: Facing): number {
  if (target.klass === 'inf') return target.infArmor
  const i = a.topAttack ? FACE_IDX.top : FACE_IDX[facing]
  return a.armorType === 1 ? target.kin[i] : a.armorType === 2 ? target.heat[i] : Math.min(target.kin[i], target.heat[i])
}

export interface ShotResult {
  /** 这个距离上的穿深 */
  pen: number
  armor: number
  /** 穿得动吗 */
  through: boolean
  /** 一发多少伤害（穿不动就是 0） */
  dmg: number
  /** 打死要几发 */
  shots: number | null
  /** 打死要多少秒（从开火算起，含瞄准和装填） */
  seconds: number | null
  /** 持续输出（每秒伤害），一个班几个人拿着就乘几 */
  dps: number
  /** 压制条打满要几发 */
  stressShots: number | null
  /** 够不够得着 */
  inRange: boolean
  /** 这发弹药会不会用在这类目标上 */
  usable: boolean
}

/** 打一个弹匣（含装填）平均每发要多久 */
export function cycleTime(w: WeaponProfile): number {
  const bursts = Math.max(1, Math.ceil(w.mag / w.burst))
  const inBurst = (w.burst - 1) * w.dtShot
  const total = bursts * inBurst + (bursts - 1) * w.dtBurst + w.reload + w.aim
  return total / w.mag
}

export function shotAt(
  w: WeaponProfile,
  a: AmmoProfile,
  target: UnitProfile,
  dist: number,
  facing: Facing
): ShotResult {
  const pen = penAt(a, dist)
  const armor = armorAt(target, a, facing)
  const through = pen >= armor
  const dmg = through ? a.dmg : 0
  const per = cycleTime(w)
  const reach = target.klass === 'plane' ? a.highAlt || a.range : target.klass === 'heli' ? a.lowAlt || a.range : a.range
  const inRange = dist >= a.minRange && dist <= reach
  const usable = canTarget(a, target.klass)
  const shots = dmg > 0 ? Math.ceil(target.hp / dmg) : null
  return {
    pen,
    armor,
    through,
    dmg,
    shots,
    // 第一发要先瞄准，后面按弹匣节奏：打 n 发的时间 ≈ 瞄准 + (n-1) × 每发
    seconds: shots == null ? null : Math.round((w.aim + (shots - 1) * per) * 10) / 10,
    dps: Math.round(((dmg * w.count) / per) * 100) / 100,
    stressShots: a.stress > 0 ? Math.ceil(target.maxStress / a.stress) : null,
    inRange,
    usable
  }
}

/** AOE：不同距离上的伤害。游戏没给衰减曲线，所以给两种模型。 */
export function aoeCurve(a: AmmoProfile, falloff: Falloff = 'linear', steps = 40): { d: number; dmg: number }[] {
  const R = a.aoe
  if (R <= 0) return []
  const out: { d: number; dmg: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const d = (R * i) / steps
    let f: number
    if (d <= a.overpressure) f = 1
    else {
      const x = Math.min(1, Math.max(0, d / R))
      f = falloff === 'linear' ? 1 - x : (1 - x) * (1 - x)
    }
    out.push({ d: Math.round(d * 10) / 10, dmg: Math.round(a.dmg * f * 100) / 100 })
  }
  return out
}

/** 多远之内能把目标炸死（按选的衰减模型反解） */
export function lethalRadius(a: AmmoProfile, hp: number, falloff: Falloff = 'linear'): number | null {
  if (a.aoe <= 0 || a.dmg < hp) return a.dmg >= hp ? 0 : null
  const need = hp / a.dmg
  const x = falloff === 'linear' ? 1 - need : 1 - Math.sqrt(need)
  return Math.max(a.overpressure, Math.round(a.aoe * x * 10) / 10)
}

export interface HitChance {
  /** ECM 乘数 */
  ecm: number
  /** 诱饵乘数（只在诱饵有效的那几秒里） */
  decoy: number
  /** 两个乘上去 */
  total: number
  /** 能不能被 APS 拦 */
  interceptable: boolean
  aps: { name: string; qty: number; cooldown: number } | null
}

/** 导弹打上去的机会：ECM 和诱饵都是直接乘命中率的（游戏数据里就是这么写的） */
export function hitChance(a: AmmoProfile, target: UnitProfile, useDecoy = true): HitChance {
  const ecm = target.abilities.ecm || 1
  const decoy = useDecoy && target.abilities.decoy ? target.abilities.decoy.mul : 1
  return {
    ecm,
    decoy,
    total: Math.round(ecm * decoy * 1000) / 1000,
    interceptable: a.intercept,
    aps: a.intercept && target.abilities.aps ? target.abilities.aps : null
  }
}
