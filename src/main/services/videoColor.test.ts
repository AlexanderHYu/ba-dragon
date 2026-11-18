import { describe, expect, it } from 'vitest'
import { parseVuiColor } from './videoColor'

// trace_headers 的真实输出片段（NVENC 录的 HDR10：码流里是 BT.601 矩阵、有限范围）
const HDR = [
  '[trace_headers @ 0] 243         video_signal_type_present_flag                              1 = 1',
  '[trace_headers @ 0] 247         video_full_range_flag                                       0 = 0',
  '[trace_headers @ 0] 248         colour_description_present_flag                             1 = 1',
  '[trace_headers @ 0] 249         colour_primaries                                     00001001 = 9',
  '[trace_headers @ 0] 257         transfer_characteristics                             00010000 = 16',
  '[trace_headers @ 0] 265         matrix_coefficients                                  00000101 = 5'
].join('\n')

describe('parseVuiColor', () => {
  it('按码流里的值生成封装层标记', () => {
    expect(parseVuiColor(HDR)).toEqual([
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt470bg', '-color_range', 'tv'
    ])
  })
  it('全范围标志为 1 时写 pc', () => {
    expect(parseVuiColor(HDR.replace('0 = 0', '1 = 1'))).toContain('pc')
  })
  it('码流里没有色彩描述就什么都不写', () => {
    expect(parseVuiColor(HDR.replace('colour_description_present_flag                             1 = 1', 'colour_description_present_flag                             0 = 0'))).toEqual([])
    expect(parseVuiColor('')).toEqual([])
  })
})
