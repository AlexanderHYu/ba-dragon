// ================= HDR 录像转 SDR =================
// HDR 屏录的是 HDR10（BT.2020 + PQ），在 SDR 屏、别人的电脑、B 站/微信上要靠播放器猜着做色调映射，常常偏亮、冲爆。
// 一局录完后在后台转成普通 SDR（BT.709）并替换原文件，任何播放器都能正常显示。
// 游戏时不跑：新的一局开始录制就停下，这局录完再从头转；进程用低优先级。
//
// 管线按显卡依次尝试，前一种失败就换下一种（实测 4K HDR 录像、RTX 5090）：
//   1. N 卡：CUDA 硬件解码 + 显卡上缩放 → 拷回内存 → Vulkan（libplacebo）色调映射 → 硬件编码。2.7 倍速（4K）/ 6 倍速（1080p），不到一个核
//   2. 通用：D3D11 硬件解码 → CPU 缩放 → Vulkan 色调映射 → 硬件编码。CPU 占用高一些
//   3. 兜底：全部在 CPU 上做（zscale + tonemap），很慢，但哪里都能跑
// 不用 Vulkan 硬件解码：实测在 N 卡上会让显卡驱动报 VK_ERROR_DEVICE_LOST。
//
// 亮度：libplacebo 默认把 203 尼特当作 SDR 的白，游戏里的天空、阳光会显得发白。
// 先在线性光里乘 203/纸白 再做色调映射，纸白取 300 尼特（对比 203/256/300/400 四档，300 最均衡）。
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { setPriority, constants as osConstants } from 'node:os'
import { dirname, join } from 'node:path'

export const PAPER_WHITE_NITS = 300
const SHADER_FILE = 'ba-sdr-paperwhite.hook'

export function paperWhiteShader(nits = PAPER_WHITE_NITS): string {
  const k = (203 / nits).toFixed(4)
  return [
    '//!HOOK LINEAR',
    '//!BIND HOOKED',
    '//!DESC paper white ' + nits + ' nits',
    'vec4 hook() { vec4 c = HOOKED_tex(HOOKED_pos); c.rgb *= ' + k + '; return c; }',
    ''
  ].join('\n')
}

export type SdrEncoder = 'h264_nvenc' | 'h264_amf' | 'h264_qsv' | 'libx264'

export interface SdrJob {
  file: string
  /** 输出高度（0 = 保持原分辨率） */
  height: number
  bitrateMbps: number
  encoder: SdrEncoder
  /** 录制用的显卡厂商（10de = N 卡），决定先试哪条管线 */
  vendorId: string
}

function encoderArgs(enc: SdrEncoder, bitrateMbps: number): string[] {
  const b = bitrateMbps + 'M'
  const max = Math.round(bitrateMbps * 1.5) + 'M'
  const buf = Math.round(bitrateMbps * 2) + 'M'
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf]
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-bufsize', buf]
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-b:v', b, '-maxrate', max, '-bufsize', buf]
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-bufsize', buf]
  }
}

/** 输出统一标成 BT.709 有限范围，和数据一致 */
const SDR_TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv']

const placebo = (shader: string): string =>
  'libplacebo=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv:format=nv12' +
  ':tonemapping=bt.2390:custom_shader_path=' + shader

/** 依次尝试的几条管线（命令行参数，不含输入输出文件以外的公共部分） */
export function sdrAttempts(job: SdrJob, input: string, output: string, shader: string): { name: string; args: string[] }[] {
  const h = job.height > 0 ? job.height : 0
  const enc = [...encoderArgs(job.encoder, job.bitrateMbps), ...SDR_TAGS, '-c:a', 'copy', '-movflags', '+faststart', '-y', output]
  const list: { name: string; args: string[] }[] = []
  if (job.vendorId === '10de') {
    list.push({
      name: 'cuda+vulkan',
      args: ['-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk', '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda', '-i', input,
        '-vf', 'scale_cuda=' + (h ? '-2:' + h + ':' : '') + 'format=p010le,hwdownload,format=p010le,hwupload,' + placebo(shader), ...enc]
    })
  }
  list.push({
    name: 'd3d11+vulkan',
    args: ['-init_hw_device', 'vulkan=vk', '-filter_hw_device', 'vk', '-hwaccel', 'd3d11va', '-i', input,
      '-vf', (h ? 'scale=-2:' + h + ',' : '') + 'format=p010le,hwupload,' + placebo(shader), ...enc]
  })
  list.push({
    name: 'cpu',
    args: ['-i', input,
      '-vf', (h ? 'scale=-2:' + h + ',' : '') + 'zscale=t=linear:npl=' + PAPER_WHITE_NITS +
        ',format=gbrpf32le,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p', ...enc]
  })
  return list
}

/** 文件是不是 HDR10（PQ） */
export function isHdr10(ffmpeg: string, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true, timeout: 15000 }, (_e, _o, stderr) => {
      resolve(/Video:.*smpte2084/.test(String(stderr || '')))
    })
  })
}

export interface SdrConverterOpts {
  ffmpeg: () => string | null
  log: (m: string) => void
  /** 转好一个（文件已替换） */
  onDone?: (file: string) => void
}

/**
 * 后台排队转换。pause() 时杀掉正在转的进程，任务放回队首；resume() 后从头重转这一个。
 * 输出先写到同目录的临时文件，转完再替换原文件并保留原来的修改时间（按数量清理按修改时间排序）。
 */
export class SdrConverter {
  private queue: SdrJob[] = []
  private proc: ChildProcess | null = null
  private current: SdrJob | null = null
  private paused = false
  private killedForPause = false

  constructor(private opts: SdrConverterOpts) {}

  enqueue(job: SdrJob): void {
    if (this.queue.some((j) => j.file === job.file) || this.current?.file === job.file) return
    this.queue.push(job)
    void this.next()
  }

  /** 新的一局开始录制：停下，不跟游戏抢资源 */
  pause(): void {
    this.paused = true
    if (this.proc && this.current) {
      this.killedForPause = true
      this.queue.unshift(this.current)
      this.opts.log('转 SDR: 新的一局开始录制，先停下，录完再转')
      this.proc.kill()
    }
  }

  resume(): void {
    this.paused = false
    void this.next()
  }

  busy(): boolean {
    return !!this.current
  }

  private async next(): Promise<void> {
    if (this.paused || this.current || !this.queue.length) return
    const job = this.queue.shift() as SdrJob
    this.current = job
    try {
      await this.convert(job)
    } finally {
      this.current = null
      this.proc = null
      void this.next()
    }
  }

  private async convert(job: SdrJob): Promise<void> {
    const ffmpeg = this.opts.ffmpeg()
    if (!ffmpeg || !existsSync(job.file)) return
    if (!(await isHdr10(ffmpeg, job.file))) return
    const dir = dirname(job.file)
    const tmp = join(dir, '.sdr-' + Date.now() + '.mp4')
    const shader = join(dir, '.' + SHADER_FILE)
    writeFileSync(shader, paperWhiteShader())
    const started = Date.now()
    try {
      for (const a of sdrAttempts(job, job.file, tmp, '.' + SHADER_FILE)) {
        if (this.paused) return
        this.killedForPause = false
        const r = await this.run(ffmpeg, a.args, dir)
        if (this.killedForPause) return
        if (r.code === 0 && existsSync(tmp) && statSync(tmp).size > 1024) {
          if (!existsSync(job.file)) return // 转的时候原文件被删了（手动删或按数量清理）
          const mtime = statSync(job.file).mtime
          renameSync(tmp, job.file)
          try {
            utimesSync(job.file, mtime, mtime)
          } catch {
            /* 改不了修改时间无所谓 */
          }
          this.opts.log('转 SDR: 完成（' + a.name + '，' + Math.round((Date.now() - started) / 1000) + ' 秒）')
          this.opts.onDone?.(job.file)
          return
        }
        this.opts.log('转 SDR: ' + a.name + ' 失败，换下一种：' + r.err.trim().split(/\r?\n/).slice(-2).join(' | '))
      }
      this.opts.log('转 SDR: 都失败了，保留 HDR 原片')
    } finally {
      for (const f of [tmp, shader]) {
        try {
          if (existsSync(f)) unlinkSync(f)
        } catch {
          /* 临时文件删不掉就留着 */
        }
      }
    }
  }

  private run(ffmpeg: string, args: string[], cwd: string): Promise<{ code: number; err: string }> {
    return new Promise((resolve) => {
      const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', ...args], { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      this.proc = p
      try {
        if (p.pid) setPriority(p.pid, osConstants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        /* 设不了优先级就按普通优先级跑 */
      }
      let err = ''
      p.stderr?.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)))
      p.on('error', (e) => resolve({ code: -1, err: e.message }))
      p.on('close', (code) => resolve({ code: code ?? -1, err }))
    })
  }
}
