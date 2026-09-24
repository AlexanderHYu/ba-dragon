// ================= 行车记录仪（录像） =================
// 每局自动录游戏所在那块屏幕，打完合成 MP4 存本地。录制本身在 recorder.ts，
// 这里管「什么时候开、什么时候停、存哪、叫什么名字」。
import {
  appendFileSync,
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { Notification, app, protocol, screen } from 'electron'
import { FfmpegRecorder, probeEncoders, probeOutputs, type FinishedResult, type RecorderStatus } from './recorder'
import {
  encodeReplayKey,
  localReplayClean,
  localReplayDelete,
  localReplayList,
  localReplayPath,
  type LocalReplay
} from './replayLocal'
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

/** 换行符（写日志用） */
const LF = String.fromCharCode(10)

export class ReplayService {
  readonly recorder: FfmpegRecorder
  private logs: string[] = []
  /** 最近一次失败原因（界面上显示到下次开录为止） */
  private lastError: string | null = null

  constructor(
    private config: Config,
    private db: Db,
    private emit: {
      status: (s: RecorderStatus & { error?: string }) => void
      changed: () => void
      log: (s: string) => void
    },
    /** 本机账号，用来确定录像文件名里的「谁录的」 */
    private localIds: () => string[] = () => []
  ) {
    this.recorder = new FfmpegRecorder({
      onStatus: (s) => this.emit.status(s),
      onError: (msg) => {
        this.lastError = msg
        this.emit.status({ ...this.recorder.status(), error: msg })
        this.log('错误: ' + msg)
      },
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
    const line = new Date().toLocaleTimeString('zh-CN') + ' ' + msg
    this.logs.push(line)
    if (this.logs.length > 400) this.logs.splice(0, this.logs.length - 400)
    this.emit.log(msg)
    this.appendFile(line)
  }

  /**
   * 录像日志落盘。
   *
   * 以前只存在内存里，软件一重启就没了——「昨天那局为什么没录上」事后根本没法查。
   * 写到 userData/replay.log，超过 1 MB 就换一轮（留一个 .1 备份）。
   */
  private appendFile(line: string): void {
    try {
      const f = join(app.getPath('userData'), 'replay.log')
      if (existsSync(f) && statSync(f).size > 1024 * 1024) renameSync(f, f + '.1')
      appendFileSync(f, new Date().toISOString().slice(0, 10) + ' ' + line + LF)
    } catch {
      /* 日志写不进去不该影响录像本身 */
    }
  }
  recentLogs(): string[] {
    return this.logs.slice(-120)
  }

  dir(): string {
    const d = String(this.config.get('replaySaveDir') || '').trim()
    return d ? resolve(d) : join(app.getPath('userData'), 'replays')
  }

  status(): RecorderStatus & { error?: string } {
    return { ...this.recorder.status(), ...(this.lastError ? { error: this.lastError } : {}) }
  }

  /** 对局开始：设置里开了才录 */
  startForMatch(fid: string | null, map: string): void {
    if (!this.config.get('replayEnabled')) return
    if (this.recorder.status().active) return
    this.lastError = null // 清掉上一次的报错
    this.log('对局开始，准备开录 fid=' + (fid || '?') + ' map=' + (map || '?'))
    this.emit.status(this.recorder.status())
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
      .then((r) => {
        if (r && r.ok === false) this.log('没开成: ' + (r.message || '未知原因'))
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
      this.lastError = err
      this.log('save fail: ' + err)
      this.notify('录像保存失败：' + err)
      this.emit.status({ ...this.recorder.status(), error: err })
      return
    }
    try {
      const dir = this.dir()
      mkdirSync(dir, { recursive: true })
      const meta = this.metaFor(r.fid)
      // 只要有 fid 就按 fid 命名。对局刚打完时 BATrace 那边还没出数据（实测慢一分多钟），
      // 本地库里查不到是谁、哪张图——那几段留空就是了，名字里的 fid 才是要紧的，
      // 少了它这份录像在对局档案里就对不上号。剩下的等数据到了由 backfillMeta() 补。
      const name = /^\d+$/.test(String(r.fid))
        ? (encodeReplayKey({
            fid: r.fid,
            uploaderId: meta.uploaderId,
            uploaderName: meta.uploaderName,
            teamId: meta.teamId,
            mapId: meta.mapId,
            ts: Date.now()
          })
            .split('/')
            .pop() as string)
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
        'save: 已保存 ' +
          name +
          '（' +
          size +
          'B, ' +
          r.durationSec +
          's, ' +
          (r.hasAudio ? '含声音' : '纯画面') +
          (r.segments > 1 ? ', ' + r.segments + ' 段' : '') +
          '）'
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

  /**
   * 补名字：存盘时对局数据还没抓回来的那些录像（文件名里只有 fid，地图/队伍/名字是空的），
   * 数据到了以后重命名一次，对局档案和播放器就能正常显示了。返回补了几个。
   */
  backfillMeta(): number {
    const dir = this.dir()
    let n = 0
    for (const r of localReplayList(dir)) {
      if (r.uploaderId) continue
      // nofid_<存盘时间>.mp4：1.0.1 及以前，存盘时对局数据还没到就会丢掉 fid。
      // 用存盘时间去认那一局，认不准就不动。
      const fid = /^\d+$/.test(String(r.fid)) ? r.fid : this.guessFid(r.createdAt)
      if (!fid) continue
      const meta = this.metaFor(fid)
      if (!meta.uploaderId) continue
      const name = encodeReplayKey({
        fid,
        uploaderId: meta.uploaderId,
        uploaderName: meta.uploaderName,
        teamId: meta.teamId,
        mapId: meta.mapId,
        ts: r.createdAt || Date.now()
      })
        .split('/')
        .pop() as string
      if (name === r.id) continue
      try {
        renameSync(r.localPath, join(dir, name))
        this.log('补名字: ' + r.id + ' → ' + name)
        n++
      } catch {
        /* 文件被占用/已删掉就跳过，下次再补 */
      }
    }
    if (n) this.emit.changed()
    return n
  }

  /**
   * 按存盘时间认对局：本地库里结束时间在前后 5 分钟内、且本机账号打过的那一局。
   * 正好只有一局才算数，有两局对得上就宁可不认。
   */
  private guessFid(ts: number): string | null {
    if (!ts) return null
    const mine = this.localIds()
    if (!mine.length) return null
    const W = 5 * 60 * 1000
    const rows = this.db.all<{ fid: string; start_time: number; duration_sec: number }>(
      `SELECT m.fid, m.start_time, m.duration_sec FROM match m
       JOIN match_player mp ON mp.fid = m.fid AND mp.pid IN (${mine.map(() => '?').join(',')})
       WHERE m.start_time BETWEEN ? AND ?`,
      [...mine, ts - 4 * 3600 * 1000, ts + W]
    )
    const hit = rows.filter((m) => Math.abs(m.start_time + (m.duration_sec || 0) * 1000 - ts) <= W)
    return hit.length === 1 ? hit[0].fid : null
  }

  /** 录像文件名里带的对局信息：本机是谁、哪一队、哪张图（本地库里查） */
  private metaFor(fid: string): {
    uploaderId: string
    uploaderName: string
    teamId: number | null
    mapId: number | null
  } {
    // 「谁录的」当然是本机账号。以前是 LIMIT 1 随便取一行，取到别人身上
    // 文件名里的队伍就是错的
    const mine = this.localIds()
    const row =
      (mine.length
        ? this.db.get<{ pid: string; name: string; team: number }>(
            'SELECT pid, name, team FROM match_player WHERE fid = ? AND pid IN (' +
              mine.map(() => '?').join(',') +
              ') LIMIT 1',
            [fid, ...mine]
          )
        : null) ||
      this.db.get<{ pid: string; name: string; team: number }>(
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
        ' · ' +
        Math.round(d.size.width * d.scaleFactor) +
        '×' +
        Math.round(d.size.height * d.scaleFactor),
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
