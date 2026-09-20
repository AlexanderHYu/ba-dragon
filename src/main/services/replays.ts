// ================= 行车记录仪（录像） =================
// 每局自动录游戏所在那块屏幕，打完合成 MP4 存本地。录制本身在 recorder.ts，
// 这里管「什么时候开、什么时候停、存哪、叫什么名字」。
import { copyFileSync, createReadStream, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { Notification, app, protocol, screen } from 'electron'
import {
  FfmpegRecorder,
  probeEncoders,
  probeOutputs,
  type FinishedResult,
  type RecorderStatus
} from './recorder'
import { encodeReplayKey, localReplayClean, localReplayDelete, localReplayList, localReplayPath, type LocalReplay } from './replayLocal'
import type { Config } from './config'
import type { Db } from './db'
import { mapName } from './players'

export interface DisplayChoice {
  id: string
  label: string
  width: number
  height: number
  primary: boolean
  /** 这块屏幕能不能用显卡直采（DXGI 探测到了对应输出） */
  capturable: boolean
}

export class ReplayService {
  readonly recorder: FfmpegRecorder
  private logs: string[] = []

  constructor(
    private config: Config,
    private db: Db,
    private emit: { status: (s: RecorderStatus & { error?: string }) => void; changed: () => void; log: (s: string) => void }
  ) {
    this.recorder = new FfmpegRecorder({
      onStatus: (s) => this.emit.status(s),
      onError: (msg) => this.emit.status({ ...this.recorder.status(), error: msg }),
      onLog: (msg) => this.log(msg),
      onFinished: (r) => this.save(r)
    })
    // 显示器增减/改分辨率后重新探测；启动几秒后预热，第一局开录不用等
    setTimeout(() => {
      void probeOutputs().catch(() => undefined)
      void probeEncoders().catch(() => undefined)
    }, 5000)
  }

  private log(msg: string): void {
    this.logs.push(new Date().toLocaleTimeString('zh-CN') + ' ' + msg)
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400)
    this.emit.log(msg)
  }
  recentLogs(): string[] {
    return this.logs.slice(-120)
  }

  dir(): string {
    const d = String(this.config.get('replaySaveDir') || '').trim()
    return d ? resolve(d) : join(app.getPath('userData'), 'replays')
  }

  status(): RecorderStatus {
    return this.recorder.status()
  }

  /** 对局开始：设置里开了才录 */
  startForMatch(fid: string | null, map: string): void {
    if (!this.config.get('replayEnabled')) return
    if (this.recorder.status().active) return
    void this.recorder
      .start({
        fid,
        map,
        displayId: String(this.config.get('replayDisplayId') || ''),
        quality: Number(this.config.get('replayQuality')) || 1080,
        fps: Number(this.config.get('replayFps')) || 30,
        bitrateMbps: Number(this.config.get('replayBitrateMbps')) || 8,
        exposure: Number(this.config.get('replayExposure')) || 0,
        audio: String(this.config.get('replayAudio') || 'default'),
        saveDir: this.dir()
      })
      .catch((e: unknown) => this.log('开录失败: ' + String((e as Error)?.message || e)))
  }

  /** 对局结束：停止并合成 */
  stopForMatch(fid: string | null, map: string): void {
    if (!this.recorder.status().active) return
    // stop 是同步的：它只是收尾，合成完走 onFinished
    this.recorder.stop(fid ?? undefined, map)
  }

  /** 不在对局了还在录（崩溃退出、日志漏了结束行）：中止残留录制 */
  watchdog(inMatch: boolean): void {
    const st = this.recorder.status()
    if (!st.active) return
    const tooOld = this.recorder.current && Date.now() - this.recorder.current.startedAt > 30 * 60 * 1000
    if (!inMatch || tooOld) {
      this.log('watchdog: 不在对局或超时，中止残留录制')
      this.recorder.abort()
      this.emit.status(this.recorder.status())
    }
  }

  abort(): void {
    try {
      this.recorder.abort()
    } catch {
      /* 退出时尽力而为 */
    }
  }

  /** 合成完成：按对局信息命名后移进录像目录 */
  private save(r: FinishedResult): void {
    if (!r?.ok) {
      const err = ('error' in r && r.error) || '无录制数据'
      this.log('save fail: ' + err)
      this.notify('录像保存失败：' + err)
      this.emit.status({ ...this.recorder.status(), error: err })
      return
    }
    try {
      const dir = this.dir()
      mkdirSync(dir, { recursive: true })
      const meta = this.metaFor(r.fid)
      const name =
        /^\d+$/.test(String(r.fid)) && meta.uploaderId
          ? (encodeReplayKey({
              fid: r.fid,
              uploaderId: meta.uploaderId,
              uploaderName: meta.uploaderName,
              teamId: meta.teamId,
              mapId: meta.mapId,
              ts: Date.now()
            }).split('/').pop() as string)
          : 'nofid_' + Date.now() + '.mp4'
      const dest = join(dir, name)
      try {
        renameSync(r.file, dest)
      } catch {
        // 录制中途改了保存目录，可能跨盘，改名会失败
        copyFileSync(r.file, dest)
        unlinkSync(r.file)
      }
      try {
        if (r.dir) rmSync(r.dir, { recursive: true, force: true })
      } catch {
        /* 临时目录清不掉就留着 */
      }
      const size = statSync(dest).size
      this.log(
        'save: 已保存 ' + name + '（' + size + 'B, ' + r.durationSec + 's, ' +
          (r.hasAudio ? '含声音' : '纯画面') + (r.segments > 1 ? ', ' + r.segments + ' 段' : '') + '）'
      )
      this.emit.changed()
      this.notify('本局录像已保存到本地')
      // 顺手清理过期录像
      const days = Number(this.config.get('replayKeepDays')) || 0
      if (days > 0) localReplayClean(dir, days)
    } catch (e) {
      this.log('save fail: ' + String((e as Error)?.message || e))
    }
  }

  /** 录像文件名里带的对局信息：本机是谁、哪一队、哪张图（本地库里查） */
  private metaFor(fid: string): { uploaderId: string; uploaderName: string; teamId: number | null; mapId: number | null } {
    const row = this.db.get<{ pid: string; name: string; team: number }>(
      `SELECT mp.pid, mp.name, mp.team FROM match_player mp
       JOIN player p ON p.pid = mp.pid
       WHERE mp.fid = ? LIMIT 1`,
      [fid]
    )
    const m = this.db.get<{ map_id: number | null }>('SELECT map_id FROM match WHERE fid = ?', [fid])
    return {
      uploaderId: row?.pid || '',
      uploaderName: row?.name || '',
      teamId: row?.team ?? null,
      mapId: m?.map_id ?? null
    }
  }

  private notify(body: string): void {
    try {
      if (Notification.isSupported()) new Notification({ title: '行车记录仪', body }).show()
    } catch {
      /* 通知失败不重要 */
    }
  }

  // ---------- 本地录像文件 ----------
  list(): LocalReplay[] {
    return localReplayList(this.dir(), mapName)
  }
  remove(key: string): { ok: boolean; message: string } {
    const r = localReplayDelete(this.dir(), key)
    if (r.ok) this.emit.changed()
    return r
  }
  clean(days: number): number {
    const n = localReplayClean(this.dir(), days)
    if (n) this.emit.changed()
    return n
  }
  pathOf(key: string): string | null {
    return localReplayPath(this.dir(), key)
  }

  /** 可选的显示器：系统列表 + DXGI 探测到的输出对不对得上 */
  async displays(): Promise<DisplayChoice[]> {
    let outputs: Awaited<ReturnType<typeof probeOutputs>> = []
    try {
      outputs = await probeOutputs()
    } catch {
      outputs = []
    }
    return screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label:
        (d.label || '显示器 ' + (i + 1)) +
        ' · ' + Math.round(d.size.width * d.scaleFactor) + '×' + Math.round(d.size.height * d.scaleFactor),
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === screen.getPrimaryDisplay().id,
      capturable: outputs.some(
        (o) =>
          Math.abs(o.width - Math.round(d.size.width * d.scaleFactor)) <= 2 &&
          Math.abs(o.height - Math.round(d.size.height * d.scaleFactor)) <= 2
      )
    }))
  }

  /**
   * replay://local/<文件名> → 本地录像文件。
   * 支持 Range（206 分段），拖进度条只读需要的那一段，几百 MB 的录像也不用整个读进内存。
   */
  registerProtocol(): void {
    protocol.handle('replay', (req) => {
      const name = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
      const file = this.pathOf(name)
      if (!file) return new Response('not found', { status: 404 })
      const size = statSync(file).size
      const range = req.headers.get('range')
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
      if (!m) {
        return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(size), 'accept-ranges': 'bytes' }
        })
      }
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size || start > end) {
        return new Response('range not satisfiable', { status: 416, headers: { 'content-range': 'bytes */' + size } })
      }
      return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(end - start + 1),
          'content-range': 'bytes ' + start + '-' + end + '/' + size,
          'accept-ranges': 'bytes'
        }
      })
    })
  }

  encoders(): Promise<string[]> {
    return probeEncoders().catch(() => [])
  }
}
