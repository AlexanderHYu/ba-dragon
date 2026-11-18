import { describe, expect, it } from 'vitest'
import { replayQualityOf } from './replayLocal'

describe('replayQualityOf', () => {
  it('0 是原生分辨率，不能被当成没设置', () => {
    expect(replayQualityOf(0)).toBe(0)
    expect(replayQualityOf('0')).toBe(0)
  })
  it('正常档位原样返回，没设置或乱填按 1080p', () => {
    expect(replayQualityOf(1440)).toBe(1440)
    expect(replayQualityOf(undefined)).toBe(1080)
    expect(replayQualityOf('')).toBe(1080)
    expect(replayQualityOf('abc')).toBe(1080)
  })
})
