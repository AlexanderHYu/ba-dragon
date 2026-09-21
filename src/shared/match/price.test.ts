// 精确价目表这条路的测试：
//   1. 配装怎么拼名字、怎么加钱（纯逻辑，随便什么机器上都能跑）
//   2. 真从游戏文件里读一遍（要本机装着游戏、而且给了密钥才跑）
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadoutOf, type GamePrices } from './report'

/** 造一张小价目表：M1A1 FEP（260）+ TUSK（20）+ Trophy（70，名字后面接 " Trophy"） */
const TABLE: GamePrices = {
  units: { 54: ['M1A1 FEP', 260], 24: ['Stryker MGS', 85], 140: ['M8 AGS', 90] },
  options: {
    119: [20, null, null, 'TUSK'],
    1792: [70, null, ' Trophy', 'Trophy'],
    1931: [35, null, ' Trophy', 'SRAT APS'],
    1933: [5, null, null, 'MK19'],
    381: [60, 'M8 Thunderbolt', null, 'M291 120mm'],
    999: [0, null, null, ''] // 空槽位：价目表那边已经把标签抹成空串了
  }
}

describe('配装的名字和价钱', () => {
  it('基础价 + 每个选项的加价', () => {
    expect(loadoutOf(TABLE, 54, [119, 1792])).toEqual({
      name: 'M1A1 FEP Trophy',
      cost: 350,
      loadout: 'TUSK · Trophy'
    })
  })

  it('有的选项会把整个单位改名', () => {
    const r = loadoutOf(TABLE, 140, [381])
    expect(r?.name).toBe('M8 Thunderbolt')
    expect(r?.cost).toBe(150)
  })

  it('空槽位（标签是空的）不进挂载明细', () => {
    expect(loadoutOf(TABLE, 24, [1931, 1933, 999])?.loadout).toBe('SRAT APS · MK19')
    // 但钱还是要算的
    expect(loadoutOf(TABLE, 24, [1931, 1933, 999])?.cost).toBe(125)
  })

  it('没配装就是裸车价', () => {
    expect(loadoutOf(TABLE, 24, [])).toEqual({ name: 'Stryker MGS', cost: 85, loadout: '' })
  })

  it('有一个选项查不到就整套作废（宁可退回估算，也不给个半吊子价钱）', () => {
    expect(loadoutOf(TABLE, 54, [119, 123456])).toBeNull()
    expect(loadoutOf(TABLE, 777, [])).toBeNull()
    expect(loadoutOf(undefined, 54, [119])).toBeNull()
  })
})
