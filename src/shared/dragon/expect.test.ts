import { describe, expect, it } from 'vitest'
import { MODEL } from './model'
import { teamWinExpect } from './score'

describe('赛前预期胜率', () => {
  it('两队平均 ELO 相同时是五五开', () => {
    expect(teamWinExpect([1500, 1700], [1600, 1600])).toBeCloseTo(0.5, 6)
  })

  it('平均 ELO 高一个尺度时是 10:1', () => {
    const s = MODEL.expect.scale
    expect(teamWinExpect([1500 + s], [1500])).toBeCloseTo(10 / 11, 6)
  })

  it('两边胜率加起来是 1', () => {
    const a = teamWinExpect([1874, 1712, 1620], [1801, 1655])
    const b = teamWinExpect([1801, 1655], [1874, 1712, 1620])
    expect((a as number) + (b as number)).toBeCloseTo(1, 9)
  })

  it('任一队没有 ELO 时不给结果', () => {
    expect(teamWinExpect([], [1500])).toBeNull()
    expect(teamWinExpect([1500], [])).toBeNull()
  })
})
