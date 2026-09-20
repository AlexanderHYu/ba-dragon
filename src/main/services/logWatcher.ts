// ================= 日志目录监听 =================
// 周期扫描 GameLogs：始终跟最新的 Gamelog__*.log，只读新增的字节（历史日志几百 MB，绝不整文件重读），
// 游戏重启产生新文件时自动切过去。
import { existsSync, openSync, readSync, closeSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { LogParser } from '@shared/log'

const LOG_RE = /\.(log|txt)$/i
const GAMELOG_RE = /^Gamelog__/i

export interface WatcherState {
  file: string | null
  listening: boolean
  mtime: number | null
}

export class LogWatcher {
  private timer: NodeJS.Timeout | null = null
  private currentFile: string | null = null
  private offset = 0
  private pending = ''
  private mtime: number | null = null

  constructor(
    private opts: {
      dir: () => string
      pollMs: () => number
      parser: LogParser
      onState: (s: WatcherState) => void
    }
  ) {}

  start(): void {
    this.stop()
    this.timer = setInterval(() => this.poll(), this.opts.pollMs())
    this.poll()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** 换目录/换轮询间隔后重启 */
  restart(): void {
    this.currentFile = null
    this.offset = 0
    this.pending = ''
    this.opts.parser.reset()
    this.start()
  }

  state(): WatcherState {
    return { file: this.currentFile, listening: !!this.currentFile, mtime: this.mtime }
  }

  /** 目录下最新的日志文件：Gamelog__ 前缀优先，再按修改时间 */
  private findNewest(): { name: string; full: string; mtime: number } | null {
    const dir = this.opts.dir()
    try {
      if (!dir || !existsSync(dir)) return null
      const files = readdirSync(dir)
        .filter((f) => LOG_RE.test(f))
        .map((f) => {
          const full = join(dir, f)
          let mtime = 0
          try {
            mtime = statSync(full).mtimeMs
          } catch {
            /* 文件正被写/被删，跳过 */
          }
          return { name: f, full, mtime }
        })
        .sort((a, b) => {
          const aG = GAMELOG_RE.test(a.name) ? 1 : 0
          const bG = GAMELOG_RE.test(b.name) ? 1 : 0
          if (aG !== bG) return bG - aG
          return b.mtime - a.mtime
        })
      return files[0] || null
    } catch {
      return null
    }
  }

  poll(): void {
    const newest = this.findNewest()
    if (!newest) {
      if (this.currentFile) {
        this.currentFile = null
        this.offset = 0
        this.pending = ''
        this.mtime = null
        this.opts.onState(this.state())
      }
      return
    }
    if (newest.full !== this.currentFile) {
      // 换文件（游戏重启）：从头读这个文件，解析器也重来
      this.currentFile = newest.full
      this.offset = 0
      this.pending = ''
      this.opts.parser.reset(true)
      this.opts.onState(this.state())
    }
    this.mtime = newest.mtime
    let size = 0
    try {
      size = statSync(this.currentFile).size
    } catch {
      return
    }
    if (size < this.offset) {
      // 文件被截断/换了内容：从头再来
      this.offset = 0
      this.pending = ''
      this.opts.parser.reset(true)
    }
    if (size === this.offset) return
    const len = size - this.offset
    const buf = Buffer.allocUnsafe(len)
    let fd: number | null = null
    try {
      fd = openSync(this.currentFile, 'r')
      readSync(fd, buf, 0, len, this.offset)
    } catch {
      return
    } finally {
      if (fd != null) closeSync(fd)
    }
    this.offset = size
    const text = this.pending + buf.toString('utf8')
    const lines = text.split('\n')
    this.pending = lines.pop() || '' // 最后一行可能只写了一半
    if (lines.length) this.opts.parser.feed(lines)
  }
}
