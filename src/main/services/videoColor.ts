// 视频色彩标记：从码流（VUI）里读出编码器实际写的色彩信息，转成 ffmpeg 的输出参数。纯函数，不依赖 Electron。
const PRIMARIES: Record<number, string> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020' }
const TRANSFERS: Record<number, string> = { 1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1', 14: 'bt2020-10', 16: 'smpte2084', 18: 'arib-std-b67' }
const MATRICES: Record<number, string> = { 0: 'gbr', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020nc' }

/** 从 trace_headers 的输出里解析码流的色彩信息，转成 ffmpeg 输出参数；读不到就返回空 */
export function parseVuiColor(trace: string): string[] {
  const num = (name: string): number | null => {
    const m = trace.match(new RegExp('\\b' + name + '\\s+\\S+\\s*=\\s*(\\d+)'))
    return m ? Number(m[1]) : null
  }
  if (num('colour_description_present_flag') !== 1) return []
  const out: string[] = []
  const p = PRIMARIES[num('colour_primaries') ?? -1]
  const t = TRANSFERS[num('transfer_characteristics') ?? -1]
  const m = MATRICES[num('matrix_coefficients') ?? -1]
  const full = num('video_full_range_flag')
  if (p) out.push('-color_primaries', p)
  if (t) out.push('-color_trc', t)
  if (m) out.push('-colorspace', m)
  if (full != null) out.push('-color_range', full ? 'pc' : 'tv')
  return out
}
