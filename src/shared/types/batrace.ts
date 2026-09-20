// BATrace 接口返回的数据结构。
// 注意：接口是 protobuf 转 JSON，**值为 0 / false 的字段会被整个省略**，
// 所以几乎所有字段都是可选的，读的时候一律当「缺失 = 0」处理（见 num()）。

/** 一个单位的一次出场（飞机是一个架次：返航后再出是新的一条） */
export interface UnitData {
  Id: number
  /** 配装（挂载/改装）选项 ID，单位库里查不到名字，见 docs 里的配装说明 */
  OptionIds?: number[]
  SpawnTime?: number
  DeathTime?: number
  TotalDamageDealt?: number
  TotalDamageReceived?: number
  KilledCount?: number
  BuildingDestroyedCount?: number
  /** 回收：飞机返航、卡车开回、开局卖掉。官方全额退款，不是「没出过」 */
  WasRefunded?: boolean
}

export interface PlayerData {
  Id: number | string
  Name?: string
  /** 缺失 = 0 队（A 队）；观战是别的值 */
  TeamId?: number
  OldRating?: number
  NewRating?: number
  /** 摧毁分 / 损失分（钱的尺度） */
  DestructionScore?: number
  LossesScore?: number
  /** 击杀数 / 阵亡数（个数） */
  Destruction?: number
  Losses?: number
  DamageDealt?: number
  DamageReceived?: number
  ObjectivesCaptured?: number
  TotalSpawnedUnitScore?: number
  TotalRefundedUnitScore?: number
  SupplyPointsConsumed?: number
  SupplyPointsConsumedFromAllies?: number
  SupplyPointsConsumedByAllies?: number
  SupplyCaptured?: number
  SupplyCapturedByEnemy?: number
  SupplyAirdropped?: number
  DestructionFriendlyFireCost?: number
  LossesByFriendlyFireScore?: number
  TotalExp?: number
  Medals?: unknown[]
  /** 游戏自己的逃兵标记 */
  Deserter?: boolean
  UnitData?: Record<string, UnitData>
}

export interface MatchInfo {
  MapId?: number
  Type?: number
  StartTime?: number
  EndTime?: number
  TotalPlayTimeInSec?: number
  TotalObjectiveZonesCount?: number
  VictoryLevel?: number
  EndMatchReason?: number
  Data?: Record<string, PlayerData>
}

/** /api/players/matches 的一项，或把 /api/match 的 matchInfo 包一层 */
export interface MatchEntry {
  matchId?: number | string
  data?: MatchInfo
}

/** /api/units 的一项 */
export interface UnitInfo {
  id: number
  name?: string
  hud_name?: string
  cost?: number
  country_id?: number
  category_type?: number
  role?: number
}

/** /api/analysis/player 的兵种花费 */
export interface CategoryPreference {
  categoryKey?: string
  totalCost?: number
}

/** /api/analysis/player 的最常用单位 */
export interface HighlightUnit {
  unitId?: number
  categoryType?: number
  totalCost?: number
}

export const num = (v: unknown): number => Number(v) || 0
