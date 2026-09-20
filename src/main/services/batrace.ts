// ================= BATrace 接口客户端 =================
// 规矩（运营方同意使用其 API，但别给人家添乱）：
//   1. 所有请求严格串行，两次之间至少隔 apiDelayMs（默认 1.2 秒）
//   2. 每个接口都有磁盘缓存（本地库的 api_cache 表），命中缓存不发请求
//   3. 超时或 5xx：等 30 秒重试一次，再失败就放弃这一次，不连环重试
//   4. 不发自定义 User-Agent：腾讯 EdgeOne 会把自定义 UA 判成机器人，
//      让 Electron 的 net.fetch 用默认 UA 才能过人机验证
import { net } from 'electron'
import type { Db } from './db'
import type {
  CategoryPreference,
  HighlightUnit,
  MatchInfo,
  MatchEntry,
  UnitInfo
} from '@shared/types/batrace'

const BASE = 'https://app.batrace.top'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 真正的人机验证页（普通 5xx/维护页不算，免得误报） */
export function isCaptchaHtml(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false
  return (
    text.includes('TencentEOCaptchaWidget') ||
    text.includes('EO-Bot-Captcha-Token') ||
    text.includes('Security Verification') ||
    text.includes('__tst_status')
  )
}

export class CaptchaError extends Error {
  constructor() {
    super('BATrace 要求人机验证')
    this.name = 'CaptchaError'
  }
}

export interface AnalysisPlayer {
  matchCount?: number
  trend?: { points?: TrendPoint[] }
  highlightUnits?: (HighlightUnit & { unitName?: string; totalDamage?: number; spawnCount?: number; avgRoi?: number })[]
  categoryPreferences?: (CategoryPreference & { percentage?: number })[]
  mapPerformance?: { mapId: number; mapName?: string; matchCount: number; winRate: number }[]
  playStyle?: unknown
}
export interface TrendPoint {
  matchId: string | number
  won: boolean
  ratingBefore?: number
  ratingAfter?: number
  kdRatio?: number
  dmr?: number
  destructionScore?: number
  lossesScore?: number
  objectivesCaptured?: number
  endTime: number
}

export interface ClientOpts {
  db: Db
  /** 两次请求的最小间隔 */
  delayMs: () => number
  /** 每发一次真实请求就调一下（界面上显示「正在查第几个」用） */
  onRequest?: (url: string) => void
}

export interface ApiHealth {
  /** 最近一次真实请求的结果 */
  ok: boolean | null
  at: number | null
  message: string | null
  /** 这次启动以来发了多少个真实请求（缓存命中不算） */
  requests: number
}

export class BatraceClient {
  private db: Db
  private healthState: ApiHealth = { ok: null, at: null, message: null, requests: 0 }
  private delayMs: () => number
  private onRequest?: (url: string) => void
  private queue: Promise<unknown> = Promise.resolve()
  private lastAt = 0

  constructor(opts: ClientOpts) {
    this.db = opts.db
    this.delayMs = opts.delayMs
    this.onRequest = opts.onRequest
  }

  /** 串行排队 + 间隔限流：所有真实请求都从这里过 */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastAt + this.delayMs() - Date.now()
      if (wait > 0) await sleep(wait)
      this.lastAt = Date.now()
      return fn()
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  health(): ApiHealth {
    return { ...this.healthState }
  }

  private mark(ok: boolean, message?: string): void {
    this.healthState = { ok, at: Date.now(), message: message || null, requests: this.healthState.requests }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    this.onRequest?.(url)
    this.healthState.requests++
    const r = await net.fetch(BASE + url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30000)
    })
    const ct = r.headers.get('content-type') || ''
    if (!/json/.test(ct)) {
      const text = await r.text()
      if (isCaptchaHtml(text)) {
        this.mark(false, '需要人机验证')
        throw new CaptchaError()
      }
      this.mark(false, '非 JSON 响应 HTTP ' + r.status)
      throw new Error('非 JSON 响应 HTTP ' + r.status)
    }
    if (r.status >= 500) {
      this.mark(false, '服务器错误 HTTP ' + r.status)
      throw new Error('服务器错误 HTTP ' + r.status)
    }
    if (!r.ok) {
      this.mark(false, 'HTTP ' + r.status)
      throw new Error('HTTP ' + r.status)
    }
    const json = (await r.json()) as T
    this.mark(true)
    return json
  }

  /**
   * 带缓存的 GET。命中缓存直接返回，不排队也不计数。
   * @param opts.force 绕过缓存（界面上的「重新查询」）
   */
  private async get<T>(url: string, key: string, ttl: number, opts: { force?: boolean } = {}): Promise<T> {
    if (!opts.force) {
      const hit = this.db.cacheGet<T>(key, ttl)
      if (hit !== null) return hit
    }
    try {
      const v = await this.schedule(() => this.fetchJson<T>(url))
      this.db.cacheSet(key, v)
      return v
    } catch (e) {
      if (e instanceof CaptchaError) throw e
      // 超时/5xx：停 30 秒重试一次，再不行就用旧缓存兜底
      try {
        await sleep(30000)
        const v = await this.schedule(() => this.fetchJson<T>(url))
        this.db.cacheSet(key, v)
        return v
      } catch (e2) {
        const stale = this.db.cacheStale<T>(key)
        if (stale !== null) return stale
        throw e2
      }
    }
  }

  /** 只读缓存、不发请求 */
  peek<T>(key: string, ttl: number): T | null {
    return this.db.cacheGet<T>(key, ttl)
  }

  /** 搜索玩家。返回的字段是 id / name / rating / rating_games / updated_at（rating 是档案里的旧值） */
  searchPlayers(
    q: string,
    limit = 20
  ): Promise<{ players?: { id: number | string; name: string; rating?: number; rating_games?: number; updated_at?: string }[] }> {
    return this.get(
      `/api/players/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      `search:${q}:${limit}`,
      10 * 60 * 1000
    )
  }

  /** 核心接口：玩家完整分析（ELO 趋势/胜负/最爱单位/偏好/地图/打法），6 小时缓存 */
  analysisPlayer(stbid: string, force?: boolean): Promise<AnalysisPlayer> {
    return this.get(
      '/api/analysis/player?stbid=' + encodeURIComponent(stbid),
      'analysis:' + stbid,
      6 * 3600 * 1000,
      { force }
    )
  }

  playerInfo(stbid: string): Promise<{ info?: { name?: string }; statInfo?: Record<string, number> }> {
    return this.get(`/api/players/info?stbid=${encodeURIComponent(stbid)}`, `info:${stbid}`, 6 * 3600 * 1000)
  }

  /** 龙区分用：最近 20 场（接口单次上限 20），1 小时缓存 */
  playerMatchesPage(stbid: string, limit = 20, force?: boolean): Promise<{ matches?: MatchEntry[] }> {
    return this.get(
      `/api/players/matches?stbid=${encodeURIComponent(stbid)}&limit=${limit}`,
      `pm:${stbid}:${limit}`,
      3600 * 1000,
      { force }
    )
  }

  /** 单局原始数据（含 UnitData），24 小时缓存 */
  matchById(matchId: string | number): Promise<{ matchInfo?: MatchInfo }> {
    return this.get(
      `/api/match?matchid=${encodeURIComponent(String(matchId))}`,
      `match:${matchId}`,
      24 * 3600 * 1000
    )
  }

  leaderboardBan(limit = 500, offset = 0): Promise<{ players?: { stbid: string; name: string }[] }> {
    return this.get(`/api/leaderboard/ban?limit=${limit}&offset=${offset}`, `ban:${limit}:${offset}`, 3600 * 1000)
  }

  units(): Promise<{ units?: UnitInfo[] }> {
    return this.get('/api/units', 'units', 7 * 24 * 3600 * 1000)
  }
}
