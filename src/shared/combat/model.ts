// ================= 配装计算器的算法 =================
// 数据来自游戏自带的表，公式来自对 GameAssembly.dll 的反编译审计（见 docs/game-db.md）：
//
//   · 非制导命中率 = CalculateWeaponHitChance：散布随距离放大，再按目标投影面积算概率
//   · 制导命中率   = CalculateMissileHitChance：基础命中 × ECM × 干扰弹 × 压制
//   · AOE 衰减     = ShellHitSystem.DealAOEDamage：按到目标外壳的距离线性衰减
//   · 选弹种       = SelectBestShellForTarget：位图能打 + 在射程内 + 伤害最高
//   · 目标类型位   = 单位的 Type 字段（2 步兵 / 4 车辆 / 8 直升机 / 16 飞机 / 32 船）
//
//   · 掉多少血     = DamageFormulaKinetic / DamageFormulaHEAT（系数见 BS 常量）
//   · 合并发射     = 飞机把同型挂架并起来打，间隔按总弹量摊
//
// 自己定的规则（界面上都标了「推算」）：
//   · 目标外壳半径怎么从长宽高算（游戏用碰撞体，数据里只有长宽高）
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
  /** 无视掩体的比例（0~1 的浮点，不是开关）：1 = 完全无视楼房和步兵减伤 */
  ignoreCover: number
  /** 近炸引信的起爆距离，0 = 撞上才炸 */
  radioFuse: number
  /** 这种弹自己的瞄准时间（0 = 用武器的）。GenerateRandomAimTime 里各自独立判零 */
  aim: number
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
  /** 发射通道：同一个非零通道上的武器不能同时开火（直升机火箭巢就靠这个分组） */
  channel: number
  /** 抢占优先级：同通道时数字**小**的赢（CanUseFiringChannel 里 `lower numeric priority wins`） */
  priority: number
  /** 合并了几个挂架（飞机把同型挂架并起来齐射）；1 = 没合并 */
  pylons: number
  /** 这把武器能不能和同型的并起来打 */
  mergeable: boolean
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
  /** 统一装甲值（ArmorValue）：步兵、飞机、皮薄的车没有方向装甲，用这一个数 */
  armorValue: number
  /** 有没有分方向的装甲；没有就一律用 armorValue */
  directional: boolean
  maxStress: number
  size: { len: number; wid: number; hei: number }
  /** 目标外壳半径：AOE 是从外壳算距离的，大目标更容易被溅到 */
  bounds: number
  /** 在弹药目标位图里占哪一位（2 步兵 / 4 车辆 / 8 直升机 / 16 飞机 / 32 船） */
  targetBit: number
  weapons: WeaponProfile[]
  /** 班组成员（只有步兵有）。death 是 DeathPriority，数字大的先死 */
  squad: { name: string; death: number }[]
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

/**
 * 游戏的 BattleSystemSettings 里的战斗常量。
 * 这四个在机器码里是 [config+0x16c/0x170/0x174/0x178]，
 * 值是从 globalgamemanagers.assets 里那个 BattleSystemSettings 对象读出来的
 * （序列化偏移 +528 起连着四个 float：1.0 / 0.1 / 1.0 / 2.0），
 * 和朋友八月那份快照一致，说明九月更新没动。
 */
export const BS = {
  /** ARMOR_PENETRATION_EFFECTIVENESS */
  armorPenEffectiveness: 1.0,
  /** MINIMAL_DAMAGE_COEFFICIENT：动能弹打不穿时的伤害下限（占基础伤害的比例） */
  minimalDamage: 0.1,
  /** HE_ARMOR_EFFECTIVENESS */
  heArmorEffectiveness: 1.0,
  /** HEAT_CURVE_COEFFICIENT */
  heatCurve: 2.0,
  /** MISSILE_MERGE_POWER：合并挂架时间隔按总弹量的这个次方摊 */
  missileMergePower: 1.0
} as const

/**
 * 打中之后掉多少血。公式和**分支顺序**都来自伤害派发器 `CalculateHitDamage`（RVA 0x7B3070）：
 *
 *   装甲类型 0            → 满伤（最前面就短路）
 *   装甲类型 2            → 破甲曲线
 *   目标 ArmorValue > 0   → **也走破甲曲线**（哪怕弹药是动能的）
 *   否则（方向装甲）      → 动能公式
 *
 * 破甲曲线：
 *   伤害 = 基础 × 穿深^C ÷ (穿深^C + H × 装甲^C)          C = 2，H = 1
 *   是条平滑曲线——穿深等于装甲时正好一半，打不穿也不是零。
 *
 * 动能弹：
 *   穿深 ≥ 装甲 → 满伤（机器码里直接 return 基础伤害）
 *   否则 d = 基础 × (1 + (穿深 − 装甲) ÷ (穿深 × APE))
 *        d ≤ 0 → 0；0 < d < 基础×0.1 → 基础×0.1（下限）
 *   所以动能弹掉到 0 的临界是「装甲 ≥ 2 倍穿深」（APE = 1 时）。
 */
export function damageOf(base: number, pen: number, armor: number, armorType: number, commonArmor = false): number {
  if (base <= 0) return 0
  // 装甲类型 0（无视装甲）在派发器最前面就短路了：`test edi, edi / je`
  if (armorType === 0) return r2(base)
  // **目标的通用装甲值 > 0 时，动能弹也走破甲曲线**。派发器里是
  //   cmp edi, 2 / je 破甲分支
  //   cmp dword ptr [armor+0x28], 0 / jg 破甲分支   ← +0x28 就是 Armors.ArmorValue
  // 步兵、飞机、轻甲车（没有方向装甲的那一批）全吃这一条。
  if (armorType === 2 || commonArmor) {
    if (pen <= 0) return 0
    const p = Math.pow(pen, BS.heatCurve)
    const a = Math.pow(Math.max(0, armor), BS.heatCurve)
    const denom = p + BS.heArmorEffectiveness * a
    return denom > 0 ? r2((base * p) / denom) : base
  }
  if (pen >= armor) return base
  if (pen <= 0) return 0
  const d = base + (base / (pen * BS.armorPenEffectiveness)) * (pen - armor)
  if (!(d > 0)) return 0
  return r2(Math.max(d, base * BS.minimalDamage))
}

/**
 * 距离显示倍率。游戏数据库里的射程、散布、溅射半径都是「世界单位」，
 * 而游戏界面上给玩家看的米数是它的两倍——数据里写 700 的坦克炮，游戏里显示 1400 m。
 *
 * 所有计算都留在世界单位里（比值不受影响，公式和游戏本体一致），只在显示的时候乘这个数。
 * 单位的长宽高是例外：那本来就是真实米数（艾布拉姆斯 7.6 m），不要乘。
 */
export const DIST_SCALE = 2
/** 世界单位 → 界面上的米 */
export const toM = (x: number): number => Math.round(x * DIST_SCALE)

/**
 * 受伤害乘数：步兵自己的抗打击 + 躲在楼里的加成。两条都是乘在**基础伤害**上的，
 * 乘完才过装甲公式（机器码里就是先把一串乘数乘进 xmm6，再拿它当基础伤害调伤害公式）。
 *
 *   步兵：M = clamp01(floor + 每人加成 × 存活人数)   floor/每人加成来自 BuffConfig，跟压制等级走
 *   楼里：B = clamp01(0.18 + 0.02 × 楼里总人数)      BuildingsConfig，人越多越不禁打
 *   无视掩体：effective(f) = f + (1 − f) × clamp01(弹药的 IgnoreCover)
 *
 * 平地和林区都没有额外减伤——林区只挡视野，那是红龙的设定，这个游戏没有。
 * 楼房那条还有个门槛：单发伤害够大就直接不吃减伤（BuildingsConfig.BuildingDamageThreshold = 5）。
 */
/**
 * 楼里：clamp01(0.18 + 0.02 × 楼里总人数)，人数算的是**这栋楼里所有班组**。
 * `BuildingsConfig.BuildingDamageThreshold = 5` 不是「伤害够大就不吃减伤」的门槛——
 * 它是从**楼房自身**的伤害里减掉的（`raw × AOE × 系数 − 5`，≤ 0 就不掉血），
 * 跟里面的人受多少伤害无关。之前拿它当门槛用是读错了。
 */
export const BUILDING = { floor: 0.18, perSoldier: 0.02, selfDamageThreshold: 5 } as const

/**
 * 步兵抗打击**有**伤害门槛：单发的 `原始伤害 × AOE衰减` 到了
 * `BuffConfig.StressDamageModThreshold` 就不吃这层减伤了（大口径直接糊脸）。
 *
 * 注意：游戏资产里有**两套** BuffConfig——一套 36（步兵黄线 0.4），一套 9999（黄线 0.5）。
 * 哪一套在实际对局里生效还没定论，这里跟着我们读到并一直在用的那一套（36 / 0.4）走。
 */
export const INF_DMG_THRESHOLD = 36

/** 步兵抗打击的两个系数，跟压制等级走（BuffConfig.StressModifiers） */
export const INF_DMG: Record<number, { floor: number; perSoldier: number }> = {
  0: { floor: 0.36, perSoldier: 0.02 },
  1: { floor: 0.36, perSoldier: 0.02 },
  2: { floor: 0.1, perSoldier: 0.1 }
}

/** 现场情况：目标在不在楼里、还剩几个人、被压成什么样 */
export interface Situation {
  flares?: number
  /** 射手自己的状态（压制会降命中） */
  stress?: number
  /** 目标躲的那栋楼里一共几个人（0 = 不在楼里） */
  building?: number
  /** 目标班组还剩几个人（不给就按满编） */
  alive?: number
  /** 目标自己的压制等级：0 正常 / 1 黄 / 2 红 */
  level?: number
  /**
   * 近炸引信按哪一档算：平均 / 贴脸炸（最疼）/ 擦边炸（最不疼）。
   * 这是游戏里**唯一**一处单发伤害本身带随机的地方，所以单独拎出来。
   */
  fuse?: FuseCase
}

export function infantryFactor(alive: number, level = 0): number {
  const c = INF_DMG[level] || INF_DMG[0]
  return clamp(c.floor + c.perSoldier * Math.max(0, alive), 0, 1)
}

export function buildingFactor(occupants: number): number {
  return clamp(BUILDING.floor + BUILDING.perSoldier * Math.max(0, occupants), 0, 1)
}

/** 无视掩体：弹药的 IgnoreCover 越高，减伤越接近失效 */
export const bypassCover = (factor: number, ignoreCover: number): number =>
  factor + (1 - factor) * clamp(ignoreCover, 0, 1)

/** 这一发打在这个目标身上，基础伤害要先乘多少 */
export function damageMul(target: UnitProfile, a: AmmoProfile, sit: Situation = {}): number {
  let mul = 1
  // 近炸引信：在旁边炸，按起爆距离的分布算能打出多少
  if (usesRadioFuse(a)) mul *= fuseFactor(a, sit.fuse || 'avg')
  // 步兵抗打击：单发伤害够大就不吃这一层
  if (target.klass === 'inf' && target.squad.length && a.dmg < INF_DMG_THRESHOLD) {
    const alive = sit.alive ?? target.squad.length
    mul *= bypassCover(infantryFactor(alive, sit.level ?? 0), a.ignoreCover)
  }
  if (sit.building) mul *= bypassCover(buildingFactor(sit.building), a.ignoreCover)
  return mul
}

export const isGuided = (a: AmmoProfile): boolean => a.seeker > 0 || a.laser

/**
 * 近炸引信。防空导弹不是撞上去的，是在目标旁边炸开，所以哪怕判定「命中」也吃不到直击伤害，
 * 真正落到身上的是那个距离上的溅射伤害。游戏自己有两个常量
 * （`BattleSystemConstants` 的静态构造函数里写死：`[static+0x28] = 0.5`、`[static+0x2c] = 0.33`）：
 *
 *   MISSILE_RADIOFUSE_HIT_PREDICTED_AVERAGE_DAMAGE_PROPORTION = 0.33
 *       一次近炸命中**平均**只打出 33% 的伤害，游戏的 AI 就拿这个数预估伤害
 *   MISSILE_MISS_RADIOFUSE_TRIGGER_CHANCE = 0.5
 *       就算判定脱靶，引信还有一半概率照样起爆
 */
/** BattleSystemSettings.LOFT_GOING_STRAIGHT_DISTANCE_PROPORTION（序列化 +364 = 0.33） */
export const LOFT_STRAIGHT_PROPORTION = 0.33

export const RADIOFUSE = {
  /** MISSILE_RADIOFUSE_HIT_PREDICTED_AVERAGE_DAMAGE_PROPORTION：游戏 AI 预估用的平均伤害比例 */
  avgDamage: 0.33,
  /** MISSILE_MISS_RADIOFUSE_TRIGGER_CHANCE：判脱靶之后引信照样起爆的概率 */
  missTrigger: 0.5,
  /** RADIUFUSE_MISS_DISTANCE_PROPORTION_MIN / MAX（BattleSystemSettings 字段 55/56，九月版本 0.6 / 1.4） */
  pMin: 0.6,
  pMax: 1.4
} as const

/**
 * 近炸命中平均打出多少伤害。
 *
 * `SeekerSystem.GenerateMissVectorOnTarget` 给每发导弹掷一个
 * `p = random(MIN, MAX)`（九月版本 0.6 ~ 1.4），擦身距离 = `p × RadioFuseDistance`，
 * 从**目标外壳**算起。`p > 1` 就是擦过了触发半径（引擎把它标成 isCMMiss），
 * `p ≤ 1` 才在引信半径里起爆——所以算「命中」这一支的时候取 p ∈ [MIN, 1]，
 * 按溅射衰减曲线积分出平均伤害比例。
 *
 * 交叉验证：防空弹的近炸距离一律是溅射半径的 0.8 倍，代进去平均得 0.36，
 * 和游戏自己写死的预估常量 0.33 对得上（见 RADIOFUSE.avgDamage），
 * 说明这个读法是对的。这里用逐弹算出来的值，不用那个粗略常量。
 */
export type FuseCase = 'avg' | 'best' | 'worst'

export function fuseFactor(a: AmmoProfile, which: FuseCase = 'avg'): number {
  if (!usesRadioFuse(a)) return 1
  const hi = Math.min(1, RADIOFUSE.pMax)
  // 擦身距离是从外壳算起的，正好就是 aoeFactor 里的 d。
  // 贴着最近处炸（p = MIN）最疼，擦着引信边缘炸（p = 1）最不疼。
  if (which === 'best') return r3(aoeFactor(a, RADIOFUSE.pMin * a.radioFuse, 0))
  if (which === 'worst') return r3(aoeFactor(a, hi * a.radioFuse, 0))
  const n = 33
  let sum = 0
  for (let i = 0; i < n; i++) {
    const p = RADIOFUSE.pMin + ((hi - RADIOFUSE.pMin) * (i + 0.5)) / n
    sum += aoeFactor(a, p * a.radioFuse, 0)
  }
  return r3(sum / n)
}

/**
 * 这一发走不走近炸引信。
 *
 * 判据是**制导 + 有 `RadioFuseDistance`**。光看 `RadioFuseDistance > 0` 不行：
 * 数据里 118 种弹药有这个值，其中 58 种是非制导的——7.62 步枪弹也写着 5，
 * 那显然不是引信而是命中检测半径。剩下 60 种制导的**全都能打空中目标**，
 * 没有一种是纯打地面的，正好就是防空弹和空空弹这一批。
 *
 * 起爆距离一律是溅射半径的 **0.8 倍**（40N6：溅射 40、近炸 32；AIM-7M：15 / 12）。
 *
 * 没算进来的：非制导的高炮近炸弹（130mm AA 之类也带这个字段），
 * 游戏怎么处理它们还没验，宁可少算不要乱算。
 */
export const usesRadioFuse = (a: AmmoProfile): boolean => a.radioFuse > 0 && a.seeker > 0

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
      // 班组的枪不占发射通道，不同的人各打各的
      const w = weaponProfile(data, eff, wid, c, c + ' 人', 0, 0)
      if (w) weapons.push(w)
    }
  } else {
    const mounts = data.turrets[eff] || []

    // 「这个位置空着」和「这条配装没提到这个位置」在数据里都是 0，分不出来。
    // 但同一个槽位里别的选项用到了哪些位是知道的：本选项没提到、别的选项用到的，
    // 就是明确空着（「两个火箭巢」对上「四个火箭巢」、「不挂吊舱」都是这么来的）。
    // 只清非默认件，免得把单位的基础武器也清掉。
    const mountKey = new Map<number, string>()
    const notDefault = new Set<number>()
    for (const [tid, order, cls, isDefault] of mounts) {
      mountKey.set(tid, cls + '#' + order)
      if (!isDefault) notDefault.add(tid)
    }
    const emptyKeys = new Set<string>()
    for (const [, list] of data.unitOptions[unitId] || []) {
      const chosen = list.find(([id]) => optionIds.includes(id))
      if (!chosen) continue
      const mine = new Set(Object.keys(data.options[chosen[0]]?.t || {}))
      for (const [oid] of list) {
        for (const [slot, tid] of Object.entries(data.options[oid]?.t || {})) {
          const k = mountKey.get(tid)
          if (!mine.has(slot) && k && notDefault.has(tid)) emptyKeys.add(k)
        }
      }
    }
    // 配装明确选的先进去——**可以重复**：四联火箭巢就是同一个炮塔挂在四个位置上
    const final: number[] = []
    const taken = new Set<string>()
    for (const tid of Object.values(slotTurret)) {
      final.push(tid)
      const k = mountKey.get(tid)
      if (k) taken.add(k)
    }
    // 剩下的位置拿默认件补。有父炮塔的不参与——它上不上场只看父炮塔选没选；
    // 被配装明确空出来的位置也不要
    for (const [tid, order, cls, isDefault, parent] of mounts) {
      const key = cls + '#' + order
      if (parent || !isDefault || taken.has(key) || emptyKeys.has(key)) continue
      taken.add(key)
      final.push(tid)
    }
    // 子炮塔跟着父炮塔走：配装换的是主炮塔，挂在它下面的同轴机枪、遥控武器站也要跟着换
    const roots = new Set(final)
    for (const [tid, , , , parent] of mounts) {
      if (!parent || roots.has(tid)) continue
      if (roots.has(parent) && data.turretWeapons[tid]) final.push(tid)
    }
    for (const tid of final) {
      for (const [wid, channel, priority] of data.turretWeapons[tid] || []) {
        const w = weaponProfile(data, eff, wid, 1, '', channel, priority || 0)
        if (w) weapons.push(w)
      }
    }
    mergePylons(weapons, klass === 'plane' || klass === 'heli')
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
    armorValue: armor[A.inf],
    directional: [A.kf, A.ks, A.kr, A.kt, A.hf, A.hs, A.hr, A.ht].some((k) => armor[k] > 0),
    maxStress: u[U.stress] || 1000,
    size: { len, wid, hei: u[U.hei] || 2 },
    // 外壳半径：拿长宽当一个矩形，取它的外接圆半径（游戏用的是碰撞体，这里只能这么近似）
    bounds: r2(Math.sqrt(len * len + wid * wid) / 2),
    targetBit: u[U.targetBit] || CLASS_BIT[klass],
    weapons: weapons.sort((a, c) => topDamage(c) - topDamage(a)),
    squad: squadRoster(data, squad),
    abilities: ab,
    sensor: sens ? { name: sens[0], ground: sens[1], lowAlt: sens[2], highAlt: sens[3] } : null,
    mobility: mob ? { name: mob[0], road: mob[1], cross: mob[2], loiter: mob[7], afterburner: mob[8] } : null
  }
}

/** 某个单位每个槽位默认选哪个配件（游戏里打开单位时的默认配装） */
export function defaultOpts(data: CombatData, unitId: number): number[] {
  const out: number[] = []
  for (const [, list] of data.unitOptions[unitId] || []) {
    const def = list.find(([, isDefault]) => isDefault) || list[0]
    if (def) out.push(def[0])
  }
  return out
}

const topDamage = (w: WeaponProfile): number => Math.max(0, ...w.ammo.map((a) => a.dmg))

/** 班组名单：一人一行，带上他手里的家伙和 DeathPriority（SquadMembers 表里就有） */
function squadRoster(
  data: CombatData,
  squad: [number, number, number][] | undefined
): { name: string; death: number }[] {
  if (!squad?.length) return []
  return squad.map(([primary, special, death]) => {
    const s = special ? data.weapons[special]?.[W.name] : ''
    const p = primary ? data.weapons[primary]?.[W.name] : ''
    return { name: p && s ? p + ' + ' + s : s || p || '步枪手', death }
  })
}

function weaponProfile(
  data: CombatData,
  unitId: number,
  weaponId: number,
  count: number,
  from: string,
  channel: number,
  priority = 0
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
      ignoreCover: a[M.ignoreCover] || 0,
      radioFuse: a[M.radioFuse] || 0,
      // 上下限各自判零再取中值；两个都是 0 就退回武器的瞄准时间
      aim:
        ((a[M.aimMinOverride] || 0) + (a[M.aimMaxOverride] || 0)) /
        ((a[M.aimMinOverride] ? 1 : 0) + (a[M.aimMaxOverride] ? 1 : 0) || 1),
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
    channel,
    priority,
    pylons: 1,
    mergeable: !!w[W.merge]
  }
}

/**
 * 飞机把同型挂架并起来齐射（游戏里叫 CombinePylonsOnAircraft）：
 *   合并后的发射间隔 = (各挂架间隔之和 ÷ 挂架数) ÷ 总弹量 ^ MISSILE_MERGE_POWER
 * 先取平均再除总弹量，不是直接求和。MISSILE_MERGE_POWER = 1。
 * 所以四发弹的两个挂架并起来，间隔是单挂架的四分之一——齐射就是这么快的。
 */
/**
 * 合并同型武器。`UnitBuilder.CombineWeapons` 按**单位类别**分岔：
 *   8 / 16（直升机、飞机）→ CombinePylonsOnAircraft：间隔按总弹量摊（我们实现的这条）
 *   4（地面）            → MergeWeaponsOnGroundTurrets：只并弹药和弹匣，**节奏不变**
 *   其它                  → 不合并
 */
function mergePylons(weapons: WeaponProfile[], air: boolean): void {
  const groups = new Map<number, WeaponProfile[]>()
  for (const w of weapons) {
    if (!w.mergeable) continue
    const g = groups.get(w.id)
    if (g) g.push(w)
    else groups.set(w.id, [w])
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const totalAmmo = g.reduce((s, w) => s + Math.max(1, w.ammo[0]?.qty || w.mag), 0)
    const avgBurst = g.reduce((s, w) => s + w.dtBurst, 0) / g.length
    const head = g[0]
    head.pylons = g.length
    head.mag = totalAmmo
    // 地面炮塔只并弹匣，发射节奏保持原样；只有飞机/直升机才摊间隔
    if (air) head.dtBurst = r2(avgBurst / Math.pow(Math.max(1, totalAmmo), BS.missileMergePower))
    for (const w of g.slice(1)) weapons.splice(weapons.indexOf(w), 1)
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
export function guidedHit(a: AmmoProfile, target: UnitProfile, opts: Situation = {}): GuidedHit {
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
export function hitChanceOf(a: AmmoProfile, target: UnitProfile, dist: number, opts: Situation = {}): number {
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
  // 到外壳的距离。**没有 100 米截断**——`DealAOEDamage` 里那个 100
  // （`AOE_SEARCH_EXTRA_RADIUS`）是拿去当空间查询半径余量的（`半径 + 100` 传给查询），
  // 不在伤害公式里。衰减本身只有「超出半径就是 0」：
  //   d >= 半径 → 0；NoDamageFalloff → 1；否则 clamp(1 − d / 半径, 0, 1)
  // 早先按 clamp(d, 0, 100) 写过，那会让半径大于 100 的弹（FAB-9000 175、核弹 350）算错。
  const d = Math.max(0, distFromCenter - boundsRadius)
  if (d >= radius) return 0
  if (a.noFalloff) return 1
  return clamp(1 - d / radius, 0, 1)
}

/**
 * 溅射也要过装甲。
 *
 * 游戏里 `ShellHitSystem.DealAOEDamage` 最后是直接调 `DealUnitDamage` 的
 * （`call 0x1807e9450`），所以溅射和直击走的是**同一条路**：衰减系数先乘在基础伤害上，
 * 再过穿深/装甲的伤害公式。这和「先算出直击伤害再按比例缩」不是一回事——
 * 动能弹有 10% 下限、破甲弹是条曲线，先缩和后缩差得出来。
 */
export interface AoeCtx {
  /** 这个距离上的穿深 */
  pen: number
  /** 目标这一面的装甲 */
  armor: number
  /** 基础伤害的减伤系数（步兵抗打击 / 躲楼里 / 近炸），不给就是 1 */
  mul?: number
}

/** 爆心离目标中心 d 米时，这一发溅射打掉多少血 */
export function aoeDamageAt(a: AmmoProfile, target: UnitProfile, d: number, ctx: AoeCtx): number {
  const f = aoeFactor(a, d, target.bounds)
  if (f <= 0) return 0
  return damageOf(a.dmg * (ctx.mul ?? 1) * f, ctx.pen, ctx.armor, a.armorType, target.armorValue > 0)
}

/** 画曲线用：从爆心到半径外一点，每一步打掉多少血（已经过了装甲） */
export function aoeCurve(a: AmmoProfile, target: UnitProfile, ctx: AoeCtx, steps = 48): { d: number; dmg: number }[] {
  const R = a.aoe
  if (R <= 0) return []
  const max = R + target.bounds
  const out: { d: number; dmg: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const d = (max * i) / steps
    out.push({ d: r2(d), dmg: aoeDamageAt(a, target, d, ctx) })
  }
  return out
}

/** 落点离目标中心多远还能炸死它。过了装甲公式就没有闭式解，直接二分找交点 */
export function lethalRadius(a: AmmoProfile, target: UnitProfile, ctx: AoeCtx): number | null {
  if (a.aoe <= 0) return null
  if (aoeDamageAt(a, target, target.bounds, ctx) < target.hp) return null
  let lo = target.bounds
  let hi = a.aoe + target.bounds
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (aoeDamageAt(a, target, mid, ctx) >= target.hp) lo = mid
    else hi = mid
  }
  return r2(lo)
}

/** 打偏了溅射还能剩多少：在散布范围里均匀取点，每个落点各自过一遍装甲 */
export function splashExpected(a: AmmoProfile, target: UnitProfile, dist: number, ctx: AoeCtx, samples = 24): number {
  if (a.aoe <= 0) return 0
  const ref = a.range || 1
  const scale = clamp(a.dispMin + (1 - a.dispMin) * clamp(dist / ref, 0, 1), 0, 1)
  const R = Math.max(a.dispH, a.dispV) * scale
  if (R <= 0) return aoeDamageAt(a, target, 0, ctx)
  let sum = 0
  for (let i = 1; i <= samples; i++) {
    // 面积均匀：半径按 sqrt 分布
    sum += aoeDamageAt(a, target, R * Math.sqrt(i / samples), ctx)
  }
  return r2(sum / samples)
}

// ---------- 穿甲和结果 ----------

/**
 * 这个距离上的穿深。`GetPenetration`（RVA 0x7B6DD0）：
 *
 *   装甲类型 0  → FLT_MAX（无视装甲）
 *   装甲类型 1  → Pmin − (Pmin − Pfar) × 实际距离 ÷ (参考射程 − 最小射程)，夹到 ≥ 0
 *   其它（破甲）→ **不随距离变**，一直是 Pfar（PenetrationAtGroundRange）
 *
 * 三处和原来的写法不一样：分母要减最小射程、破甲弹不衰减、结果不取整。
 * 参考射程是 `GetDispersionReferenceRange`：地面 / 低空 / 高空里第一个正数。
 */
export function penAt(a: AmmoProfile, dist: number): number {
  if (a.armorType === 0) return Infinity
  if (a.armorType !== 1) return a.penFar
  const ref = a.range || a.lowAlt || a.highAlt || 0
  const denom = ref - a.minRange
  if (!(denom > 0)) return Math.max(0, a.penMin)
  return Math.max(0, r2(a.penMin - ((a.penMin - a.penFar) * dist) / denom))
}

/**
 * 目标这一面的装甲。
 *
 * 数据里每个单位要么有**八面装甲**（动能前/侧/后/顶 + 破甲前/侧/后/顶），要么只有一个
 * **统一装甲值** `ArmorValue`，两者互斥。步兵、飞机、直升机、皮薄的车都走后者——
 * 所以飞机的方向装甲全是 0，**不能当成「没装甲」**（A-10 的 ArmorValue 是 30）。
 */
/**
 * 这一发会不会打顶。`DoesAmmunitionUseTopArmorAttack`（RVA 0x7B53F0，游戏预估伤害时用的就是它）：
 *
 *   弹药的 TopArmorAttack 标志为真          → 打顶
 *   抛射角 < 30                             → 不打顶
 *   否则                                    → 射击距离 ≥ 0.33 × 对这个目标的射程 才打顶
 *
 * 0.33 是 `LOFT_GOING_STRAIGHT_DISTANCE_PROPORTION`。**近距离放标枪是不攻顶的**——
 * 导弹还没爬到高点就撞上了。（之前写的「抛射高度 ≤ 10」这个条件是编的，游戏里没有。）
 */
export function usesTopAttack(a: AmmoProfile, target: UnitProfile, dist: number): boolean {
  if (a.topAttack) return true
  if (a.loftAngle < 30) return false
  return dist >= LOFT_STRAIGHT_PROPORTION * rangeFor(a, target)
}

export function armorAt(target: UnitProfile, a: AmmoProfile, facing: Facing, dist = Infinity): number {
  if (!target.directional) return target.armorValue
  const i = usesTopAttack(a, target, dist) ? FACE_IDX.top : FACE_IDX[facing]
  return a.armorType === 1
    ? target.kin[i]
    : a.armorType === 2
      ? target.heat[i]
      : Math.min(target.kin[i], target.heat[i])
}

export function rangeFor(a: AmmoProfile, target: UnitProfile): number {
  return target.klass === 'plane' ? a.highAlt || a.range : target.klass === 'heli' ? a.lowAlt || a.range : a.range
}

/**
 * 打到第 n 发是第几秒——按武器真正的节奏走，不是拿平均值乘出来的。
 *
 * 像布莱德利的双联 TOW：弹匣 2 发、两发之间 3.5 秒、打完要装 10 秒，
 * 所以前两发来得很快（1.5s、5s），第三发要等到 16.5s。按平均节奏（每发 7.5 秒）
 * 算出来的「击杀时间」会把这种「先急后慢」抹平。
 */
export function timeForShots(w: WeaponProfile, n: number): number {
  if (n <= 0) return 0
  const burst = Math.max(1, w.burst || w.mag || 1)
  const mag = Math.max(1, w.mag || 1)
  let t = w.aim
  let left = mag
  let inBurst = burst
  for (let i = 1; i < n; i++) {
    left--
    if (left <= 0) {
      // 装填和连发节奏是**各自独立的计时器**（ShotCycleAndReload 里分别挂 blocker），
      // 而且一直盯着同一个目标时不会重新瞄准——所以是 max(装填, 连发间隔)，不是装填 + 瞄准
      t += Math.max(w.reload, w.dtBurst)
      left = mag
      inBurst = burst
    } else if (--inBurst <= 0) {
      t += w.dtBurst
      inBurst = burst
    } else {
      t += w.dtShot
    }
  }
  return Math.round(t * 10) / 10
}

/** 打一发平均占多少时间（弹匣打完 + 装填 + 瞄准，摊到每一发）——算秒伤用 */
export function cycleTime(w: WeaponProfile): number {
  const bursts = Math.max(1, Math.ceil(w.mag / w.burst))
  const inBurst = (w.burst - 1) * w.dtShot
  // 装填和连发间隔是独立计时器，取大的那个；瞄准只在第一次开火前算一次，不摊进稳态节奏
  const total = bursts * inBurst + (bursts - 1) * w.dtBurst + Math.max(w.reload, w.dtBurst)
  return total / w.mag
}

export interface ShotResult {
  /** 基础伤害先乘了多少（步兵抗打击 / 楼房减伤），1 = 没打折 */
  mul: number
  pen: number
  armor: number
  /** 穿深够不够（动能弹够了就是满伤；破甲弹是条曲线，不够也有伤害） */
  through: boolean
  /** 打中了掉多少血（走游戏的伤害公式） */
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
  opts: Situation = {}
): ShotResult {
  const pen = penAt(a, dist)
  const armor = armorAt(target, a, facing, dist)
  const through = pen >= armor
  // 先把基础伤害乘上减伤（步兵抗打击、躲楼里），再过装甲公式——游戏就是这个顺序
  const mul = damageMul(target, a, opts)
  const base = a.dmg * mul
  const dmg = damageOf(base, pen, armor, a.armorType, target.armorValue > 0)
  const hit = hitChanceOf(a, target, dist, opts)
  // 溅射同样走伤害公式（按爆心距离衰减之后再过装甲）
  // 溅射的每个落点各自过一遍装甲公式（和游戏一样），不是拿直击伤害按比例缩
  const splash = a.aoe > 0 ? splashExpected(a, target, dist, { pen, armor, mul }) : 0
  const expected = r2(hit * dmg + (1 - hit) * splash)
  // 这种弹自己带瞄准时间就用它的（GenerateRandomAimTime 里弹药覆盖优先）
  const wa = a.aim > 0 ? { ...w, aim: a.aim } : w
  const per = cycleTime(wa)
  const range = rangeFor(a, target)
  const shots = expected > 0 ? Math.ceil(target.hp / expected) : null
  return {
    mul: r3(mul),
    pen,
    armor,
    through,
    dmg,
    hit: r3(hit),
    guided: isGuided(a),
    splash,
    expected,
    shots,
    seconds: shots == null ? null : timeForShots(wa, shots),
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
 * 每件武器挑一种弹。照游戏的 SelectBestShellForTarget 来（反汇编读出来的）：
 *   1. 弹药目标位图 ∩ 目标类型位 ≠ 0
 *   2. 最小射程 ≤ 距离 ≤ 这个目标对应的射程
 *   3. 剩下的里面挑 **命中率 × 实际伤害** 最高的那一发
 *
 * 第 3 步在机器码里是：取这个距离上的穿深 → 过伤害公式拿到对这个目标的实际伤害 →
 * 调 GetTargetAccuracy 拿命中率 → `mulss xmm0, xmm6` 两个一乘，然后和当前最好分比。
 * 所以它会自己避开打不动的弹种，不用我们再加规则。
 */
export function engage(
  attacker: UnitProfile,
  target: UnitProfile,
  dist: number,
  facing: Facing,
  opts: Situation = {}
): Engagement[] {
  return attacker.weapons.map((w) => {
    const all = w.ammo
      .map((ammo) => ({ ammo, result: shotAt(w, ammo, target, dist, facing, opts) }))
      .sort((x, y) => {
        // 先把游戏会考虑的排前面，组内按「命中率 × 实际伤害」——游戏就是这么评分的
        const ok = (r: { result: ShotResult }): number => (r.result.usable && r.result.inRange ? 1 : 0)
        if (ok(x) !== ok(y)) return ok(y) - ok(x)
        const score = (r: { result: ShotResult }): number => r.result.hit * r.result.dmg
        return score(y) - score(x)
      })
    const top = all.find((x) => x.result.usable && x.result.inRange)
    return { weapon: w, best: top?.ammo || null, result: top?.result || null, all }
  })
}

/**
 * 一个单位的总输出。
 *
 * `CanUseFiringChannel` 进门第一件事是 `mov esi, [weapon+0xc0]; test esi, esi; je 返回true`——
 * **通道 0 等于不占通道**，直接放行；只有同一个**非零**通道上的武器才互相挡着。
 *
 * 抢占谁赢看的是 **WeaponPriority，数字小的赢**（0x7B4753/767 处比的是优先级，
 * 不是伤害），平手再比 TargetComponent+8 的那个分数——那个分数我们算不出来，
 * 平手就退回按秒伤挑，界面上标了。
 */
export function totalDps(list: Engagement[]): {
  dps: number
  byChannel: { channel: number; dps: number; weapon: string; priority: number }[]
} {
  const best = new Map<string, { channel: number; dps: number; weapon: string; priority: number }>()
  for (const [i, e] of list.entries()) {
    if (!e.result) continue
    const ch = e.weapon.channel
    const key = ch ? 'c' + ch : 'w' + e.weapon.id + '#' + i
    const cur = best.get(key)
    // 非零通道：优先级数字小的赢；平手才比秒伤
    const better =
      !cur ||
      (ch
        ? e.weapon.priority < cur.priority || (e.weapon.priority === cur.priority && e.result.dps > cur.dps)
        : e.result.dps > cur.dps)
    if (better) best.set(key, { channel: ch, dps: e.result.dps, weapon: e.weapon.name, priority: e.weapon.priority })
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

// ---------- 压制（Stress）----------
// 机制来自 StressSystem：Update / StressRecovery / ApplyStressDamage / SetStressLevel。
// 阈值倍率和三档惩罚读自 globalgamemanagers.assets 里的「Buff Config」资产。
//
//   每 1 秒（STRESS_TICK）结算一次：
//     这一秒挨打了 → 压制值 = clamp(压制值 + 这一秒累计, 0, MaxStress)，挨打计时清零
//     没挨打       → 挨打计时 +1，压制值 −= (挨打计时 × 恢复倍率 + 1)，不低于 0
//   单次命中加的压制 = CalculateStressDamage(maxStress, 掉的血, 弹药 StressDamage, 目标满血)
//                    = 弹药 StressDamage + MaxStress × 掉的血 / 满血
//   定级 = SetStressLevel：压制值 ≥ 红线就是红，否则 ≥ 黄线是黄；红了要等掉回红线以下才降级

export const STRESS = {
  /** StressSystem.STRESS_TICK：压制系统 1 秒结算一次 */
  tick: 1,
  /** BuffConfig.StressRecoveryMultiplier */
  recovery: 1,
  shocked: 0.5,
  panicked: 0.8,
  shockedInf: 0.4,
  panickedInf: 0.8
} as const

export interface StressMod {
  /** 导弹命中率乘数 */
  missile: number
  /** 瞄准时间乘数 */
  aim: number
  /** 连发间隔乘数 */
  burst: number
  /** 装填时间乘数 */
  reload: number
  /** 散布乘数 */
  dispersion: number
  /** 移动速度乘数 */
  move: number
}

/** BuffConfig.StressModifiers：0 正常 / 1 黄（Shocked）/ 2 红（Panicked） */
export const STRESS_MOD: Record<number, { veh: StressMod; inf: StressMod; air: StressMod }> = {
  0: {
    veh: { missile: 1, aim: 1, burst: 1, reload: 1, dispersion: 1, move: 1 },
    inf: { missile: 1, aim: 1, burst: 1, reload: 1, dispersion: 1, move: 1 },
    air: { missile: 1, aim: 1, burst: 1, reload: 1, dispersion: 1, move: 1 }
  },
  1: {
    veh: { missile: 0.85, aim: 1.5, burst: 1, reload: 1.25, dispersion: 1.15, move: 0.6 },
    inf: { missile: 0.85, aim: 2, burst: 1.25, reload: 1.25, dispersion: 1.15, move: 0.6 },
    air: { missile: 1, aim: 1.5, burst: 1, reload: 1, dispersion: 1.5, move: 0.6 }
  },
  2: {
    veh: { missile: 0.5, aim: 2, burst: 1, reload: 1.5, dispersion: 1.52, move: 0.2 },
    inf: { missile: 0.5, aim: 3, burst: 1.5, reload: 1.5, dispersion: 1.52, move: 0.2 },
    air: { missile: 1, aim: 1.5, burst: 1, reload: 1, dispersion: 2, move: 0.2 }
  }
}

export const STRESS_NAME: Record<number, string> = { 0: '正常', 1: '黄（动摇）', 2: '红（崩溃）' }

/** 变黄、变红的压制值门槛（步兵的黄线更低，更容易被打趴） */
export function stressLevels(u: UnitProfile): { shocked: number; panicked: number } {
  const inf = u.klass === 'inf'
  return {
    shocked: Math.round(u.maxStress * (inf ? STRESS.shockedInf : STRESS.shocked)),
    panicked: Math.round(u.maxStress * (inf ? STRESS.panickedInf : STRESS.panicked))
  }
}

/** 这个单位受压制之后自己吃的惩罚（车辆 / 步兵 / 飞机三套数值） */
export function stressPenalty(u: UnitProfile, level: number): StressMod {
  const set = STRESS_MOD[level] || STRESS_MOD[0]
  return u.klass === 'inf' ? set.inf : u.klass === 'plane' || u.klass === 'heli' ? set.air : set.veh
}

export interface SimEvent {
  t: number
  kind: 'shocked' | 'panicked' | 'calm' | 'soldier' | 'dead' | 'dry' | 'aps'
  text: string
  hp: number
  stress: number
}

export interface SimSample {
  t: number
  hp: number
  stress: number
  level: number
  alive: number
}

export interface Simulation {
  events: SimEvent[]
  samples: SimSample[]
  shockedAt: number | null
  panickedAt: number | null
  deadAt: number | null
  shocked: number
  panicked: number
  /** 真正开火的武器（每个发射通道只留最能打的一件） */
  firing: {
    weapon: WeaponProfile
    ammo: AmmoProfile
    result: ShotResult
    shots: number
    /** 总备弹 */
    stock: number
    /** 打光的时刻，没打光就是 null */
    dry: number | null
  }[]
  /** 稳定开火时每秒进账多少压制 */
  stressPerSec: number
  /** 停火后第一秒恢复多少（之后每秒再多 1） */
  recoveryFirst: number
  hpPerSoldier: number
  /** APS 拦下来几发 */
  intercepted: number
  /** 打完之后 APS 还剩几发 */
  apsLeft: number
}

/**
 * 沿时间轴打一遍：能同时开火的武器各按自己的弹匣节奏射击，
 * 累计掉血、掉人、压制值，记下变黄变红和被打死的时刻。
 *
 * 开火节奏按武器的弹匣结构走（连发内 dtShot，连发之间 dtBurst，打空 reload + aim），
 * 单发伤害用 shotAt 的期望值（命中 × 直击 + 未命中 × 溅射），弹种是 engage 按游戏规则挑的。
 */
export function simulate(
  list: Engagement[],
  target: UnitProfile,
  opts: { limit?: number; sit?: Situation } = {}
): Simulation {
  const limit = opts.limit ?? 90
  const sit = opts.sit || {}
  const lv = stressLevels(target)
  // 同一个非零通道上的武器不能同时开火；通道 0 不占通道，各打各的（和 totalDps 一个规则）
  const byCh = new Map<string, Engagement>()
  for (const [i, e] of list.entries()) {
    const r = e.result
    if (!r || !e.best || r.expected <= 0) continue
    const key = e.weapon.channel ? 'c' + e.weapon.channel : 'w' + e.weapon.id + '#' + i
    const cur = byCh.get(key)
    const better =
      !cur ||
      (e.weapon.channel
        ? e.weapon.priority < cur.weapon.priority ||
          (e.weapon.priority === cur.weapon.priority && r.dps > (cur.result?.dps ?? 0))
        : r.dps > (cur.result?.dps ?? 0))
    if (better) byCh.set(key, e)
  }
  const guns = [...byCh.values()].map((e) => {
    const w = e.weapon
    const burst = Math.max(1, w.burst || w.mag || 1)
    // 总备弹：这种弹在这个单位上带了多少发（班组按人数乘）。打光了这件武器就哑火
    const stock = Math.max(1, (e.best as AmmoProfile).qty || w.mag || 1) * Math.max(1, w.count)
    return {
      e,
      w,
      next: w.aim,
      left: Math.max(1, w.mag || 1),
      inBurst: burst,
      burst,
      shots: 0,
      stock,
      dry: null as number | null
    }
  })

  // 主动防护：每 cooldown 秒拦一发，拦完备弹就没了。
  // 数据里所有 APS 都是 6 秒冷却、2 或 4 发，覆盖值一律是 2（不区分单位，所以不拿它算概率）。
  const aps = target.abilities.aps
  let apsLeft = aps ? aps.qty : 0
  let apsReady = 0
  let intercepted = 0

  const squadSize = target.squad.length
  const hpPerSoldier = squadSize ? target.hp / squadSize : 0
  // 优先级数字大的先死，同级随机（KillSquadSolders 取最大值再随机挑一个）
  const order = target.squad.slice().sort((a, b) => b.death - a.death)

  const events: SimEvent[] = []
  const samples: SimSample[] = []
  let hp = target.hp
  let stress = 0
  let level = 0
  let sinceHit = 0
  let alive = squadSize
  let pending = 0
  let deadAt: number | null = null
  let shockedAt: number | null = null
  let panickedAt: number | null = null

  // 曲线从原点起画，不然只打两秒的时候前面会空一截
  samples.push({ t: 0, hp: r2(hp), stress: 0, level: 0, alive })
  /** 上一次记曲线的时刻：压制是每秒结算的，但血量每一发都在掉，得记细一点 */
  let lastSample = 0
  const SAMPLE = 0.25

  const dt = 0.05
  /** 这一发打完了，把这件武器的下一发排上（连发 / 连发间隔 / 打空换弹） */
  type Gun = (typeof guns)[number]
  const advance = (g: Gun): void => {
    g.left--
    if (g.left <= 0) {
      // 见 timeForShots：装填和连发是独立计时器，不额外加瞄准
      g.next += Math.max(g.w.reload, g.w.dtBurst)
      g.left = Math.max(1, g.w.mag || 1)
      g.inBurst = g.burst
    } else if (--g.inBurst <= 0) {
      g.next += g.w.dtBurst
      g.inBurst = g.burst
    } else {
      g.next += g.w.dtShot
    }
  }
  const push = (t: number, kind: SimEvent['kind'], text: string): void => {
    events.push({ t: Math.round(t * 10) / 10, kind, text, hp: r2(Math.max(0, hp)), stress: Math.round(stress) })
  }

  for (let t = 0; t <= limit + 1e-9 && deadAt == null; t += dt) {
    for (const g of guns) {
      while (g.next <= t + 1e-9 && deadAt == null && g.shots < g.stock) {
        const r = g.e.result as ShotResult
        const a = g.e.best as AmmoProfile
        let n = g.w.count
        // APS 先拦一发：拦得住的弹种（导弹、反坦克火箭），冷却好了、备弹还有，这一发就没了。
        // 数据里所有 APS 都是 6 秒一发，所以齐射打过去只有第一发会被吃掉
        if (a.intercept && apsLeft > 0 && t >= apsReady) {
          apsLeft--
          intercepted++
          apsReady = t + (aps?.cooldown || 6)
          g.shots += 1
          n -= 1
          push(t, 'aps', (aps?.name || 'APS') + ' 拦下一发 ' + a.name + '（还剩 ' + apsLeft + ' 发）')
        }
        if (n <= 0) {
          advance(g)
          continue
        }
        // 减伤是活的：步兵一边掉人一边变，压制到红了就直接不扛打了，所以每一发重算
        const mul = damageMul(target, a, { ...sit, alive, level })
        const base = a.dmg * mul
        const dmg = damageOf(base, r.pen, r.armor, a.armorType, target.armorValue > 0)
        const splash = a.aoe > 0 && dmg > 0 ? (r.splash / Math.max(1e-9, r.mul)) * mul : 0
        const expected = r.hit * dmg + (1 - r.hit) * splash
        const dealt = Math.min(hp, expected * n)
        hp -= dealt
        g.shots += n
        // 压制 = 弹药自带的（按命中率打折）+ 掉血换算过来的
        pending += r.hit * a.stress * n + (target.maxStress * dealt) / (target.hp || 1)

        if (squadSize) {
          const now = Math.max(0, Math.min(squadSize, Math.ceil(hp / hpPerSoldier)))
          while (alive > now) {
            const m = order[squadSize - alive]
            alive--
            push(t, 'soldier', '倒下 1 人（剩 ' + alive + '）：' + (m ? m.name : '步枪手'))
          }
        }
        if (hp <= 0) {
          hp = 0
          deadAt = t
          push(t, 'dead', '目标被打死')
          break
        }
        if (g.shots >= g.stock) {
          g.dry = t
          push(t, 'dry', g.w.name + ' 打光了（' + g.stock + ' 发）')
          break
        }
        advance(g)
      }
    }

    // 压制怎么结算（StressSystem.Update）：
    //   挨打了（PendingDamages 非空）→ **每一帧都结算**，不等计时器（`cmp [pending+0x18],0 / jg`）
    //   没挨打                        → 才看 STRESS_TICK 的计时器，跑恢复
    // 所以挨打是立刻上压制的，只有恢复按秒走。
    const tick = t > 0 && Math.abs(t / STRESS.tick - Math.round(t / STRESS.tick)) < dt / 2
    if (deadAt == null && (pending > 0 || tick)) {
      if (pending > 0) {
        stress = clamp(stress + pending, 0, target.maxStress)
        sinceHit = 0
        pending = 0
      } else {
        sinceHit += STRESS.tick
        stress = Math.max(0, stress - (Math.floor(sinceHit) * STRESS.recovery + 1))
      }
      const before = level
      level = stress < lv.panicked ? (stress >= lv.shocked ? 1 : 0) : 2
      if (level !== before) {
        if (level === 2) {
          panickedAt = panickedAt ?? t
          push(t, 'panicked', '压制 ' + Math.round(stress) + '（红线 ' + lv.panicked + '），变红：崩溃')
        } else if (level === 1 && before === 0) {
          shockedAt = shockedAt ?? t
          push(t, 'shocked', '压制 ' + Math.round(stress) + '（黄线 ' + lv.shocked + '），变黄：动摇')
        } else {
          push(t, 'calm', '压制掉到 ' + Math.round(stress) + '，回到' + (level === 1 ? '黄' : '正常'))
        }
      }
    }

    // 曲线按固定间隔记，和整秒结算分开——不然打死的那一下会落在两次采样中间，
    // 曲线画到一半就断了，横轴也对不上上面写的「打死 X 秒」
    if (t - lastSample >= SAMPLE - 1e-9 || deadAt != null) {
      lastSample = t
      samples.push({ t: Math.round(t * 100) / 100, hp: r2(hp), stress: Math.round(stress), level, alive })
    }
  }

  const firing = guns
    .filter((g) => g.shots > 0)
    .map((g) => ({
      weapon: g.w,
      ammo: g.e.best as AmmoProfile,
      result: g.e.result as ShotResult,
      shots: g.shots,
      stock: g.stock,
      dry: g.dry == null ? null : Math.round(g.dry * 10) / 10
    }))
  const stressPerSec =
    Math.round(
      firing.reduce((s, f) => {
        const per = cycleTime(f.weapon)
        const dealt = f.result.expected * f.weapon.count
        return s + (f.result.hit * f.ammo.stress * f.weapon.count + (target.maxStress * dealt) / (target.hp || 1)) / per
      }, 0) * 10
    ) / 10

  return {
    events,
    samples,
    shockedAt: shockedAt == null ? null : Math.round(shockedAt * 10) / 10,
    panickedAt: panickedAt == null ? null : Math.round(panickedAt * 10) / 10,
    deadAt: deadAt == null ? null : Math.round(deadAt * 10) / 10,
    shocked: lv.shocked,
    panicked: lv.panicked,
    firing,
    stressPerSec,
    recoveryFirst: STRESS.recovery + 1,
    hpPerSoldier: r2(hpPerSoldier),
    intercepted,
    apsLeft
  }
}
