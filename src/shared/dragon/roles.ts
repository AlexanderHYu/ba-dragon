// 角色构成：这个人这一局（或这一阵子）的钱花在哪个兵种上。
// 龙区分拿它当「和谁比」的依据——空军的 K/D 天然高、炮兵的占点天然低，都由角色构成和数据说了算。
import type { CategoryPreference, HighlightUnit, PlayerData, UnitInfo } from '../types/batrace'
import {
  CAT_KEYS,
  MODEL,
  ROLE_KEYS,
  emptyRoles,
  type CatKey,
  type RoleKey,
  type RoleShare,
  type Roles,
  type UnitEntry
} from './model'

/**
 * 单位库的类别 + 用途 → 我们的 7 个角色。运输/后勤不算角色（返回 null）。
 * category_type：0 侦察 1 步兵 2 载具 3 支援 4 后勤 5 直升机 6 固定翼
 */
export function roleKeyOf(categoryType: unknown, role: unknown): RoleKey | null {
  switch (Number(categoryType)) {
    case 0:
      return 'recon'
    case 1:
      return Number(role) === 34 ? 'aa' : 'inf' // 34 = 单兵防空
    case 2:
      return 'armor'
    case 3: {
      const r = Number(role)
      if (r === 14) return null // 卡车
      if (r === 15 || r === 16) return 'aa'
      return 'arty'
    }
    case 5: {
      const r = Number(role)
      return r === 71 || r === 72 ? null : 'heli' // 71/72 = 运输直升机
    }
    case 6:
      return Number(role) === 163 ? null : 'jet' // 163 = 运输机
    default:
      return null
  }
}

/** /api/units → { 单位ID: [角色, 基础价格, 名称, 国家, 类别] }。模型里已存一份，运行时不用再请求 */
export function buildUnitMap(units: UnitInfo[]): Record<string, UnitEntry> {
  const m: Record<string, UnitEntry> = {}
  for (const u of Array.isArray(units) ? units : []) {
    m[u.id] = [
      roleKeyOf(u.category_type, u.role),
      Number(u.cost) || 0,
      u.hud_name || u.name || '',
      Number(u.country_id) || 0,
      Number(u.category_type)
    ]
  }
  return m
}

export type UnitMap = Record<string, UnitEntry>
const unitMapOf = (um?: UnitMap): UnitMap => um || MODEL.units || {}

/** 花费类别 → 角色的默认拆分（模型里有按全体数据统计的版本，这里是兜底） */
export const DEFAULT_SPLIT: Record<CatKey, Partial<RoleShare>> = {
  recon: { recon: 1 },
  infantry: { inf: 0.9, aa: 0.1 },
  vehicles: { armor: 1 },
  support: { arty: 0.45, aa: 0.55 },
  logistic: {},
  helicopters: { heli: 1 },
  aircrafts: { jet: 1 }
}

function normRoles(acc: RoleShare): Roles | null {
  const sum = ROLE_KEYS.reduce((s, k) => s + acc[k], 0)
  if (!(sum > 0)) return null
  const r = emptyRoles()
  for (const k of ROLE_KEYS) r[k] = acc[k] / sum
  return { ...r, known: true }
}

/** 没有任何数据时的兜底：全体平均构成，标 known: false */
export function defaultRoles(): Roles {
  return { ...MODEL.avgRoles, known: false }
}

/** 本局实际出的单位 → 角色占比（按单位价格加权；只有 /api/match 有 UnitData） */
export function rolesFromUnits(player: PlayerData, unitMap?: UnitMap): Roles | null {
  const um = unitMapOf(unitMap)
  const acc = emptyRoles()
  for (const u of Object.values(player?.UnitData || {})) {
    const e = um[u.Id]
    if (e && e[0]) acc[e[0]] += e[1] || 1
  }
  return normRoles(acc)
}

/**
 * 生涯花费（/api/analysis/player 的 categoryPreferences）→ 角色占比。
 * 同一类别里再用最常用的 15 个单位（highlightUnits）拆分，例如「支援」拆成炮兵和防空。
 */
export function rolesFromCareer(
  categoryPreferences?: CategoryPreference[],
  highlightUnits?: HighlightUnit[],
  unitMap?: UnitMap,
  catSplit?: Record<string, Partial<RoleShare>>
): Roles | null {
  const um = unitMapOf(unitMap)
  const split = catSplit || MODEL.catSplit || DEFAULT_SPLIT
  const hl: Record<string, Record<string, number> & { total: number }> = {}
  for (const u of Array.isArray(highlightUnits) ? highlightUnits : []) {
    const e = um[String(u.unitId)]
    const cat = CAT_KEYS[Number(u.categoryType)]
    if (!cat) continue
    const bucket = (hl[cat] ||= { total: 0 })
    const cost = Number(u.totalCost) || 0
    bucket.total += cost
    const role = e ? e[0] : null
    const key = role || '_none'
    bucket[key] = (bucket[key] || 0) + cost
  }
  const acc = emptyRoles()
  for (const c of Array.isArray(categoryPreferences) ? categoryPreferences : []) {
    const spend = Number(c.totalCost) || 0
    const def = split[String(c.categoryKey)] || {}
    const h = hl[String(c.categoryKey)]
    // 最常用单位的花费当观测、默认拆分当先验（相当于该类别 30% 花费的分量）
    const prior = 0.3 * spend
    const denom = (h ? h.total : 0) + prior
    for (const k of ROLE_KEYS) {
      const share =
        denom > 0 ? ((h?.[k] || 0) + prior * (def[k] || 0)) / denom : def[k] || 0
      acc[k] += spend * share
    }
  }
  return normRoles(acc)
}
