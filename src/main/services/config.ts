// 设置：还是 %APPDATA%/broken-arrow-log-assistant/settings.json，和 4.0.x 同一个文件。
// 读的时候只认自己认识的键，写的时候保留不认识的键——4.0.x 还在用同一份文件，别把人家的设置抹了。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '@shared/ipc'

export const DEFAULTS: Settings = {
  /** 游戏日志目录（空 = 未设置） */
  logDir: '',
  /** 日志轮询间隔 */
  pollMs: 1500,
  /** BATrace 请求最小间隔：严格串行，避开对方限流 */
  apiDelayMs: 1200,
  /** 进对局自动把名单里每个人都算好 */
  autoQueryCurrentMatch: true,
  theme: 'dark',
  /** 封禁名单：只在启动时查一次，另外可以手动刷新（4.0.x 是每小时轮询） */
  banCheckOnStart: true,
  /** 每小时同步本机最近对局（玩家追踪回填用） */
  matchSyncEnabled: true,
  /** 行车记录仪：每局自动录游戏那块屏幕（默认关，开了要选显示器） */
  replayEnabled: false,
  /** 录哪块屏幕（Electron 的 display.id） */
  replayDisplayId: '',
  /** 分辨率：0 = 原生 / 720 / 1080 / 1440 */
  replayQuality: 1080,
  replayFps: 30,
  replayBitrateMbps: 8,
  /** 曝光补偿（EV）：录像偏暗/偏亮时调 */
  replayExposure: 0,
  /** 录音：'off' 关闭 / 'default' 系统声音 */
  replayAudio: 'default',
  /** 录像保存目录（空 = 数据目录下的 replays） */
  replaySaveDir: '',
  /** 自动删除多少天前的录像（0 = 不删） */
  replayKeepDays: 0
}

const KNOWN = Object.keys(DEFAULTS)

export class Config {
  readonly file: string
  private data: Settings

  constructor(dataDir: string) {
    this.file = join(dataDir, 'settings.json')
    this.data = { ...DEFAULTS }
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      for (const k of KNOWN) if (raw[k] !== undefined) (this.data as Record<string, unknown>)[k] = raw[k]
    } catch {
      /* 设置坏了就用默认值，不要开不起来 */
    }
  }

  all(): Settings {
    return { ...this.data }
  }
  get<K extends keyof Settings>(k: K): Settings[K] {
    return this.data[k]
  }

  set(patch: Partial<Settings>): Settings {
    for (const [k, v] of Object.entries(patch)) {
      if (KNOWN.includes(k)) (this.data as Record<string, unknown>)[k] = v
    }
    this.save()
    return this.all()
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      let onDisk: Record<string, unknown> = {}
      try {
        if (existsSync(this.file)) onDisk = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>
      } catch {
        onDisk = {}
      }
      writeFileSync(this.file, JSON.stringify({ ...onDisk, ...this.data }, null, 2), 'utf8')
    } catch {
      /* 写不进去（权限/磁盘满）：这次的改动只在内存里 */
    }
  }
}

/** 常见 Steam 安装位置，用于「自动检测」 */
const STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'E:\\Steam',
  'F:\\Steam'
]

/** 找 broken_arrow/GameLogs：先看几个常见 Steam 目录，再看 libraryfolders.vdf 里登记的库 */
export function detectLogDir(): string | null {
  const tries: string[] = []
  for (const root of STEAM_ROOTS) {
    tries.push(join(root, 'steamapps', 'common', 'broken_arrow', 'GameLogs'))
    // 额外的库目录写在 libraryfolders.vdf 里
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf')
    try {
      if (existsSync(vdf)) {
        const text = readFileSync(vdf, 'utf8')
        for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
          tries.push(join(m[1].replace(/\\\\/g, '\\'), 'steamapps', 'common', 'broken_arrow', 'GameLogs'))
        }
      }
    } catch {
      /* 读不到就跳过这个库 */
    }
  }
  for (const t of tries) if (existsSync(t)) return t
  return null
}
