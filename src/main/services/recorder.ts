// ================= 对局录像：FFmpeg 采集 + 硬件编码 =================
// 画面：FFmpeg ddagrab（DXGI 桌面复制，帧留在显存）→ NVENC / AMF / QSV / x264 → 分片 MP4（中途崩溃也不丢已录部分）
// 声音：ddagrab 不带音频，另由 WASAPI 回环采集系统声音（services/audioLoopback.ts），实时编码为 AAC
// 结束：两路按实测的起始时刻对齐，合成为带 faststart 索引的普通 MP4（任何播放器都能拖进度条）
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { screen } from 'electron'
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
  hdr: boolean
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
  const hdr = !!(color && color.hdr) && out.adapter === 0
  if (color && color.hdr && !hdr && log) log('HDR 屏不在默认显卡上，退回 8 位采集（高亮部分会过曝）')
  const sdrWhite = hdr && color ? Math.max(1, (color.sdrWhiteNits || 80) / 80) : 1
  return { display, out, color, hdr, sdrWhite }
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

export function buildFilter({ output, fps, size, gpuDirect, hdr, ev, t0, firstFile }: FilterOptions): string {
  const pts = wallclockPts(t0)
  const tap = firstFrameTap(firstFile)
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
  audio: 'off' | 'default'
  saveDir: string
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
      this.log('探测还没完对局就结束了，这局不录了')
      return
    }
    const { display, out, color, hdr, sdrWhite } = target
    const size = targetSize(this.opts.quality, out.width, out.height)
    const ev = normExposure(this.opts.exposure)
    // 优先用与采集同一块显卡的硬件编码器；否则按探测顺序取第一个可用的
    const sameGpu = encoders.find((e) => ENCODER_VENDOR[e] && ENCODER_VENDOR[e] === out.vendorId)
    const encoder = sameGpu || encoders[0]
    if (hdr) writeFileSync(join(this.dir, TONEMAP_FILE), tonemapShader(sdrWhite / exposureGain(ev)))
    // QSV 需要额外的设备映射、曝光补偿要在 CPU 上做，这两种情况统一走读回内存的路径
    const gpuDirect = !hdr && !!sameGpu && size.native && encoder !== 'h264_qsv' && ev === 0
    this.hdr = hdr
    this.plan = { output: out, size, encoder, gpuDirect, hdr, ev }
    this.label =
      ((display && display.label) || 'Display ' + out.output) + ' · ' + size.width + 'x' + size.height + ' · ' + ENCODER_LABEL[encoder] +
      (hdr ? ' · HDR→SDR' : '') + (ev ? ' · ' + (ev > 0 ? '+' : '') + ev + 'EV' : '') + (gpuDirect ? ' (GPU)' : '')
    this.log(
      'plan: adapter=' + out.adapter + ' output=' + out.output + ' (' + out.width + 'x' + out.height + ', ' + out.gpu + ')' +
        ' -> ' + size.width + 'x' + size.height + ' ' + encoder +
        (hdr ? ' hdrTonemap' : gpuDirect ? ' gpuDirect' : ' cpuScale') + ' ev=' + ev +
        ' | ' + ((display && display.label) || '?') + ' ' + ((display && display.colorSpace) || '') +
        (color ? ' | 系统: hdr=' + color.hdr + ' acm=' + color.acm + ' sdrWhite=' + color.sdrWhiteNits + 'nit' : '')
    )
    this.spawnSegment()
    if (this.opts.audio !== 'off') await this.startAudio()
  }

  private spawnSegment(): void {
    const { output, size, encoder, gpuDirect, hdr, ev } = this.plan
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
      ...(hdr ? [] : ['-init_hw_device', 'd3d11va=dx:' + output.adapter, '-filter_hw_device', 'dx']),
      '-filter_complex',
      buildFilter({ output: output.output, fps, size, gpuDirect, hdr, ev, t0: seg.t0, firstFile: seg.firstFile }),
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
      // HDR 链路一帧都没出就退出（多半是没有 Vulkan）：退回 8 位采集立即重来，不计入重试次数
      if (this.plan.hdr && !seg.seconds) {
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
    try {
      const a = await startLoopback(this.audioFile, requireFfmpeg(), (m) => this.log(m))
      if (this.stopping || this.aborted) {
        a.kill()
        return
      }
      this.audio = a
      this.audioStartWall = a.startWall
      this.hasAudio = true
    } catch (e) {
      this.log('声音采集失败，本局只录画面: ' + (e instanceof Error ? e.message : String(e)))
    }
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
    await Promise.all([procDone, this.audio ? this.audio.stop() : null])
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
    let audioOk = false
    try {
      audioOk = this.hasAudio && statSync(this.audioFile).size > 1024
    } catch {
      /* 没有音频文件 */
    }
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
    const attempt = async (withAudio: boolean): Promise<boolean> => {
      const aIn: string[] = []
      if (withAudio) {
        // 声音比画面晚开始 → 往后推；早开始 → 裁掉多出的开头
        // 以第一段对齐；中途续录的分段之间有 1~2 秒空档，之后的声音会相应偏早
        const offset = this.audioStartWall && zeroWall ? (this.audioStartWall - zeroWall) / 1000 : 0
        if (offset >= 0) aIn.push('-itsoffset', offset.toFixed(3), '-i', this.audioFile)
        else aIn.push('-ss', (-offset).toFixed(3), '-i', this.audioFile)
        this.log(
          '合成: 声音偏移 ' + offset.toFixed(3) + 's（T0 ' + segs[0].t0 + '，第一帧采集于 T0+' + capturePts.toFixed(3) +
            's；声音起点 ' + this.audioStartWall + '）'
        )
      }
      const args = ['-v', 'error', ...vIn, ...aIn, '-map', '0:v:0']
      if (withAudio) args.push('-map', '1:a:0', '-c:a', 'copy')
      args.push('-c:v', 'copy', '-movflags', '+faststart', '-y', out)
      const r = await runFfmpeg(args, 10 * 60 * 1000)
      if (r.code !== 0) {
        this.log('合成失败(' + (withAudio ? '含声音' : '纯画面') + '): ' + r.stderr.trim().split(/\r?\n/).slice(-3).join(' | '))
      }
      return r.code === 0 && existsSync(out) && statSync(out).size > 1024
    }
    let ok = await attempt(audioOk)
    let hasAudio = audioOk && ok
    if (!ok && audioOk) ok = await attempt(false)
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
  /** 'off' = 不录声音 */
  audio?: string
  saveDir: string
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
    this.abort()
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
      audio: opts.audio === 'off' ? 'off' : 'default',
      saveDir: opts.saveDir
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
        this._log('收尾异常: ' + msg)
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
