// 龙区分模型：所有参数（各角色的「普通水平」、分项权重、汇总速度、分档、称号阈值）
// 都来自真实数据拟合，由 scripts/fit-model.ts 生成，存在 model.json。这里只声明它的形状。
import raw from './model.json'

/** 单位表的一项：[角色, 基础价格, 名称, 国家(1 俄 / 2 美), 单位库类别] */
export type UnitEntry = [RoleKey | null, number, string, number, number]

export const ROLE_KEYS = ['armor', 'inf', 'recon', 'arty', 'aa', 'heli', 'jet'] as const
export type RoleKey = (typeof ROLE_KEYS)[number]
/** 前线兵种：占点主要靠他们 */
export const FRONT: RoleKey[] = ['armor', 'inf', 'recon']
export const CAT_KEYS = ['recon', 'infantry', 'vehicles', 'support', 'logistic', 'helicopters', 'aircrafts'] as const
export type CatKey = (typeof CAT_KEYS)[number]

export type RoleShare = Record<RoleKey, number>
/** known = 角色构成是真实数据算出来的，false 表示用了全体平均兜底 */
export interface Roles extends RoleShare {
  known: boolean
}

export interface NormEntry {
  /** 各角色的平均水平 */
  mu: RoleShare
  sigma: RoleShare
  /** ELO 和分差的修正系数 */
  elo: number
  gap: number
  /** 标准分 → 百分位的经验分布（101 个点） */
  q: number[]
}
export interface Norm {
  kd: NormEntry
  con: NormEntry
  obj: NormEntry
}

export interface DragonModel {
  expect: { scale: number; afkPenalty: number }
  units: Record<string, UnitEntry>
  catSplit: Record<string, Partial<RoleShare>>
  avgRoles: RoleShare
  norm: { match: Norm; career: Norm }
  weights: { kd: number; con: number; obj: number; out: number }
  outSd: number
  kalman: { P0: number; q: number; r: number; shortMin: number }
  matchPct: { match: number[]; career: number[] }
  playerPct: number[]
  marks: { dragon: number; qu: number }
  tiers: [number, string][]
  titles: Record<string, number>
  titleDist: Record<string, { n: number; top: number[] }>
  titleFreq: Record<string, number>
}

export const MODEL = raw as unknown as DragonModel

export const emptyRoles = (): RoleShare =>
  Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as RoleShare
