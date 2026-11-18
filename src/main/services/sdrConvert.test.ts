import { describe, expect, it } from 'vitest'
import { paperWhiteShader, sdrAttempts, type SdrJob } from './sdrConvert'

const job = (over: Partial<SdrJob> = {}): SdrJob => ({ file: 'a.mp4', height: 0, bitrateMbps: 8, encoder: 'h264_nvenc', vendorId: '10de', ...over })

describe('sdrAttempts', () => {
  it('N 卡先试 CUDA 管线，最后有纯 CPU 兜底', () => {
    expect(sdrAttempts(job(), 'in.mp4', 'out.mp4', 's.hook').map((a) => a.name)).toEqual(['cuda+vulkan', 'd3d11+vulkan', 'cpu'])
  })
  it('其他显卡不试 CUDA', () => {
    expect(sdrAttempts(job({ vendorId: '1002', encoder: 'h264_amf' }), 'in.mp4', 'out.mp4', 's.hook').map((a) => a.name)).toEqual(['d3d11+vulkan', 'cpu'])
  })
  it('输出标成 BT.709 有限范围，声音直接复制，不用 Vulkan 硬件解码', () => {
    for (const a of sdrAttempts(job(), 'in.mp4', 'out.mp4', 's.hook')) {
      const s = a.args.join(' ')
      expect(s).toContain('-colorspace bt709 -color_range tv')
      expect(s).toContain('-c:a copy')
      expect(s).not.toContain('-hwaccel vulkan')
      expect(a.args[a.args.length - 1]).toBe('out.mp4')
    }
  })
  it('设了分辨率就缩放，原生不缩放', () => {
    expect(sdrAttempts(job({ height: 1080 }), 'i', 'o', 's')[0].args.join(' ')).toContain('scale_cuda=-2:1080:')
    expect(sdrAttempts(job({ height: 0 }), 'i', 'o', 's')[0].args.join(' ')).toContain('scale_cuda=format=p010le')
  })
})

describe('paperWhiteShader', () => {
  it('按 203/纸白 缩放线性光', () => {
    expect(paperWhiteShader(300)).toContain('//!HOOK LINEAR')
    expect(paperWhiteShader(300)).toContain('*= 0.6767')
  })
})
