// ================= 对局录像：FFmpeg 采集 + 硬件编码 =================
// 画面：FFmpeg ddagrab（DXGI 桌面复制，帧留在显存）→ NVENC / AMF / QSV / x264 → 分片 MP4（中途崩溃也不丢已录部分）
// 声音：ddagrab 不带音频，另由 WASAPI 回环采集系统声音（services/audioLoopback.ts），实时编码为 AAC；
// 选了「桌面声音 + 麦克风」时再开一路麦克风，各写一个 AAC，合成时按各自的起点对齐后混成一轨
// 结束：两路按实测的起始时刻对齐，合成为带 faststart 索引的普通 MP4（任何播放器都能拖进度条）
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { screen } from 'electron'
import { release as osRelease } from 'node:os'
import { parseVuiColor } from './videoColor'
import type { Display } from 'electron'
import { colorInfoFor } from './displayColor'
import type { DisplayColorInfo } from './displayColor'
import { startLoopback } from './audioLoopback'
import type { LoopbackHandle } from './audioLoopback'

/** 三路都是管道的子进程（stdout 读进度、stderr 读报错、stdin 发 q） */
type PipedProc = ChildProcessByStdio<Writable, Readable, Readable>

interface FfmpegResult {
  code: number
  stdout: string
  stderr: string
}

// 打包后在 resources/ffmpeg/，开发时在 vendor/ffmpeg/（npm run fetch-ffmpeg 下载）
// __dirname 指向 out/main（打包后在 asar 内），上两级是项目根 / app 根
export function ffmpegPath(): string | null {
  const cands: string[] = []
  if (process.resourcesPath) cands.push(join(process.resourcesPath, 'ffmpeg', 'ffmpeg.exe'))
  cands.push(join(__dirname, '..', '..', 'vendor', 'ffmpeg', 'ffmpeg.exe'))
  return (
    cands.find((p) => {
      try {
        return existsSync(p)
      } catch {
        return false
      }
    }) || null
  )
}

/** 取 ffmpeg.exe，没有就抛错（调用方在 start() 里已经先检查过一次） */
function requireFfmpeg(): string {
  const bin = ffmpegPath()
  if (!bin) throw new Error('ffmpeg.exe 不存在')
  return bin
}

function runFfmpeg(args: string[], timeoutMs = 20000): Promise<FfmpegResult> {
  return new Promise((resolve) => {
    const bin = ffmpegPath()
    if (!bin) return resolve({ code: -1, stdout: '', stderr: 'ffmpeg.exe 不存在' })
    execFile(
      bin,
      ['-hide_banner', ...args],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || '')
        })
      }
    )
  })
}

// ---------------- 色彩标记：封装层对齐码流 ----------------
// 硬件编码器把 RGB 转 YUV 时用什么矩阵由它自己定（实测 NVENC 一律 BT.601、有限范围），码流（VUI）里如实写了，
// 但 MP4 封装层沿用的是我们给帧贴的标记（BT.709 / BT.2020），两边打架：Chromium 认码流，ffmpeg、B 站转码认封装层，就会解错颜色。
// 合成（只改封装、不重新编码）时读出码流里的值，照着写封装层。各家编码器实际用了什么都以码流为准，不用逐家猜。
async function bitstreamColorArgs(file: string): Promise<string[]> {
  const r = await runFfmpeg(['-i', file, '-c', 'copy', '-bsf:v', 'trace_headers', '-frames:v', '1', '-f', 'null', '-'], 20000)
  return parseVuiColor(r.stderr)
}

// ---------------- 显示器探测：DXGI 显卡/输出编号 ↔ 物理分辨率 ----------------
// ddagrab 只能按「第几块显卡的第几个输出」选屏，Electron 只知道显示器坐标与缩放。
// 这里逐个打开 DXGI 输出拿到物理分辨率，再按分辨率与 Electron 的显示器配对。
export interface DxgiOutput {
  /** 第几块显卡 */
  adapter: number
  /** 这块显卡的第几个输出 */
  output: number
  width: number
  height: number
  /** PCI 厂商 ID（10de=N 卡，1002=A 卡，8086=Intel） */
  vendorId: string
  gpu: string
}

let outputsCache: DxgiOutput[] | null = null

export async function probeOutputs(force?: boolean): Promise<DxgiOutput[]> {
  if (outputsCache && !force) return outputsCache
  const list: DxgiOutput[] = []
  for (let adapter = 0; adapter < 8; adapter++) {
    let deviceOk = true
    for (let output = 0; output < 8; output++) {
      const r = await runFfmpeg(
        ['-v', 'verbose', '-init_hw_device', 'd3d11va=dx:' + adapter, '-filter_hw_device', 'dx',
         '-filter_complex', 'ddagrab=output_idx=' + output + ':framerate=1', '-frames:v', '1', '-f', 'null', '-'],
        15000
      )
      if (/Device creation failed|Failed to create Direct3D device/i.test(r.stderr)) {
        deviceOk = false
        break
      }
      const m = r.stderr.match(/Opened dxgi output \d+ with dimensions (\d+)x(\d+)/)
      if (!m) break // 这块显卡没有更多输出了
      const dev = r.stderr.match(/Using device ([0-9a-f]{4}):[0-9a-f]{4} \(([^)]*)\)/i)
      list.push({
        adapter,
        output,
        width: Number(m[1]),
        height: Number(m[2]),
        vendorId: dev ? dev[1].toLowerCase() : '',
        gpu: dev ? dev[2] : ''
      })
    }
    if (!deviceOk) break
  }
  if (list.length) outputsCache = list
  return list
}

export function invalidateOutputs(): void {
  outputsCache = null
  wgcCache = null
}

function electronDisplays(): Display[] {
  try {
    return screen.getAllDisplays()
  } catch {
    return []
  }
}

function physicalSize(d: Display): { width: number; height: number } {
  const s = d.scaleFactor || 1
  return { width: Math.round(d.bounds.width * s), height: Math.round(d.bounds.height * s) }
}

/** 显示器是否处于 HDR（Windows 开 HDR 后 Chromium 报告的传输特性不再是 sRGB） */
export function isHdrDisplay(d: Display | null | undefined): boolean {
  const cs = String(d?.colorSpace || '')
  return /transfer:(PQ|HLG|LINEAR|SCRGB)/i.test(cs) || (d?.depthPerComponent || 8) > 8
}

/** 选出要录的显示器：设置里指定的 → 鼠标所在的 → 主屏 */
function pickDisplay(displayId: string | number): Display | null {
  const all = electronDisplays()
  if (!all.length) return null
  if (displayId) {
    const hit = all.find((d) => String(d.id) === String(displayId))
    if (hit) return hit
  }
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    /* 没有屏幕信息时退回主屏 */
  }
  try {
    return screen.getPrimaryDisplay()
  } catch {
    /* 再不行就用列表第一个 */
  }
  return all[0]
}

/** Electron 显示器 → DXGI 输出：按物理分辨率最接近的配对（缩放换算会有 1~2px 取整误差） */
export function matchOutput(display: Display | null, outputs: DxgiOutput[] | null): DxgiOutput | null {
  if (!outputs || !outputs.length) return null
  if (!display) return outputs[0]
  const p = physicalSize(display)
  let best = outputs[0]
  let bd = Infinity
  for (const o of outputs) {
    const d = Math.abs(o.width - p.width) + Math.abs(o.height - p.height)
    if (d < bd) {
      bd = d
      best = o
    }
  }
  return best
}

// ---------------- 编码器探测 ----------------
export type EncoderName = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264'
const ENCODERS: EncoderName[] = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264']
const ENCODER_VENDOR: Partial<Record<EncoderName, string>> = {
  h264_nvenc: '10de',
  h264_amf: '1002',
  h264_qsv: '8086'
}
const ENCODER_LABEL: Record<EncoderName, string> = {
  h264_nvenc: 'NVENC',
  h264_amf: 'AMF',
  h264_qsv: 'QuickSync',
  libx264: 'x264'
}
let encodersCache: EncoderName[] | null = null

export async function probeEncoders(force?: boolean): Promise<EncoderName[]> {
  if (encodersCache && !force) return encodersCache
  const ok: EncoderName[] = []
  for (const enc of ENCODERS) {
    const r = await runFfmpeg(
      ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=0.2', '-c:v', enc, '-f', 'null', '-'],
      15000
    )
    if (r.code === 0) ok.push(enc)
  }
  encodersCache = ok
  return ok
}

function encoderArgs(enc: EncoderName, bitrateMbps: number, fps: number): string[] {
  const b = bitrateMbps + 'M'
  const max = Math.round(bitrateMbps * 1.5) + 'M'
  const buf = Math.round(bitrateMbps * 2) + 'M'
  const g = String(fps * 2) // 2 秒一个关键帧：决定拖动精度与分片粒度
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g]
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g]
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g]
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', g]
  }
}

// ---------------- Windows 图形捕获（Windows Graphics Capture，WGC） ----------------
// 开着 HDR 时默认用它：8 位输出由 Windows 在显卡上按「SDR 内容亮度」实时把 HDR 转成 SDR（和普通 SDR 程序在 HDR 屏上的显示方式一样），
// 画面一直留在显存里交给硬件编码器，采集时还能在显卡上缩放。实测 4K HDR + RTX 5090：录制进程约 6% 单核（旧方式约 54%）。
// 为什么不用桌面复制（ddagrab）的 8/10 位：实测 HDR 屏上 Windows 给的是按 80 尼特截断的 SDR（桌面白 256 尼特就全成了纯白）。
// 2.0.2/2.0.3 误把 10 位当成 HDR10 录，颜色和亮度全错。桌面复制的 16 位浮点是真 HDR，但只能读回内存处理，吃 CPU（旧方式）。
// 比 SDR 白更亮的高光会截成纯白（SDR 屏本来也显示不了）。Windows 10 上采集时屏幕边缘可能出现黄框（去掉要 Windows 11）。
export type CaptureMethod = 'auto' | 'wgc' | 'dxgi'

/** Windows 11（build 22000 起）：WGC 可以不显示黄框 */
export const IS_WIN11 = Number(osRelease().split('.')[2] || 0) >= 22000

export interface WgcMonitor {
  /** gfxcapture 的 monitor_idx */
  idx: number
  width: number
  height: number
}
let wgcCache: WgcMonitor[] | null = null

/** 列出 WGC 能采的显示器（分辨率从输出流信息里读）。WGC 开始采集时会先给一帧，屏幕静止也不会卡住 */
export async function probeWgcMonitors(force?: boolean): Promise<WgcMonitor[]> {
  if (wgcCache && !force) return wgcCache
  const list: WgcMonitor[] = []
  for (let idx = 0; idx < 8; idx++) {
    const r = await runFfmpeg(
      ['-init_hw_device', 'd3d11va=dx', '-filter_hw_device', 'dx',
       '-filter_complex', 'gfxcapture=monitor_idx=' + idx + ':max_framerate=5:capture_cursor=0', '-frames:v', '1', '-f', 'null', '-'],
      15000
    )
    const m = r.stderr.match(/Video: wrapped_avframe, d3d11[^\n]*?, (\d+)x(\d+)/)
    if (!m) break
    list.push({ idx, width: Number(m[1]), height: Number(m[2]) })
  }
  wgcCache = list
  return list
}

/** DXGI 输出 → WGC 显示器序号：按分辨率配对，同分辨率的几块屏按出现顺序对应 */
export function matchWgc(out: DxgiOutput, outputs: DxgiOutput[], monitors: WgcMonitor[]): number | null {
  const same = (o: { width: number; height: number }): boolean => o.width === out.width && o.height === out.height
  const k = Math.max(0, outputs.filter(same).indexOf(out))
  const hit = monitors.filter(same)[k]
  return hit ? hit.idx : null
}

function wgcGrab(idx: number, fps: number, size: TargetSize): string {
  return (
    'gfxcapture=monitor_idx=' + idx + ':max_framerate=' + fps + ':output_fmt=8bit' +
    (size.native ? '' : ':width=' + size.width + ':height=' + size.height + ':resize_mode=scale_aspect:scale_mode=bicubic')
  )
}

// ---------------- HDR → SDR ----------------
// Windows 开 HDR 后桌面按 scRGB 合成（1.0 = 80 尼特，SDR 白 = 「SDR 内容亮度」/80）。
// 8 位采集会把 80 尼特以上全部截成纯白 —— 这就是旧版录像「回回过曝」的原因。
// 这里改用 FP16 采集，交给 libplacebo（Vulkan）跑下面的着色器：先除以 SDR 白让它回到 1.0，
// 再把更亮的 HDR 高光平滑压进 1.0 以内（按最大通道等比缩放，色相不变），最后按 BT.709 输出。
// 注意 swscale 会把浮点截到 [0,1]，所以 FP16 帧在进 libplacebo 之前不能经过任何格式转换。
const HDR_KNEE = 0.8 // SDR 白的 80% 以下原样保留

function tonemapShader(sdrWhite: number): string {
  return [
    '//!HOOK MAIN',
    '//!BIND HOOKED',
    '//!DESC scRGB HDR -> SDR',
    'vec4 hook() {',
    '    vec4 c = HOOKED_tex(HOOKED_pos);',
    '    vec3 x = max(c.rgb, 0.0) / ' + sdrWhite.toFixed(4) + ';',
    '    const float k = ' + HDR_KNEE.toFixed(2) + ';',
    '    float m = max(max(x.r, x.g), x.b);',
    '    if (m > k) {',
    '        float y = k + (1.0 - k) * (1.0 - exp(-(m - k) / (1.0 - k)));',
    '        x *= y / m;',
    '    }',
    '    return vec4(x, c.a);',
    '}',
    ''
  ].join('\n')
}

// ffmpeg 以会话目录为工作目录启动，只传文件名，避免盘符冒号与滤镜语法冲突
const TONEMAP_FILE = 'tonemap.hook'

// ---------------- 曝光补偿 ----------------
// 单位 EV（每 +1 亮度翻倍），范围 ±2、步长 0.25，与设置页一致。
// HDR 链路：折算进着色器的除数（sdrWhite / 2^EV），在色调映射之前生效，高光仍会被平滑压缩；
// 8 位链路：在线性光下乘 2^EV（按 2.2 伽马近似），提亮时高光会被截断（8 位采集本身已没有更亮的信息）
export function normExposure(ev: unknown): number {
  const n = Number(ev)
  return Number.isFinite(n) ? Math.max(-2, Math.min(2, Math.round(n * 4) / 4)) : 0
}

function exposureGain(ev: unknown): number {
  return Math.pow(2, normExposure(ev))
}

function sdrExposureFilter(ev: unknown): string {
  if (!normExposure(ev)) return ''
  const e = "'clip(255*pow(pow(val/255,2.2)*" + exposureGain(ev).toFixed(4) + ",1/2.2),0,255)'"
  return ',lutrgb=r=' + e + ':g=' + e + ':b=' + e
}

/** 选定要录的屏的结果 */
interface Target {
  display: Display | null
  out: DxgiOutput
  color: DisplayColorInfo | null
  /** 能不能走 libplacebo 的 HDR→SDR 旧链路（系统开了 HDR，且屏在默认显卡上） */
  hdr: boolean
  /** 系统对这块屏开了 HDR（HDR 全显卡链路不受「默认显卡」的限制） */
  systemHdr: boolean
  /** SDR 白相对 80 尼特的倍数 */
  sdrWhite: number
}

// 选定要录的屏：显示器 → DXGI 输出 → 是否走 HDR 链路（录制与预览共用）
// HDR 状态直接问系统：Chromium 的显示器色彩信息是异步更新的，刚启动时常报成 sRGB，不可靠；
// 系统还能区分真 HDR 与 Win11 的自动颜色管理（仍是 SDR），并给出 SDR 白
async function resolveTarget(displayId: string | number, log?: (m: string) => void): Promise<Target> {
  const display = pickDisplay(displayId)
  const [outputs, color] = await Promise.all([
    probeOutputs(),
    colorInfoFor(display && display.label).catch(() => null)
  ])
  if (!outputs.length) throw new Error('没有找到可采集的显示器输出（DXGI）')
  const out = matchOutput(display, outputs)
  if (!out) throw new Error('没有找到可采集的显示器输出（DXGI）')
  // HDR 链路里 ddagrab 不能绑定指定显卡（滤镜全局设备要留给 libplacebo 自建 Vulkan），只能录默认显卡（adapter 0）上的屏
  const systemHdr = !!(color && color.hdr)
  const hdr = systemHdr && out.adapter === 0
  // 「HDR 屏不在默认显卡上」要等知道全显卡链路能不能用之后再说，放在录制开始时记
  void log
  const sdrWhite = hdr && color ? Math.max(1, (color.sdrWhiteNits || 80) / 80) : 1
  return { display, out, color, hdr, systemHdr, sdrWhite }
}

// ---------------- 录制效果预览 ----------------
export interface PreviewCapture {
  /** 存放 frame.raw 的临时目录 */
  dir: string
  /** frame.raw 的像素格式 */
  pixFmt: string
  width: number
  height: number
  hdr: boolean
  sdrWhite: number
  sdrWhiteNits: number | null
  label: string
}

// 截一帧原始画面存成 raw 文件（HDR 屏为 16 位浮点），之后调曝光只需用它重新渲染，不必每次重新截屏
export async function capturePreview(displayId: string | number, dir: string): Promise<PreviewCapture> {
  const t = await resolveTarget(displayId)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const { out } = t
  const pixFmt = t.hdr ? 'rgbaf16le' : 'bgra'
  const grab = t.hdr
    ? ['-filter_complex', 'ddagrab=output_idx=' + out.output + ':output_fmt=rgbaf16:framerate=5,hwdownload,format=rgbaf16le']
    : ['-init_hw_device', 'd3d11va=dx:' + out.adapter, '-filter_hw_device', 'dx',
       '-filter_complex', 'ddagrab=output_idx=' + out.output + ':framerate=5,hwdownload,format=bgra']
  const r = await runFfmpeg(['-v', 'error', ...grab, '-frames:v', '1', '-f', 'rawvideo', '-y', join(dir, 'frame.raw')], 30000)
  if (r.code !== 0) throw new Error('截屏失败: ' + r.stderr.trim().split(/\r?\n/).pop())
  return {
    dir,
    pixFmt,
    width: out.width,
    height: out.height,
    hdr: t.hdr,
    sdrWhite: t.sdrWhite,
    sdrWhiteNits: t.color ? t.color.sdrWhiteNits : null,
    label: (t.display && t.display.label) || ''
  }
}

/** 用截好的原始画面按指定曝光渲染预览图（与录制完全相同的色彩处理），返回 JPEG dataURL */
export async function renderPreview(cap: PreviewCapture, ev: unknown): Promise<string> {
  const pw = 1280
  const ph = Math.round((cap.height * pw) / cap.width / 2) * 2
  const input = ['-f', 'rawvideo', '-pix_fmt', cap.pixFmt, '-s', cap.width + 'x' + cap.height, '-i', 'frame.raw']
  let vf: string
  if (cap.hdr) {
    writeFileSync(join(cap.dir, TONEMAP_FILE), tonemapShader(cap.sdrWhite / exposureGain(ev)))
    vf =
      'setparams=color_primaries=bt709:color_trc=linear:colorspace=gbr,libplacebo=w=' +
      pw +
      ':h=' +
      ph +
      ':format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:tonemapping=clip:peak_detect=0:custom_shader_path=' +
      TONEMAP_FILE
  } else {
    vf = 'null' + sdrExposureFilter(ev) + ',scale=' + pw + ':' + ph + ':flags=bicubic'
  }
  const file = 'preview.jpg'
  const bin = requireFfmpeg()
  const r = await new Promise<{ ok: boolean; stderr: string }>((resolve) => {
    execFile(
      bin,
      ['-hide_banner', '-v', 'error', ...input, '-vf', vf, '-frames:v', '1', '-q:v', '3', '-y', file],
      { cwd: cap.dir, windowsHide: true, timeout: 30000 },
      (err, _so, se) => resolve({ ok: !err, stderr: String(se || '') })
    )
  })
  if (!r.ok) throw new Error('渲染预览失败: ' + r.stderr.trim().split(/\r?\n/).pop())
  return 'data:image/jpeg;base64,' + readFileSync(join(cap.dir, file)).toString('base64')
}

export interface TargetSize {
  width: number
  height: number
  /** 是否原生分辨率（不缩放） */
  native: boolean
}

/** 目标尺寸：quality=0 表示原生；否则按目标高度等比缩放（取偶数） */
export function targetSize(quality: number, srcW: number, srcH: number): TargetSize {
  const q = Number(quality) || 0
  if (!q || q >= srcH) return { width: srcW, height: srcH, native: true }
  return { width: Math.round((srcW * q) / srcH / 2) * 2, height: q, native: false }
}

export interface FilterOptions {
  /** DXGI 输出序号 */
  output: number
  fps: number
  size: TargetSize
  gpuDirect: boolean
  hdr: boolean
  /** Windows 图形捕获：有值时用它采集（idx 为显示器序号；direct = 编码器直接吃显存里的画面） */
  wgc?: { idx: number; direct: boolean } | null
  ev: number
  /** 本段时间戳的零点（系统时间，毫秒） */
  t0: number
  /** 第一帧时间戳输出到的文件名（相对会话目录） */
  firstFile: string
}

// 滤镜图：[v] 进编码器，[pv] 每秒一张 320 宽的预览图
// gpuDirect：编码器与采集在同一块显卡上且不缩放 → 帧全程留在显存（实测 4K 总 CPU 占用约 0.3%）
// 否则读回内存用 CPU 缩放（实测 4K→1080p 约占一个核的 80%）
// hdr：FP16 采集 → libplacebo 色调映射 + 缩放（实测 4K→1080p 稳定 30fps，约占一个核的 90%）
// 时间戳：ddagrab 在管线卡顿（如 HDR 链路启动时初始化 Vulkan）后不会按真实时间补齐，时间轴会比真实时间短，
// 声音就对不上（实测差 1.1 秒）。紧跟一个 setpts 把每帧时间戳改成「采集时的系统时钟 - T0」：
// 时间轴与真实时间严格一致，第一帧的真实时刻 = T0 + 它在这里的时间戳（不依赖停止时机：ffmpeg 收到 q 后还会多录约 1 秒）。
// 但 ffmpeg 会把输出时间轴平移，成品里第一帧从 0 开始，绝对时刻就丢了；所以在进编码器之前另分一路只取第一帧，
// 把它的时间戳打印到 firstFile，合成时据此算出成品时间轴零点对应的系统时刻。
// 必须在管线末端取：管线预热时会丢掉开头若干帧（实测 8 位链路约 0.16 秒，HDR 链路约 0.63 秒），
// 在采集处取到的「第一帧」根本没进文件，据此对齐声音会偏晚同样的时长。
function wallclockPts(t0ms: number): string {
  return 'setpts=(RTCTIME-' + Math.round(t0ms * 1000) + ')/(TB*1000000)'
}

function firstFrameTap(firstFile: string): string {
  return (
    ',split=2[v][ff];[ff]trim=end_frame=1,metadata=mode=add:key=ba_first:value=1,metadata=mode=print:file=' +
    firstFile +
    ',nullsink'
  )
}

export function buildFilter({ output, fps, size, gpuDirect, hdr, wgc, ev, t0, firstFile }: FilterOptions): string {
  const pts = wallclockPts(t0)
  const tap = firstFrameTap(firstFile)
  if (wgc) {
    const grab = wgcGrab(wgc.idx, fps, size)
    const tag709 = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'
    if (wgc.direct) {
      // N 卡、A 卡：编码器直接吃显存里的 BGRA（缩放已经在采集时由显卡做了）
      return grab + ',' + pts + ',split=2[a][p0];[p0]fps=1,hwdownload,format=bgra,scale=320:-2[pv];[a]' + tag709 + tap
    }
    // QuickSync / CPU 编码：读回内存再转 YUV（画面已经在显卡上缩好，读回的数据量按目标分辨率算）
    return (
      grab + ',hwdownload,format=bgra,' + pts + ',split=2[a][b];[b]fps=1,scale=320:-2[pv];[a]' +
      'scale=out_color_matrix=bt709:out_range=tv,format=nv12,' + tag709 + tap
    )
  }
  if (hdr) {
    return (
      'ddagrab=output_idx=' +
      output +
      ':output_fmt=rgbaf16:framerate=' +
      fps +
      ',hwdownload,format=rgbaf16le,' +
      pts +
      ',setparams=color_primaries=bt709:color_trc=linear:colorspace=gbr' +
      ',libplacebo=w=' +
      size.width +
      ':h=' +
      size.height +
      ':format=yuv420p:colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv' +
      ':tonemapping=clip:peak_detect=0:custom_shader_path=' +
      TONEMAP_FILE +
      ',split=2[v0][p0];[p0]fps=1,scale=320:-2[pv];[v0]null' +
      tap
    )
  }
  const grab = 'ddagrab=output_idx=' + output + ':framerate=' + fps
  const toBt709 = 'out_color_matrix=bt709:out_range=tv'
  // 采集帧自带 sRGB 标记，编码器会沿用它；显式改成与转换矩阵一致的 BT.709
  const tag = 'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv'
  if (gpuDirect) {
    return (
      grab + ',' + pts + ',split=2[a][p0];[p0]fps=1,hwdownload,format=bgra,scale=320:-2[pv];[a]' + tag + tap
    )
  }
  const scale = size.native
    ? 'scale=' + toBt709
    : 'scale=' + size.width + ':' + size.height + ':flags=bicubic:' + toBt709
  return (
    grab +
    ',hwdownload,format=bgra' +
    sdrExposureFilter(ev) +
    ',' +
    pts +
    ',split=2[a][b];[b]fps=1,scale=320:-2[pv];[a]' +
    scale +
    ',format=nv12,' +
    tag +
    tap
  )
}

// ---------------- 录制会话 ----------------
const MAX_RESTARTS = 5

/** 一段录制分片：t0 为该段时间戳的零点（系统时间，毫秒） */
interface Segment {
  file: string
  firstFile: string
  seconds: number
  t0: number
}

/** 本次录制定下来的方案 */
interface Plan {
  output: DxgiOutput
  size: TargetSize
  encoder: EncoderName
  gpuDirect: boolean
  hdr: boolean
  /** Windows 图形捕获（有值时按它录；gpuDirect/hdr 留着，退回桌面复制时用） */
  wgc: { idx: number; direct: boolean } | null
  ev: number
}

export interface SessionOptions {
  fid?: string | number | null
  map?: string
  displayId: string | number
  /** 目标高度，0 = 原生 */
  quality: number
  fps: number
  bitrateMbps: number
  exposure: number
  /** off = 不录声音，default = 桌面声音，mic = 桌面声音 + 麦克风 */
  audio: 'off' | 'default' | 'mic'
  saveDir: string
  /** 采集方式：auto = HDR 屏或（Windows 11 上）需要缩放时用 WGC，其余用桌面复制 */
  method?: CaptureMethod
}

/** 合成结果 */
export type MuxResult =
  | { ok: true; file: string; durationSec: number; hasAudio: boolean; segments: number }
  | { ok: false; error: string }

/** 录制结束回调拿到的东西：合成结果 + 对局信息 + 临时目录（外层保存后自行清理） */
export type FinishedResult = MuxResult & { fid: string; map: string; dir: string }

export interface RecorderStatus {
  active: boolean
  current: CurrentRecording | null
}

export interface CurrentRecording {
  fid: string
  map: string
  startedAt: number
  /** 人类可读的采集方案描述（显示器 · 分辨率 · 编码器 …） */
  sourceId: string
}

export interface ProgressEvent {
  fid: string
  seconds: number
}

export interface PreviewEvent {
  dataUrl: string
  hasAudio: boolean
}

class Session {
  readonly rec: FfmpegRecorder
  readonly opts: SessionOptions
  fid: string
  map: string
  readonly startedAt: number
  readonly dir: string
  readonly previewFile: string
  readonly audioFile: string
  readonly micFile: string
  /** { file, seconds, t0 }：t0 为该段时间戳的零点（系统时间，毫秒） */
  segments: Segment[] = []
  proc: PipedProc | null = null
  stopping = false
  aborted = false
  restarts = 0
  /** 声音第 0 秒对应的系统时间 */
  audioStartWall = 0
  /** 声音采集句柄（startLoopback 返回） */
  audio: LoopbackHandle | null = null
  /** 麦克风：第 0 秒对应的系统时间、采集句柄 */
  micStartWall = 0
  mic: LoopbackHandle | null = null
  hasMic = false
  private procExit: (() => void) | null = null
  hasAudio = false
  hdr = false
  label = ''
  private plan!: Plan

  constructor(rec: FfmpegRecorder, opts: SessionOptions) {
    this.rec = rec
    this.opts = opts
    this.fid = opts.fid != null ? String(opts.fid) : ''
    this.map = opts.map || ''
    this.startedAt = Date.now()
    this.dir = join(opts.saveDir, '.rec-' + this.startedAt + '-' + (this.fid || 'nofid'))
    this.previewFile = join(this.dir, 'preview.jpg')
    this.audioFile = join(this.dir, 'audio.aac')
    this.micFile = join(this.dir, 'mic.aac')
  }

  log(m: string): void {
    this.rec._log(m)
  }

  async begin(): Promise<void> {
    mkdirSync(this.dir, { recursive: true })
    const [target, encoders] = await Promise.all([
      resolveTarget(this.opts.displayId, (m) => this.log(m)),
      probeEncoders()
    ])
    if (!encoders.length) throw new Error('没有可用的视频编码器')
    // 首次探测编码器要十几秒，这期间对局可能已经结束（stop 会清掉临时目录）：
    // 这时候再往下走就会往不存在的目录里写文件，直接收手
    if (this.stopping || this.aborted) {
      this.log('编码器探测完成前对局已结束，本局不录制')
      return
    }
    const { display, out, color, hdr, systemHdr, sdrWhite } = target
    const size = targetSize(this.opts.quality, out.width, out.height)
    const ev = normExposure(this.opts.exposure)
    // 优先用与采集同一块显卡的硬件编码器；否则按探测顺序取第一个可用的
    const sameGpu = encoders.find((e) => ENCODER_VENDOR[e] && ENCODER_VENDOR[e] === out.vendorId)
    const encoder = sameGpu || encoders[0]
    // 采集方式：HDR 屏用 WGC（Windows 实时转 SDR）；Windows 11 上需要缩放时也用它（缩放在显卡上做）；其余桌面复制
    const method = this.opts.method || 'auto'
    const wantWgc = method === 'wgc' || (method === 'auto' && (systemHdr || (!size.native && IS_WIN11)))
    let wgc: Plan['wgc'] = null
    if (wantWgc) {
      const idx = matchWgc(out, await probeOutputs(), await probeWgcMonitors())
      if (idx == null) this.log('Windows 图形捕获不可用（没找到对应的显示器），改用桌面复制')
      else wgc = { idx, direct: !!sameGpu && encoder !== 'h264_qsv' }
      if (this.stopping || this.aborted) return
    }
    if (systemHdr && !wgc && !hdr) this.log('HDR 屏不在默认显卡上，退回 8 位采集（高亮部分会过曝）')
    if (hdr) writeFileSync(join(this.dir, TONEMAP_FILE), tonemapShader(sdrWhite / exposureGain(ev)))
    // QSV 需要额外的设备映射、曝光补偿要在 CPU 上做，这两种情况统一走读回内存的路径
    const gpuDirect = !hdr && !!sameGpu && size.native && encoder !== 'h264_qsv' && ev === 0
    this.hdr = hdr && !wgc
    this.plan = { output: out, size, encoder, gpuDirect, hdr, wgc, ev }
    const screenLabel = (display && display.label) || 'Display ' + out.output
    this.label = wgc
      ? screenLabel + ' · ' + size.width + 'x' + size.height + ' · ' + ENCODER_LABEL[encoder] + ' · Windows 图形捕获' +
        (systemHdr ? ' · HDR→SDR' : '') + (wgc.direct ? ' (GPU)' : '')
      : screenLabel + ' · ' + size.width + 'x' + size.height + ' · ' + ENCODER_LABEL[encoder] +
        (hdr ? ' · HDR→SDR' : '') + (ev ? ' · ' + (ev > 0 ? '+' : '') + ev + 'EV' : '') + (gpuDirect ? ' (GPU)' : '')
    this.log(
      'plan: adapter=' + out.adapter + ' output=' + out.output + ' (' + out.width + 'x' + out.height + ', ' + out.gpu + ')' +
        (wgc
          ? ' -> ' + size.width + 'x' + size.height + ' ' + encoder + ' wgc' + (wgc.direct ? 'Direct' : 'Download') + ' monitor=' + wgc.idx +
            (ev ? '（曝光补偿在这条链路上不生效）' : '')
          : ' -> ' + size.width + 'x' + size.height + ' ' + encoder + (hdr ? ' hdrTonemap' : gpuDirect ? ' gpuDirect' : ' cpuScale') + ' ev=' + ev) +
        ' | ' + ((display && display.label) || '?') + ' ' + ((display && display.colorSpace) || '') +
        (color ? ' | 系统: hdr=' + color.hdr + ' acm=' + color.acm + ' sdrWhite=' + color.sdrWhiteNits + 'nit' : '')
    )
    this.spawnSegment()
    if (this.opts.audio !== 'off') await this.startAudio()
  }

  private spawnSegment(): void {
    const { output, size, encoder, gpuDirect, hdr, wgc, ev } = this.plan
    const fps = this.opts.fps
    const n = this.segments.length + 1
    const seg: Segment = {
      file: join(this.dir, 'seg-' + n + '.mp4'),
      firstFile: 'first-' + n + '.txt',
      seconds: 0,
      t0: Date.now()
    }
    this.segments.push(seg)
    const args = [
      '-hide_banner', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1', '-stats_period', '0.5',
      ...(hdr && !wgc ? [] : ['-init_hw_device', 'd3d11va=dx:' + output.adapter, '-filter_hw_device', 'dx']),
      '-filter_complex',
      buildFilter({ output: output.output, fps, size, gpuDirect, hdr, wgc, ev, t0: seg.t0, firstFile: seg.firstFile }),
      // 编码时间基用 1/90000：默认的 1/帧率 会把卡顿后快速补上的帧取整到同一刻，挤掉或推迟，时间轴随之变形（实测开头差 0.16 秒）
      '-map', '[v]', '-enc_time_base', '1/90000', ...encoderArgs(encoder, this.opts.bitrateMbps, fps),
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
      '-movflags', '+frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-y', seg.file,
      '-map', '[pv]', '-f', 'image2', '-update', '1', '-atomic_writing', '1', '-q:v', '6', '-y', this.previewFile
    ]
    const proc = spawn(requireFfmpeg(), args, { cwd: this.dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc = proc
    let buf = ''
    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        const m = line.match(/^out_time_us=(\d+)/)
        if (!m) continue
        const sec = Number(m[1]) / 1e6
        if (sec <= 0) continue
        seg.seconds = sec
        this.rec._progress(this)
      }
    })
    let errTail = ''
    proc.stderr.on('data', (d: Buffer) => {
      errTail = (errTail + d.toString()).slice(-2000)
    })
    proc.on('error', (e) => this.log('ffmpeg 启动失败: ' + e.message))
    proc.on('close', (code) => {
      if (this.proc === proc) this.proc = null
      if (errTail.trim()) {
        this.log('ffmpeg 第' + this.segments.length + '段 exit=' + code + ': ' + errTail.trim().split(/\r?\n/).slice(-4).join(' | '))
      }
      if (this.stopping || this.aborted) {
        if (this.procExit) this.procExit()
        return
      }
      // Windows 图形捕获第一段一帧都没出：退回桌面复制立即重来（只在第一段退：后面的段换了采集方式，分辨率可能对不上）
      if (this.plan.wgc && !seg.seconds && this.segments.length === 1) {
        this.log('Windows 图形捕获启动失败，改用桌面复制' + (this.plan.hdr ? '（HDR 屏用旧方式，CPU 占用较高）' : ''))
        wgcCache = []
        this.plan = { ...this.plan, wgc: null }
        this.hdr = this.plan.hdr
        this.label = this.label.replace(' · Windows 图形捕获', '')
        this.segments.pop()
        this.spawnSegment()
        return
      }
      // HDR 链路一帧都没出就退出（多半是没有 Vulkan）：退回 8 位采集立即重来，不计入重试次数
      if (this.plan.hdr && !this.plan.wgc && !seg.seconds) {
        this.log('HDR 色调映射链路启动失败，退回 8 位采集（高亮部分会过曝）')
        this.plan = { ...this.plan, hdr: false }
        this.hdr = false
        this.label = this.label.replace(' · HDR→SDR', '')
        this.segments.pop()
        this.spawnSegment()
        return
      }
      // 意外退出（切分辨率 / 独占全屏切换 / UAC 弹窗都会让桌面复制失效）：新开一段继续录
      if (this.restarts < MAX_RESTARTS) {
        this.restarts++
        this.log('ffmpeg 意外退出，1 秒后续录第 ' + (this.segments.length + 1) + ' 段')
        setTimeout(() => {
          if (!this.stopping && !this.aborted) this.spawnSegment()
        }, 1000)
      } else {
        this.rec._error('录制进程多次异常退出，本局后续画面不再录制')
      }
    })
  }

  private async startAudio(): Promise<void> {
    // 两路同时开：各自独立，一路失败不影响另一路
    await Promise.all([
      (async () => {
        try {
          const a = await startLoopback(this.audioFile, requireFfmpeg(), (m) => this.log(m))
          if (this.stopping || this.aborted) return a.kill()
          this.audio = a
          this.audioStartWall = a.startWall
          this.hasAudio = true
        } catch (e) {
          this.log('声音采集失败，本局不录桌面声音: ' + (e instanceof Error ? e.message : String(e)))
        }
      })(),
      this.opts.audio === 'mic'
        ? (async () => {
            try {
              const m = await startLoopback(this.micFile, requireFfmpeg(), (x) => this.log(x), 'mic')
              if (this.stopping || this.aborted) return m.kill()
              this.mic = m
              this.micStartWall = m.startWall
              this.hasMic = true
            } catch (e) {
              this.log('麦克风采集失败，本局不录麦克风: ' + (e instanceof Error ? e.message : String(e)))
            }
          })()
        : null
    ])
  }

  /** 正常结束：ffmpeg 收到 q 会写完尾部再退出；声音采集同时停止并写完 AAC */
  async finish(): Promise<MuxResult> {
    this.stopping = true
    const procDone = this.proc
      ? new Promise<void>((r) => {
          this.procExit = r
        })
      : Promise.resolve()
    if (this.proc) {
      try {
        this.proc.stdin.write('q')
      } catch {
        /* 进程已经没了 */
      }
    }
    const killer = setTimeout(() => {
      if (this.proc) {
        this.log('ffmpeg 15 秒内未退出，强制结束')
        try {
          this.proc.kill()
        } catch {
          /* 已经退出了 */
        }
      }
    }, 15000)
    await Promise.all([procDone, this.audio ? this.audio.stop() : null, this.mic ? this.mic.stop() : null])
    clearTimeout(killer)
    return this.mux()
  }

  abort(): void {
    this.aborted = true
    if (this.proc) {
      try {
        this.proc.kill()
      } catch {
        /* 已经退出了 */
      }
    }
    if (this.audio) this.audio.kill()
    if (this.mic) this.mic.kill()
    setTimeout(() => this.cleanup(), 1500)
  }

  cleanup(): void {
    try {
      rmSync(this.dir, { recursive: true, force: true })
    } catch {
      /* 目录还被占用：留着下次清理 */
    }
  }

  private async mux(): Promise<MuxResult> {
    const segs = this.segments.filter((s) => {
      try {
        return statSync(s.file).size > 1024
      } catch {
        return false
      }
    })
    if (!segs.length) {
      this.cleanup()
      return { ok: false, error: '没有录到画面（ffmpeg 未产出数据）' }
    }
    const durationSec = Math.round(segs.reduce((a, s) => a + (s.seconds || 0), 0))
    const out = join(this.dir, 'final.mp4')
    const vIn: string[] = []
    if (segs.length === 1) {
      vIn.push('-i', segs[0].file)
    } else {
      const list = join(this.dir, 'concat.txt')
      const quote = (p: string): string => "'" + p.replace(/\\/g, '/').split("'").join("'\\''") + "'"
      writeFileSync(list, segs.map((s) => 'file ' + quote(s.file)).join('\n'))
      vIn.push('-f', 'concat', '-safe', '0', '-i', list)
    }
    const nonEmpty = (f: string): boolean => {
      try {
        return statSync(f).size > 1024
      } catch {
        return false // 没有这个音频文件
      }
    }
    const sysOk = this.hasAudio && nonEmpty(this.audioFile)
    const micOk = this.hasMic && nonEmpty(this.micFile)
    const audioOk = sysOk || micOk
    // 成品时间轴零点 = 第一段第一帧的采集时刻（T0 + 它在滤镜里的时间戳）：合成时 ffmpeg 会把视频平移到第一帧从 0 开始，
    // 播放器也按这个时间轴播放（分段文件里第一帧落在 B 帧延迟处，那个偏移在合成时就被去掉了，不能再减一次）
    let zeroWall = 0
    let capturePts = 0
    if (audioOk) {
      try {
        const m = readFileSync(join(this.dir, segs[0].firstFile), 'utf8').match(/pts_time:(-?[\d.]+)/)
        capturePts = m ? Number(m[1]) : 0
      } catch {
        /* 没取到第一帧时间戳：按 0 处理 */
      }
      zeroWall = segs[0].t0 + capturePts * 1000
    }
    // 声音比画面晚开始 → 往后推；早开始 → 裁掉多出的开头
    // 以第一段对齐；中途续录的分段之间有 1~2 秒空档，之后的声音会相应偏早
    const offsetOf = (startWall: number): number => (startWall && zeroWall ? (startWall - zeroWall) / 1000 : 0)
    const tracks = [
      ...(sysOk ? [{ name: '声音', file: this.audioFile, offset: offsetOf(this.audioStartWall), wall: this.audioStartWall }] : []),
      ...(micOk ? [{ name: '麦克风', file: this.micFile, offset: offsetOf(this.micStartWall), wall: this.micStartWall }] : [])
    ]
    for (const tr of tracks) {
      this.log(
        '合成: ' + tr.name + '偏移 ' + tr.offset.toFixed(3) + 's（T0 ' + segs[0].t0 + '，第一帧采集于 T0+' +
          capturePts.toFixed(3) + 's；' + tr.name + '起点 ' + tr.wall + '）'
      )
    }
    // 封装层的色彩标记照着码流写（见 bitstreamColorArgs）
    const colorArgs = await bitstreamColorArgs(segs[0].file)
    if (colorArgs.length) this.log('合成: 色彩标记按码流写 ' + colorArgs.filter((_, i) => i % 2).join(' / '))
    type Track = (typeof tracks)[number]
    const attempt = async (use: Track[]): Promise<boolean> => {
      const args = ['-v', 'error', ...vIn]
      if (use.length === 1) {
        // 只有一路：偏移直接用输入参数做，声音原样拷贝，不重新编码
        const tr = use[0]
        if (tr.offset >= 0) args.push('-itsoffset', tr.offset.toFixed(3), '-i', tr.file)
        else args.push('-ss', (-tr.offset).toFixed(3), '-i', tr.file)
        args.push('-map', '0:v:0', '-map', '1:a:0', '-c:a', 'copy')
      } else if (use.length > 1) {
        // 两路：各自按起点对齐（晚开始的补静音、早开始的裁掉开头），再混成一轨。
        // normalize=0：不按路数压低音量，不然游戏声音会小一半
        const chains = use.map((tr, i) => {
          args.push('-i', tr.file)
          const shift =
            tr.offset >= 0
              ? 'asetpts=PTS-STARTPTS,adelay=delays=' + Math.round(tr.offset * 1000) + ':all=1'
              : 'atrim=start=' + (-tr.offset).toFixed(3) + ',asetpts=PTS-STARTPTS'
          return '[' + (i + 1) + ':a]' + shift + '[a' + i + ']'
        })
        const mix = use.map((_, i) => '[a' + i + ']').join('') + 'amix=inputs=' + use.length + ':duration=longest:normalize=0[aout]'
        args.push('-filter_complex', chains.join(';') + ';' + mix)
        args.push('-map', '0:v:0', '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k')
      } else {
        args.push('-map', '0:v:0')
      }
      args.push('-c:v', 'copy', ...colorArgs, '-movflags', '+faststart', '-y', out)
      const r = await runFfmpeg(args, 10 * 60 * 1000)
      if (r.code !== 0) {
        const what = use.length ? use.map((x) => x.name).join('+') : '纯画面'
        this.log('合成失败(' + what + '): ' + r.stderr.trim().split(/\r?\n/).slice(-3).join(' | '))
      }
      return r.code === 0 && existsSync(out) && statSync(out).size > 1024
    }
    // 先两路一起；不行就只要桌面声音（以前的做法）；再不行纯画面
    let ok = await attempt(tracks)
    let hasAudio = audioOk && ok
    if (!ok && tracks.length > 1) {
      ok = await attempt(tracks.slice(0, 1))
      hasAudio = ok
    }
    if (!ok && audioOk) ok = await attempt([])
    if (!ok) {
      // 合成失败的兜底：保留第一段原始分片 MP4（能播放，只是部分播放器拖动不准）
      try {
        renameSync(segs[0].file, out)
        ok = true
        hasAudio = false
      } catch {
        /* 连改名都失败：只能放弃 */
      }
    }
    if (!ok) {
      this.cleanup()
      return { ok: false, error: '录像合成失败' }
    }
    return { ok: true, file: out, durationSec, hasAudio, segments: segs.length }
  }
}

export interface RecorderCallbacks {
  onStatus?: (s: RecorderStatus) => void
  onError?: (msg: string) => void
  onLog?: (msg: string) => void
  onProgress?: (p: ProgressEvent) => void
  onPreview?: (p: PreviewEvent) => void
  onFinished?: (r: FinishedResult) => void
}

export interface StartOptions {
  fid?: string | number | null
  map?: string
  displayId?: string | number
  /** 目标高度，0 = 原生 */
  quality?: number
  fps?: number
  bitrateMbps?: number
  exposure?: number
  /** 'off' = 不录声音，'mic' = 桌面声音 + 麦克风，其它 = 只录桌面声音 */
  audio?: string
  saveDir: string
  method?: CaptureMethod
}

export class FfmpegRecorder {
  private onStatus: ((s: RecorderStatus) => void) | null
  private onError: ((msg: string) => void) | null
  private onLog: ((msg: string) => void) | null
  private onProgress: ((p: ProgressEvent) => void) | null
  private onPreview: ((p: PreviewEvent) => void) | null
  private onFinished: ((r: FinishedResult) => void) | null
  private session: Session | null = null
  lastError: string | null = null
  private previewTimer: NodeJS.Timeout | null = null
  private lastPreviewMtime = 0

  constructor({ onStatus, onError, onLog, onProgress, onPreview, onFinished }: RecorderCallbacks) {
    this.onStatus = onStatus || null
    this.onError = onError || null
    this.onLog = onLog || null
    this.onProgress = onProgress || null
    this.onPreview = onPreview || null
    this.onFinished = onFinished || null
  }

  get current(): CurrentRecording | null {
    const s = this.session
    return s ? { fid: s.fid, map: s.map, startedAt: s.startedAt, sourceId: s.label } : null
  }

  status(): RecorderStatus {
    return { active: !!this.session, current: this.current }
  }

  async start(opts: StartOptions): Promise<{ ok: boolean; message?: string }> {
    // 上一局还在录（漏了结束行）：收尾保存，不要连片段一起删
    this.stop()
    if (!ffmpegPath()) {
      this._error('找不到 ffmpeg.exe（开发环境请先运行 npm run fetch-ffmpeg）')
      return { ok: false, message: 'no ffmpeg' }
    }
    const s = new Session(this, {
      fid: opts.fid,
      map: opts.map,
      displayId: opts.displayId || '',
      quality: Number(opts.quality) || 0,
      fps: Number(opts.fps) || 30,
      bitrateMbps: Number(opts.bitrateMbps) || 8,
      exposure: normExposure(opts.exposure),
      audio: opts.audio === 'off' ? 'off' : opts.audio === 'mic' ? 'mic' : 'default',
      saveDir: opts.saveDir,
      method: opts.method || 'auto'
    })
    this.session = s
    try {
      await s.begin()
    } catch (e) {
      if (this.session === s) this.session = null
      s.abort()
      const msg = e instanceof Error ? e.message : String(e)
      this._error('启动录制失败: ' + msg)
      return { ok: false, message: msg }
    }
    if (this.session !== s) return { ok: false, message: '启动期间被中止' }
    this.startPreview()
    this.emitStatus()
    return { ok: true }
  }

  /** fid/map 在对局结束时才确定，这里覆盖开始时的值；合成在后台进行，期间可以开始下一局的录制 */
  stop(fid?: string | number | null, map?: string | null): void {
    const s = this.session
    if (!s) return
    if (fid != null && String(fid) !== '') s.fid = String(fid)
    if (map != null && String(map) !== '') s.map = String(map)
    this.session = null
    this.stopPreview()
    this.emitStatus()
    const base = (): { fid: string; map: string; dir: string } => ({ fid: s.fid, map: s.map, dir: s.dir })
    s.finish()
      .then((r) => {
        if (this.onFinished) this.onFinished({ ...r, ...base() })
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        this._log('结束录制时出错: ' + msg)
        s.cleanup()
        if (this.onFinished) this.onFinished({ ok: false, error: msg, ...base() })
      })
  }

  abort(): void {
    const s = this.session
    if (!s) return
    this.session = null
    this.stopPreview()
    s.abort()
    this.emitStatus()
  }

  private startPreview(): void {
    this.stopPreview()
    this.previewTimer = setInterval(() => {
      const s = this.session
      if (!s || !this.onPreview) return
      try {
        const st = statSync(s.previewFile)
        if (st.mtimeMs === this.lastPreviewMtime) return
        this.lastPreviewMtime = st.mtimeMs
        this.onPreview({
          dataUrl: 'data:image/jpeg;base64,' + readFileSync(s.previewFile).toString('base64'),
          hasAudio: s.hasAudio
        })
      } catch {
        /* 预览图还没写出来 / 正在被改写 */
      }
    }, 1000)
  }

  private stopPreview(): void {
    if (this.previewTimer) {
      clearInterval(this.previewTimer)
      this.previewTimer = null
    }
  }

  /** @internal Session 回报录制进度 */
  _progress(s: Session): void {
    if (s !== this.session || !this.onProgress) return
    this.onProgress({ fid: s.fid, seconds: s.segments.reduce((a, x) => a + (x.seconds || 0), 0) })
  }

  private emitStatus(): void {
    if (this.onStatus) {
      try {
        this.onStatus(this.status())
      } catch {
        /* 回调自己的事不影响录制 */
      }
    }
  }

  /** @internal Session 写日志 */
  _log(msg: string): void {
    if (this.onLog) {
      try {
        this.onLog(msg)
      } catch {
        /* 回调自己的事不影响录制 */
      }
    }
  }

  /** @internal Session 报错 */
  _error(msg: string): void {
    this.lastError = msg
    if (this.onError) {
      try {
        this.onError(msg)
      } catch {
        /* 回调自己的事不影响录制 */
      }
    }
  }
}

/** 旧版 MediaRecorder 录的 WebM 没有 Cues 索引所以拖不动：无损重封装一遍即可补上 */
export async function remuxWebm(src: string, dest: string): Promise<boolean> {
  const r = await runFfmpeg(['-v', 'error', '-i', src, '-c', 'copy', '-y', dest], 10 * 60 * 1000)
  return r.code === 0 && existsSync(dest) && statSync(dest).size > 1024
}
