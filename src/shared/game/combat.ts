// 配装计算器用的那份游戏数据：武器、弹药、装甲、炮塔、班组、能力。
// 为了省体积全部压成数组，下面的常量就是每个位置的含义。combat.json 由
// scripts/export-gamedata.mts 从游戏文件里导出来，游戏更新之后重新导一次。
import raw from './combat.json'

/** 单位：[名字, 价格, 长, 宽, 高, 最大压制, 隐蔽, 类别, 兵种角色] */
export type CUnit = [string, number, number, number, number, number, number, number, number]
/** 装甲：[血量, 动能前, 动能侧, 动能后, 动能顶, 破甲前, 破甲侧, 破甲后, 破甲顶, 步兵护甲值] */
export type CArmor = [number, number, number, number, number, number, number, number, number, number]
/**
 * 武器：[名字, 弹匣, 装填min, 装填max, 一次点射几发min, max, 点射内间隔,
 *        点射之间min, max, 瞄准min, 瞄准max, 行进间能不能打, 稳定器, 依赖雷达, 同时跟踪]
 */
export type CWeapon = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  number,
  0 | 1,
  number
]
/**
 * 弹药：[名字, 伤害, 压制伤害, 近距穿深, 地面距离穿深, 地面射程, 低空射程, 高空射程,
 *        目标类型位图, 针对装甲(0无/1动能/2破甲), 血量AOE半径, 压制AOE半径, 超压半径,
 *        顶部攻击, 可被拦截, 激光制导, 水平散布, 垂直散布, 最小射程, 暴击倍率, 无视掩体]
 */
export type CAmmo = [
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  0 | 1,
  0 | 1,
  0 | 1,
  number,
  number,
  number,
  number,
  number
]
/**
 * 能力：[名字, 是APS, APS拦截次数, APS冷却, APS覆盖倍数, ECM命中率乘数,
 *        是诱饵, 诱饵数量, 诱饵命中率乘数, 诱饵持续, 诱饵冷却, 是烟雾, 是激光指示, 是雷达]
 */
export type CAbility = [
  string,
  0 | 1,
  number,
  number,
  number,
  number,
  0 | 1,
  number,
  number,
  number,
  number,
  0 | 1,
  0 | 1,
  0 | 1
]
/** 炮塔挂在单位上：[炮塔id, 槽位序号, 炮塔类别（MainTurret/CupolaTurret…）, 是不是默认] */
export type CTurretMount = [number, number, string, 0 | 1]
/** 配装选项对单位的改动 */
export interface COptionEffect {
  /** 换装甲 */
  a?: number
  /** 换炮塔：槽位 → 炮塔 id */
  t?: Record<number, number>
  /** 加能力 */
  b?: number[]
  /** 整个换成另一个单位（步兵的班组变体就是这么做的） */
  u?: number
  /** 换主传感器 */
  s?: number
  /** 换机动 */
  m?: number
}

export interface CombatData {
  meta: { updatedAt: string; stamp: string }
  units: Record<number, CUnit>
  armors: Record<number, CArmor>
  /** 单位默认装甲 */
  unitArmor: Record<number, number>
  /** 单位能挂的炮塔（含各种变体） */
  turrets: Record<number, CTurretMount[]>
  /** 炮塔上的武器 */
  turretWeapons: Record<number, number[]>
  weapons: Record<number, CWeapon>
  /** "单位id:武器id" → [[弹药id, 携带量], …] */
  weaponAmmo: Record<string, [number, number][]>
  ammo: Record<number, CAmmo>
  abilities: Record<number, CAbility>
  unitAbilities: Record<number, number[]>
  options: Record<number, COptionEffect>
  /** 步兵班：[[主武器, 特殊武器, 死亡顺序], …] */
  squad: Record<number, [number, number, number][]>
  /** 单位有哪些配装槽位：[槽位名, [[选项id, 是不是默认], …]] */
  unitOptions: Record<number, [string, [number, 0 | 1][]][]>
  /** 传感器：[名字, 对地, 低空, 高空] */
  sensors: Record<number, [string, number, number, number]>
  /** 机动：[名字, 公路, 越野, 倒车, 转向, 加速, 爬升, 滞空, 加力滞空, 两栖, 可空投] */
  mobility: Record<number, [string, number, number, number, number, number, number, number, number, 0 | 1, 0 | 1]>
}

export const COMBAT = raw as unknown as CombatData

export const hasCombat = (): boolean => Object.keys(COMBAT.units || {}).length > 0

// ---------- 位置常量，别到处写魔法下标 ----------
export const U = { name: 0, cost: 1, len: 2, wid: 3, hei: 4, stress: 5, stealth: 6, cat: 7, role: 8 } as const
export const A = { hp: 0, kf: 1, ks: 2, kr: 3, kt: 4, hf: 5, hs: 6, hr: 7, ht: 8, inf: 9 } as const
export const W = {
  name: 0,
  mag: 1,
  reloadMin: 2,
  reloadMax: 3,
  burstMin: 4,
  burstMax: 5,
  dtShot: 6,
  dtBurstMin: 7,
  dtBurstMax: 8,
  aimMin: 9,
  aimMax: 10,
  move: 11,
  stab: 12,
  radar: 13,
  tracking: 14
} as const
export const M = {
  name: 0,
  dmg: 1,
  stress: 2,
  penMin: 3,
  penFar: 4,
  range: 5,
  lowAlt: 6,
  highAlt: 7,
  target: 8,
  armorType: 9,
  aoe: 10,
  aoeStress: 11,
  overpressure: 12,
  topAttack: 13,
  intercept: 14,
  laser: 15,
  dispH: 16,
  dispV: 17,
  minRange: 18,
  crit: 19,
  ignoreCover: 20
} as const
export const B = {
  name: 0,
  isAPS: 1,
  apsQty: 2,
  apsCd: 3,
  apsProp: 4,
  ecm: 5,
  isDecoy: 6,
  decoyQty: 7,
  decoyMul: 8,
  decoyDur: 9,
  decoyCd: 10,
  isSmoke: 11,
  isLaser: 12,
  isRadar: 13
} as const
