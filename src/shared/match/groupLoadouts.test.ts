import { describe, expect, it } from 'vitest'
import { groupLoadouts, type ReportUnit } from './report'

const unit = (over: Partial<ReportUnit>): ReportUnit => ({
  id: 1, options: '', name: 'T-90M', loadout: '', role: 'armor', roleName: '装甲', team: 0,
  cost: 100, value: 0, count: 0, deployed: 0, refunded: 0, dead: 0, spent: 0, lost: 0,
  deathRate: null, lifeMedian: null, dmg: 0, kills: 0, dmgPerCost: null, destr: 0, destrPerCost: null,
  killsPer1k: null, users: [], lives: [], ...over
})

describe('groupLoadouts', () => {
  it('同一队同一单位的多种配装合成一组，数量相加、比值重算', () => {
    const a = unit({ options: 'a', loadout: 'A', cost: 100, value: 300, count: 3, deployed: 3, dead: 3, spent: 300, dmg: 30, kills: 3, destr: 300, users: ['甲'], lives: [10, 20, 30] })
    const b = unit({ options: 'b', loadout: 'B', cost: 200, value: 200, count: 1, deployed: 1, dead: 0, spent: 200, dmg: 10, kills: 1, destr: 100, users: ['乙', '甲'], lives: [] })
    const [g] = groupLoadouts([a, b])
    expect(g.variants).toHaveLength(2)
    expect(g.total).toMatchObject({ deployed: 4, dead: 3, spent: 500, value: 500, cost: 125, deathRate: 75, lifeMedian: 20, destrPerCost: 0.8, loadout: '2 种配装' })
    expect(g.total.users.sort()).toEqual(['乙', '甲'].sort())
  })
  it('不同队伍、不同单位分开；只有一种配装的原样返回', () => {
    const gs = groupLoadouts([unit({ team: 0 }), unit({ team: 1 }), unit({ id: 2, team: 0 })])
    expect(gs).toHaveLength(3)
    expect(gs.every((g) => g.variants.length === 1 && g.total === g.variants[0])).toBe(true)
  })
  it('老缓存没有存活时间时，中位数按阵亡数加权近似', () => {
    const a = unit({ options: 'a', dead: 3, deployed: 3, lifeMedian: 10, lives: undefined })
    const b = unit({ options: 'b', dead: 1, deployed: 1, lifeMedian: 50, lives: undefined })
    expect(groupLoadouts([a, b])[0].total.lifeMedian).toBe(20)
  })
})
