import { describe, expect, it } from 'vitest'
import { effEloShift, effectiveElo, type EffEloParams } from './effElo'

const P: EffEloParams = { b0: 80, b1: 20, ref: 2000, span: 500, mid: 5.5, eloRange: [1000, 3000] }

describe('实力 ELO', () => {
  it('龙区分在中位时等于 ELO', () => {
    expect(effectiveElo(2000, 5.5, P)).toBe(2000)
    expect(effectiveElo(2600, 5.5, P)).toBe(2600)
  })

  it('2000 分时每高 1 分龙区分加 b0', () => {
    expect(effEloShift(2000, 8, P)).toBeCloseTo(80 * 2.5)
    expect(effectiveElo(2000, 8, P)).toBe(2200)
    expect(effectiveElo(2000, 3, P)).toBe(1800)
  })

  it('斜率随 ELO 变化：每高 span 分多 b1', () => {
    expect(effEloShift(2500, 6.5, P)).toBeCloseTo(100)
    expect(effEloShift(1500, 6.5, P)).toBeCloseTo(60)
  })

  it('ELO 超出拟合范围时按边界算斜率', () => {
    expect(effEloShift(4000, 6.5, P)).toBeCloseTo(effEloShift(3000, 6.5, P))
    expect(effEloShift(200, 6.5, P)).toBeCloseTo(effEloShift(1000, 6.5, P))
  })

  it('没有参数或输入不是数字时不修正', () => {
    expect(effEloShift(2000, 9, null)).toBe(0)
    expect(effectiveElo(2000, Number.NaN, P)).toBe(2000)
  })
})
