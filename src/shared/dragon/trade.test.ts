import { describe, expect, it } from 'vitest'
import type { PlayerData } from '../types/batrace'
import { emptyRoles, type RoleKey, type UnitEntry } from './model'
import { TRADE, TRADE_NORM, tradeMult } from './score'

// 假单位表：每个兵种一个单位，价格都是 100
const UM: Record<string, UnitEntry> = {
  1: ['armor', 100, '坦克', 1, 2],
  2: ['inf', 100, '步兵', 1, 1],
  3: ['arty', 100, '火炮', 1, 3],
  4: ['jet', 100, '飞机', 1, 6],
  5: [null, 100, '卡车', 1, 3]
}
const unit = (Id: number, o: { kills?: number; dead?: boolean; refunded?: boolean } = {}): PlayerData['UnitData'] =>
  ({ [Id + ':' + Math.random()]: { Id, KilledCount: o.kills, DeathTime: o.dead ? 100 : undefined, WasRefunded: o.refunded } }) as never
const player = (...us: PlayerData['UnitData'][]): PlayerData => ({ Id: 1, UnitData: Object.assign({}, ...us) })
const roles = (r: Partial<Record<RoleKey, number>>): ReturnType<typeof emptyRoles> => ({ ...emptyRoles(), ...r })

describe('交换加权', () => {
  it('死坦克罚得比死炮兵轻；坦克的击杀比炮兵的值钱', () => {
    const tank = tradeMult(player(unit(1, { kills: 3, dead: true })), null, UM)
    const arty = tradeMult(player(unit(3, { kills: 3, dead: true })), null, UM)
    expect(tank.l).toBeCloseTo(TRADE.loss.armor * TRADE_NORM.loss)
    expect(arty.l).toBeCloseTo(TRADE.loss.arty * TRADE_NORM.loss)
    expect(tank.l).toBeLessThan(arty.l)
    expect(tank.k).toBeGreaterThan(arty.k)
  })

  it('击杀按各单位击杀数分摊，损失按阵亡单位价格分摊', () => {
    const p = player(unit(1, { kills: 3 }), unit(4, { kills: 1 }), unit(2, { dead: true }), unit(3, { dead: true }))
    const t = tradeMult(p, null, UM)
    expect(t.k).toBeCloseTo(((3 * TRADE.kill.armor + TRADE.kill.jet) / 4) * TRADE_NORM.kill)
    expect(t.l).toBeCloseTo(((TRADE.loss.inf + TRADE.loss.arty) / 2) * TRADE_NORM.loss)
  })

  it('退款回收的不算损失；运输/后勤按 1', () => {
    const t = tradeMult(player(unit(3, { dead: true, refunded: true }), unit(5, { dead: true })), null, UM)
    expect(t.l).toBeCloseTo(TRADE_NORM.loss)
  })

  it('没有击杀/阵亡时按兵种构成估；Roles 上的 known 字段不能算进去', () => {
    const t = tradeMult({ Id: 1 }, { ...roles({ armor: 0.5, arty: 0.5 }), known: true } as never, UM)
    expect(Number.isFinite(t.k) && Number.isFinite(t.l)).toBe(true)
    expect(t.l).toBeCloseTo(((TRADE.loss.armor + TRADE.loss.arty) / 2) * TRADE_NORM.loss)
  })

  it('什么都没有时是 1（不加权）', () => {
    const t = tradeMult({ Id: 1 }, null, UM)
    expect(t.k).toBeCloseTo(1)
    expect(t.l).toBeCloseTo(1)
  })
})
