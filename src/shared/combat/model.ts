// ================= 配装计算器的算法 =================
// 数据来自游戏自带的表，公式来自对 GameAssembly.dll 的反编译审计（见 docs/game-db.md）：
//
//   · 非制导命中率 = CalculateWeaponHitChance：散布随距离放大，再按目标投影面积算概率
//   · 制导命中率   = CalculateMissileHitChance：基础命中 × ECM × 干扰弹 × 压制
//   · AOE 衰减     = ShellHitSystem.DealAOEDamage：按到目标外壳的距离线性衰减
//   · 选弹种       = SelectBestShellForTarget：位图能打 + 在射程内 + 伤害最高
//   · 目标类型位   = 单位的 Type 字段（2 步兵 / 4 车辆 / 8 直升机 / 16 飞机 / 32 船）
//
// 还差一块：**打中之后掉多少血**。游戏里是 DamageFormulaKinetic / DamageFormulaHEAT 两条
// 软比值公式（HEAT 那条读出来是 伤害 × 穿深^k ÷ (穿深^k + c × 装甲^k)），系数存在 GameConfig
// 的运行时对象里，还没拿到。所以这里暂时按「穿深 ≥ 装甲 = 满伤，否则 0」估算。
//
// 自己定的规则（界面上都标了「推算」）：
//   · 穿甲判定按「穿深 ≥ 装甲」二值化（真实是软比值，见上）
//   · 目标外壳半径怎么从长宽高算
import { A, B, COMBAT, M, U, W, type CAmmo, type CombatData, type CWeapon } from '../game/combat'

export type Facing = 'front' | 'side' | 'rear' | 'top'
export type UnitClass = 'inf' | 'armor' | 'light' | 'heli' | 'plane'

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const r2 = (x: number): number => Math.round(x * 100) / 100
const r3 = (x: number): number => Math.round(x * 1000) / 1000

export interface AmmoProfile {
  id: number
  name: string
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
  /** 非制导：水平散布半径（米）；制导：基础命中率 */
  dispH: number
  /** 非制导：垂直散布半径（米）；制导：抗干扰（0 = 完全被干扰弹影响） */
  dispV: number
  /** 散布的最小比例：距离 0 时散布也有这么大 */
  dispMin: number
  minRange: number
  /** 伤害不随距离衰减（AOE 范围内一律满伤） */
  noFalloff: boolean
  /** 导引头类型，0 = 无制导 */
  seeker: number
  /** 抛射角：反坦克导弹里 36° 那一组就是攻顶的（标枪、地狱火、长钉…） */
  loftAngle: number
  loftHeight: number
}

export interface WeaponProfile {
  id: number
  name: string
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
  from: string
  /** 发射通道：同一个通道上的武器不能同时开火（直升机火箭巢就靠这个分组） */
  channel: number
}

export interface Abilities {
  aps: { name: string; qty: number; cooldown: number; coverage: number } | null
  ecm: number
  decoy: { qty: number; mul: number; duration: number; cooldown: number } | null
  smoke: boolean
  laser: boolean
  radar: boolean
}

export interface UnitProfile {
  unitId: number
  baseUnitId: number
  name: string
  cost: number
  klass: UnitClass
  hp: number
  kin: [number, number, number, number]
  heat: [number, number, number, number]
  infArmor: number
  maxStress: number
  size: { len: number; wid: number; hei: number }
  /** 目标外壳半径：AOE 是从外壳算距离的，大目标更容易被溅到 */
  bounds: number
  /** 在弹药目标位图里占哪一位（2 步兵 / 4 车辆 / 8 直升机 / 16 飞机 / 32 船） */
  targetBit: number
  weapons: WeaponProfile[]
  abilities: Abilities
  sensor: { name: string; ground: number; lowAlt: number; highAlt: number } | null
  mobility: { name: string; road: number; cross: number; loiter: number; afterburner: number } | null
}

const FACE_IDX: Record<Facing, number> = { front: 0, side: 1, rear: 2, top: 3 }
export const FACE_NAME: Record<Facing, string> = { front: '正面', side: '侧面', rear: '背面', top: '顶部' }
export const CLASS_NAME: Record<UnitClass, string> = {
  inf: '步兵',
  armor: '装甲',
  light: '轻装甲',
  heli: '直升机',
  plane: '飞机'
}
/** 卡组分类，也是单位选择器里的分组 */
export const CAT_NAME: Record<number, string> = {
  0: '侦察',
  1: '步兵',
  2: '装甲',
  3: '支援',
  4: '后勤',
  5: '直升机',
  6: '空军'
}

/**
 * 目标类型位：单位自己的 Type 字段就是它在弹药 TargetType 位图里占的那一位。
 * 从游戏数据里逐个数出来的：2 = 步兵（194 个）/ 4 = 车辆（234 个）/ 8 = 直升机（45）/
 * 16 = 飞机（62）/ 32 = 船（5）。
 * 对得上：穿甲弹 36 = 车辆+船（不打步兵）、步枪 47 里有直升机没有飞机、
 * 斯汀格 24 = 直升机+飞机、AMRAAM 16 = 只打飞机。
 * 游戏的 SelectBestShellForTarget 里就是 `test [弹药+0x78], 目标类型位`。
 */
const CLASS_BIT: Record<UnitClass, number> = { inf: 2, light: 4, armor: 4, heli: 8, plane: 16 }

function classOf(cat: number, kinFront: number): UnitClass {
  if (cat === 1) return 'inf'
  if (cat === 5) return 'heli'
  if (cat === 6) return 'plane'
  return kinFront >= 50 ? 'armor' : 'light'
}

export const isGuided = (a: AmmoProfile): boolean => a.seeker > 0 || a.laser

/**
 * 这发弹药能不能锁这个目标：弹药的目标位图和目标的类型位做与运算。
 * 游戏里就是这么判的（SelectBestShellForTarget 里的 test 指令）。
 * 有溅射的弹药同样受这个限制——想炸一片得瞄地面，那是另一条路径。
 */
export function canTargetBit(a: AmmoProfile, bit: number): boolean {
  return !!(a.targetMask & bit)
}
export function canTarget(a: AmmoProfile, k: UnitClass): boolean {
  return canTargetBit(a, CLASS_BIT[k])
}

// ---------- 配装 → 单位 ----------

export function profileOf(unitId: number, optionIds: number[] = [], data: CombatData = COMBAT): UnitProfile | null {
  const base = data.units[unitId]
  if (!base) return null

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

  const weapons: WeaponProfile[] = []
  const squad = data.squad[eff]
  if (squad?.length) {
    const count = new Map<number, number>()
    for (const [primary, special] of squad) {
      if (primary) count.set(primary, (count.get(primary) || 0) + 1)
      if (special) count.set(special, (count.get(special) || 0) + 1)
    }
    for (const [wid, c] of count) {
      const w = weaponProfile(data, eff, wid, c, c + ' 人', 0)
      if (w) weapons.push(w)
    }
  } else {
    const mounts = data.turrets[eff] || []
    const picked = new Map<string, number>()
    for (const [tid, order, cls, isDefault] of mounts) {
      const key = cls + '#' + order
      const chosen = Object.values(slotTurret).includes(tid)
      if (chosen) picked.set(key, tid)
      else if (!picked.has(key) && isDefault) picked.set(key, tid)
    }
    for (const tid of Object.values(slotTurret)) {
      if (![...picked.values()].includes(tid) && data.turretWeapons[tid]) picked.set('opt#' + tid, tid)
    }
    for (const tid of picked.values()) {
      for (const [wid, channel] of data.turretWeapons[tid] || []) {
        const w = weaponProfile(data, eff, wid, 1, '', channel)
        if (w) weapons.push(w)
      }
    }
  }

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
  const len = u[U.len] || 4
  const wid = u[U.wid] || 3
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
    size: { len, wid, hei: u[U.hei] || 2 },
    // 外壳半径：拿长宽当一个矩形，取它的外接圆半径（游戏用的是碰撞体，这里只能这么近似）
    bounds: r2(Math.sqrt(len * len + wid * wid) / 2),
    targetBit: u[U.targetBit] || CLASS_BIT[klass],
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
  from: string,
  channel: number
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
      // 攻顶有两种写法：显式的标志（TOW-2B、集束弹、机炮扫射），
      // 或者抛射角 36° 那一组反坦克导弹（标枪、地狱火、JAGM、长钉）——它们是拉高再扎下来的。
      // 抛射高度大的是空空弹和巡航导弹的飞行剖面，不算攻顶。
      topAttack: !!a[M.topAttack] || (a[M.loftAngle] >= 30 && a[M.loftHeight] <= 10),
      intercept: !!a[M.intercept],
      laser: !!a[M.laser],
      dispH: a[M.dispH],
      dispV: a[M.dispV],
      dispMin: a[M.dispMin],
      minRange: a[M.minRange],
      noFalloff: !!a[M.noFalloff],
      seeker: a[M.seeker],
      loftAngle: a[M.loftAngle],
      loftHeight: a[M.loftHeight]
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
    from,
    channel
  }
}

// ---------- 命中率 ----------

/**
 * 非制导武器的命中率（游戏的 CalculateWeaponHitChance）：
 *   散布比例 = clamp(最小散布 + (1 - 最小散布) × clamp(距离 / 地面射程, 0, 1), 0, 1)
 *   命中率   = clamp(min(H, min(长, 宽)) × min(V, 高) / (H × V), 0, 1)
 * 其中 H、V 是按上面的比例放大后的水平/垂直散布半径。散布为 0 时直接算命中。
 */
export function unguidedHit(a: AmmoProfile, target: UnitProfile, dist: number): number {
  const ref = a.range || 1
  const scale = clamp(a.dispMin + (1 - a.dispMin) * clamp(dist / ref, 0, 1), 0, 1)
  const H = a.dispH * scale
  const V = a.dispV * scale
  if (H <= 0 || V <= 0) return 1
  const w = Math.min(H, Math.min(target.size.len, target.size.wid))
  const h = Math.min(V, target.size.hei)
  return clamp((w * h) / (H * V), 0, 1)
}

export interface GuidedHit {
  /** 弹药自己的基础命中率 */
  accuracy: number
  /** 目标 ECM */
  ecm: number
  /** 干扰弹效果（放了几发就乘几次） */
  cm: number
  /** 射手被压制的影响，界面上可以调 */
  stress: number
  total: number
  /** 抗干扰：1 = 完全不怕干扰弹 */
  resist: number
}

/**
 * 制导弹药的命中率（游戏的 CalculateMissileHitChance）：
 *   命中率 = 基础命中 × 目标ECM × 干扰弹效果 × 压制系数
 *   干扰弹效果 = 没放就是 1，放了 n 发就是 ((1 - 抗干扰) × 干扰弹乘数)^n
 * 制导弹药把「散布」两个字段挪作他用：水平 = 基础命中，垂直 = 抗干扰。
 */
export function guidedHit(
  a: AmmoProfile,
  target: UnitProfile,
  opts: { flares?: number; stress?: number } = {}
): GuidedHit {
  const accuracy = a.dispH || 1
  const resist = a.dispV || 0
  const ecm = target.abilities.ecm || 1
  const n = Math.max(0, Math.round(opts.flares ?? (target.abilities.decoy ? 1 : 0)))
  const mul = target.abilities.decoy?.mul ?? 1
  const cm = n === 0 ? 1 : Math.pow((1 - resist) * mul, n)
  const stress = opts.stress ?? 1
  // 不在这里四舍五入，显示的时候再舍——连乘之后差一点点会看得出来
  return { accuracy, ecm, cm, stress, total: accuracy * ecm * cm * stress, resist }
}

/** 不管制导不制导，给一个命中率 */
export function hitChanceOf(
  a: AmmoProfile,
  target: UnitProfile,
  dist: number,
  opts: { flares?: number; stress?: number } = {}
): number {
  return isGuided(a) ? guidedHit(a, target, opts).total : unguidedHit(a, target, dist)
}

// ---------- AOE ----------

/**
 * AOE 衰减（游戏的 ShellHitSystem.DealAOEDamage）：
 *   d = clamp(爆点到目标中心的距离 − 目标外壳半径, 0, 100)
 *   系数 = d ≥ 半径 ? 0 : (伤害不衰减 ? 1 : clamp(1 − d / 半径, 0, 1))
 */
export function aoeFactor(a: AmmoProfile, distFromCenter: number, boundsRadius: number, radius = a.aoe): number {
  if (radius <= 0) return 0
  const raw = distFromCenter - boundsRadius
  // 游戏把 d 夹在 [0, 100]。夹上限是因为引擎只会去查爆点周围一圈里的单位，
  // 再远的根本不参与计算，所以这里超过 100 米直接当没伤害。
  if (raw > 100) return 0
  const d = clamp(raw, 0, 100)
  if (d >= radius) return 0
  if (a.noFalloff) return 1
  return clamp(1 - d / radius, 0, 1)
}

/** 画曲线用：从爆心到半径外一点，每一步的伤害 */
export function aoeCurve(a: AmmoProfile, target: UnitProfile, steps = 48): { d: number; dmg: number }[] {
  const R = a.aoe
  if (R <= 0) return []
  const max = R + target.bounds
  const out: { d: number; dmg: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const d = (max * i) / steps
    out.push({ d: r2(d), dmg: r2(a.dmg * aoeFactor(a, d, target.bounds)) })
  }
  return out
}

/** 落点离目标中心多远还能炸死它 */
export function lethalRadius(a: AmmoProfile, target: UnitProfile): number | null {
  if (a.aoe <= 0 || a.dmg < target.hp) return null
  if (a.noFalloff) return r2(a.aoe + target.bounds)
  // 1 - d/R = hp/dmg  →  d = R(1 - hp/dmg)，再夹到引擎的 100 米上限
  const d = Math.min(100, a.aoe * (1 - target.hp / a.dmg))
  return r2(d + target.bounds)
}

/** 打偏了溅射还能剩多少：在散布范围里均匀取点，平均一下 */
export function splashExpected(a: AmmoProfile, target: UnitProfile, dist: number, samples = 24): number {
  if (a.aoe <= 0) return 0
  const ref = a.range || 1
  const scale = clamp(a.dispMin + (1 - a.dispMin) * clamp(dist / ref, 0, 1), 0, 1)
  const R = Math.max(a.dispH, a.dispV) * scale
  if (R <= 0) return a.dmg
  let sum = 0
  for (let i = 1; i <= samples; i++) {
    // 面积均匀：半径按 sqrt 分布
    const r = R * Math.sqrt(i / samples)
    sum += a.dmg * aoeFactor(a, r, target.bounds)
  }
  return r2(sum / samples)
}

// ---------- 穿甲和结果 ----------

export function penAt(a: AmmoProfile, dist: number): number {
  if (a.penFar === a.penMin || a.range <= 0) return a.penMin
  const t = clamp(dist / a.range, 0, 1)
  return Math.round(a.penMin + (a.penFar - a.penMin) * t)
}

export function armorAt(target: UnitProfile, a: AmmoProfile, facing: Facing): number {
  if (target.klass === 'inf') return target.infArmor
  const i = a.topAttack ? FACE_IDX.top : FACE_IDX[facing]
  return a.armorType === 1 ? target.kin[i] : a.armorType === 2 ? target.heat[i] : Math.min(target.kin[i], target.heat[i])
}

export function rangeFor(a: AmmoProfile, target: UnitProfile): number {
  return target.klass === 'plane' ? a.highAlt || a.range : target.klass === 'heli' ? a.lowAlt || a.range : a.range
}

/** 打一发平均占多少时间（弹匣打完 + 装填 + 瞄准，摊到每一发） */
export function cycleTime(w: WeaponProfile): number {
  const bursts = Math.max(1, Math.ceil(w.mag / w.burst))
  const inBurst = (w.burst - 1) * w.dtShot
  const total = bursts * inBurst + (bursts - 1) * w.dtBurst + w.reload + w.aim
  return total / w.mag
}

export interface ShotResult {
  pen: number
  armor: number
  through: boolean
  /** 打中了掉多少血 */
  dmg: number
  /** 命中率 */
  hit: number
  guided: boolean
  /** 打偏时溅射还能造成多少（没有 AOE 就是 0） */
  splash: number
  /** 一次射击的期望伤害 = 命中 × 直击 + 未命中 × 溅射 */
  expected: number
  /** 按期望伤害算，打死要几发 */
  shots: number | null
  seconds: number | null
  /** 期望每秒伤害（班组按人数乘） */
  dps: number
  stressShots: number | null
  inRange: boolean
  usable: boolean
  range: number
}

export function shotAt(
  w: WeaponProfile,
  a: AmmoProfile,
  target: UnitProfile,
  dist: number,
  facing: Facing,
  opts: { flares?: number; stress?: number } = {}
): ShotResult {
  const pen = penAt(a, dist)
  const armor = armorAt(target, a, facing)
  const through = pen >= armor
  const dmg = through ? a.dmg : 0
  const hit = hitChanceOf(a, target, dist, opts)
  // 溅射也要先过穿甲判定：不然「打不穿的 HE 照样炸死坦克」，那反应装甲就没意义了
  const splash = through && a.aoe > 0 ? splashExpected(a, target, dist) : 0
  const expected = r2(hit * dmg + (1 - hit) * splash)
  const per = cycleTime(w)
  const range = rangeFor(a, target)
  const shots = expected > 0 ? Math.ceil(target.hp / expected) : null
  return {
    pen,
    armor,
    through,
    dmg,
    hit: r3(hit),
    guided: isGuided(a),
    splash,
    expected,
    shots,
    seconds: shots == null ? null : Math.round((w.aim + (shots - 1) * per) * 10) / 10,
    dps: r2((expected * w.count) / per),
    stressShots: a.stress > 0 ? Math.ceil(target.maxStress / a.stress) : null,
    inRange: dist >= a.minRange && dist <= range,
    usable: canTargetBit(a, target.targetBit),
    range
  }
}

export interface Engagement {
  weapon: WeaponProfile
  /** 游戏会拿哪一种弹打（推算：能打这类目标、够得着、期望伤害最高的那个） */
  best: AmmoProfile | null
  result: ShotResult | null
  /** 这把武器所有能用的弹药，按期望伤害排 */
  all: { ammo: AmmoProfile; result: ShotResult }[]
}

/**
 * 每件武器挑一种弹。这是照游戏的 SelectBestShellForTarget 来的（反汇编读出来的）：
 *   1. 弹药目标位图 ∩ 目标类型位 ≠ 0
 *   2. 最小射程 ≤ 距离 ≤ 这个目标对应的射程
 *   3. 剩下的里面挑 **伤害最高** 的那一发
 * 注意游戏在这一步**不看穿不穿得动**——所以自动开火经常拿破甲弹去啃正面。
 * 烟雾弹是另一条请求路径（专门放烟的时候才用），这里不当攻击手段。
 */
export function engage(
  attacker: UnitProfile,
  target: UnitProfile,
  dist: number,
  facing: Facing,
  opts: { flares?: number; stress?: number } = {}
): Engagement[] {
  return attacker.weapons.map((w) => {
    const all = w.ammo
      .map((ammo) => ({ ammo, result: shotAt(w, ammo, target, dist, facing, opts) }))
      .sort((x, y) => {
        // 先把游戏会考虑的排前面，组内按伤害（游戏就是挑伤害最高的）
        const ok = (r: { result: ShotResult }): number => (r.result.usable && r.result.inRange ? 1 : 0)
        if (ok(x) !== ok(y)) return ok(y) - ok(x)
        return y.ammo.dmg - x.ammo.dmg
      })
    const top = all.find((x) => x.result.usable && x.result.inRange)
    return { weapon: w, best: top?.ammo || null, result: top?.result || null, all }
  })
}

/**
 * 一个单位的总输出。同一个发射通道上的武器不能同时开火（`CanUseFiringChannel`），
 * 所以每个通道只取最能打的那一件，再把各通道加起来。
 */
export function totalDps(list: Engagement[]): { dps: number; byChannel: { channel: number; dps: number; weapon: string }[] } {
  const best = new Map<number, { channel: number; dps: number; weapon: string }>()
  for (const e of list) {
    if (!e.result) continue
    const ch = e.weapon.channel
    const cur = best.get(ch)
    if (!cur || e.result.dps > cur.dps) best.set(ch, { channel: ch, dps: e.result.dps, weapon: e.weapon.name })
  }
  const byChannel = [...best.values()].sort((a, b) => b.dps - a.dps)
  return { dps: Math.round(byChannel.reduce((s, x) => s + x.dps, 0) * 100) / 100, byChannel }
}

// ---------- APS ----------

export interface ApsInfo {
  /** 这发弹药能不能被拦 */
  interceptable: boolean
  aps: { name: string; qty: number; cooldown: number } | null
  /** 一起打过去几发能穿过去（拦截次数 + 1） */
  saturate: number | null
}

export function apsAgainst(a: AmmoProfile, target: UnitProfile): ApsInfo {
  const aps = target.abilities.aps
  if (!a.intercept || !aps) return { interceptable: a.intercept, aps: null, saturate: null }
  return { interceptable: true, aps, saturate: aps.qty + 1 }
}
