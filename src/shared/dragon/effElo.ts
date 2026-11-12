// ================= 实力 ELO =================
// ELO 只看输赢，涨跌慢；龙区分看每局打得怎么样。实力 ELO 把两者合起来：
//   实力 ELO = ELO + 修正值
//   修正值   = (b0 + b1 × (ELO − ref) / span) × (龙区分 − mid)
// b0、b1 由 scripts/fit-effective-elo.ts 用真实对局拟合（赛前龙区分能不能帮 ELO 预测胜负），
// 存在 model.json 的 effElo 字段。没有这个字段时修正值为 0，实力 ELO 就等于 ELO。
// 方法和回测数字见 docs/algorithm.md「实力 ELO」。纯函数、无 I/O。
import { MODEL } from './model'

export interface EffEloParams {
  /** 2000 分时龙区分每高 1 分，实力 ELO 高多少 */
  b0: number
  /** ELO 每高 span 分，上面这个数再加多少 */
  b1: number
  ref: number
  span: number
  /** 龙区分的中位（5.5） */
  mid: number
  /** 拟合数据覆盖的 ELO 范围，范围外按边界算，免得外推出离谱的斜率 */
  eloRange: [number, number]
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** 修正值（ELO 分）。参数为 null（模型里没有 effElo）、ELO 或龙区分不是有限数时返回 0 */
export function effEloShift(elo: number, score: number, p: EffEloParams | null = MODEL.effElo ?? null): number {
  if (!p || !Number.isFinite(elo) || !Number.isFinite(score)) return 0
  const e = clamp(elo, p.eloRange[0], p.eloRange[1])
  return (p.b0 + (p.b1 * (e - p.ref)) / p.span) * (score - p.mid)
}

/** 实力 ELO，四舍五入到整数 */
export function effectiveElo(elo: number, score: number, p: EffEloParams | null = MODEL.effElo ?? null): number {
  return Math.round(elo + effEloShift(elo, score, p))
}
