// 日志解析对拍：拿本机真实的 GameLogs 喂给新旧两个解析器，事件流和快照必须一模一样。
// 缺老仓库或日志目录就跳过。日志目录用 BA_LOGS 指定，默认读老版设置里的 logDir。
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LogParser } from './parser'

const LEGACY = process.env.BA_LEGACY || 'H:/github/brokenarrow-log-maggot'
const legacyParser = join(LEGACY, 'src', 'logParser.js')

function logDir(): string | null {
  if (process.env.BA_LOGS) return process.env.BA_LOGS
  const settings = join(process.env.APPDATA || '', 'broken-arrow-log-assistant', 'settings.json')
  if (!existsSync(settings)) return null
  try {
    const dir = (JSON.parse(readFileSync(settings, 'utf8')) as { logDir?: string }).logDir
    return dir && existsSync(dir) ? dir : null
  } catch {
    return null
  }
}

const DIR = logDir()
const ready = existsSync(legacyParser) && !!DIR

/** 最近改动的几个日志文件 */
function recentLogs(dir: string, n = 3): string[] {
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.log'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    .slice(0, n)
}

describe.runIf(ready)('日志解析和 4.0.x 对拍', () => {
  const require = createRequire(import.meta.url)
  const Old = require(legacyParser).LogParser as new (cb: (t: string, d?: unknown) => void) => {
    feed(lines: string[]): void
    snapshot(): unknown
  }
  const files = recentLogs(DIR as string)

  it('有日志文件可以对拍', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('事件流和快照完全一致', () => {
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n')
      // 时间戳会进快照（startTime = Date.now()），对拍时抹掉
      const strip = (d: unknown): unknown =>
        d === undefined
          ? null
          : JSON.parse(
              JSON.stringify(d, (k, v) => (k === 'startTime' || k === 'endTime' || k === 'durationSec' ? null : v))
            )
      const a: unknown[] = []
      const b: unknown[] = []
      const pa = new LogParser((t, d) => a.push([t, strip(d)]))
      const pb = new Old((t, d) => b.push([t, strip(d)]))
      pa.feed(lines)
      pb.feed(lines)
      expect(a, f).toEqual(b)
      expect(strip(pa.snapshot()), f).toEqual(strip(pb.snapshot()))
    }
  })
})
