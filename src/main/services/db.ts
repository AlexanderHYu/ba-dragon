// ================= 本地库（SQLite） =================
// 用 node-sqlite3-wasm：纯 WASM，不用编译原生模块，打包和 CI 都省事，
// 实测 2 万行插入 24ms，对我们这个量级绰绰有余。
//
// 存什么：对局、每局每人、每局每人每单位、玩家、相遇、ELO 快照、接口缓存。
// 不存什么：设置（留 JSON，人要能手改）、录像（硬盘上的文件）。
import { Database } from 'node-sqlite3-wasm'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Row {
  [k: string]: unknown
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- 对局：raw 是 /api/match 的原始 JSON，留着以后换算法能重算
CREATE TABLE IF NOT EXISTS match (
  fid TEXT PRIMARY KEY,
  map_id INTEGER, start_time INTEGER, duration_sec INTEGER,
  winner_team INTEGER, rated INTEGER, end_reason INTEGER,
  raw TEXT, fetched_at INTEGER
);

-- 每局每人：龙区分、称号、战绩
CREATE TABLE IF NOT EXISTS match_player (
  fid TEXT, pid TEXT, name TEXT, team INTEGER,
  elo_before REAL, elo_after REAL,
  score REAL, mark TEXT, titles TEXT,
  d REAL, l REAL, kills INTEGER, deaths INTEGER, dmg REAL,
  spent REAL, afk INTEGER,
  PRIMARY KEY (fid, pid)
);
CREATE INDEX IF NOT EXISTS ix_mp_pid ON match_player (pid);

-- 每局每人每个单位型号：配装原样存着，将来拿到配装名字直接能用
CREATE TABLE IF NOT EXISTS match_unit (
  fid TEXT, pid TEXT, unit_id INTEGER, options TEXT,
  deployed INTEGER, refunded INTEGER, dead INTEGER,
  spent REAL, lost REAL, dmg REAL, kills INTEGER, destr REAL,
  PRIMARY KEY (fid, pid, unit_id, options)
);
CREATE INDEX IF NOT EXISTS ix_mu_unit ON match_unit (unit_id);
CREATE INDEX IF NOT EXISTS ix_mu_pid ON match_unit (pid);

-- 见过的人
CREATE TABLE IF NOT EXISTS player (
  pid TEXT PRIMARY KEY, name TEXT, names TEXT,
  first_seen INTEGER, last_seen INTEGER, banned INTEGER DEFAULT 0, ban_seen_at INTEGER
);

-- 相遇：同队还是敌对、输赢
CREATE TABLE IF NOT EXISTS encounter (
  fid TEXT, pid TEXT, local_id TEXT, same_team INTEGER, won INTEGER, at INTEGER,
  PRIMARY KEY (fid, pid, local_id)
);
CREATE INDEX IF NOT EXISTS ix_enc_pid ON encounter (pid);

-- ELO 快照：每次查到就记一条，用来画趋势、也避免显示几周前的旧分数
CREATE TABLE IF NOT EXISTS elo_snapshot (
  pid TEXT, at INTEGER, elo REAL, source TEXT,
  PRIMARY KEY (pid, at)
);

-- 算好的玩家卡片（对局 ID + 玩家 ID）：点开直接读，不再发请求
CREATE TABLE IF NOT EXISTS card (
  pid TEXT, fid TEXT, at INTEGER, json TEXT,
  PRIMARY KEY (pid, fid)
);

-- 接口缓存：一条一条存，不再整个 JSON 文件重写
CREATE TABLE IF NOT EXISTS api_cache (k TEXT PRIMARY KEY, at INTEGER, json TEXT);
`

export class Db {
  private db: Database

  constructor(file: string) {
    this.db = new Database(file)
    this.db.run('PRAGMA journal_mode = WAL')
    this.db.run('PRAGMA synchronous = NORMAL')
    for (const stmt of SCHEMA.split(';')) {
      const s = stmt.trim()
      if (s) this.db.run(s)
    }
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* 关就关了 */
    }
  }

  run(sql: string, params?: unknown[]): void {
    this.db.run(sql, params as never)
  }
  all<T = Row>(sql: string, params?: unknown[]): T[] {
    return this.db.all(sql, params as never) as T[]
  }
  get<T = Row>(sql: string, params?: unknown[]): T | undefined {
    return this.db.get(sql, params as never) as T | undefined
  }
  tx<T>(fn: () => T): T {
    this.db.run('BEGIN')
    try {
      const r = fn()
      this.db.run('COMMIT')
      return r
    } catch (e) {
      this.db.run('ROLLBACK')
      throw e
    }
  }

  // ---------- 接口缓存 ----------
  cacheGet<T>(key: string, ttlMs: number): T | null {
    const row = this.get<{ at: number; json: string }>('SELECT at, json FROM api_cache WHERE k = ?', [key])
    if (!row) return null
    if (Date.now() - row.at > ttlMs) return null
    try {
      return JSON.parse(row.json) as T
    } catch {
      return null
    }
  }
  /** 不看过期时间的旧值（请求失败时的兜底） */
  cacheStale<T>(key: string): T | null {
    const row = this.get<{ json: string }>('SELECT json FROM api_cache WHERE k = ?', [key])
    if (!row) return null
    try {
      return JSON.parse(row.json) as T
    } catch {
      return null
    }
  }
  cacheSet(key: string, value: unknown): void {
    this.run('INSERT OR REPLACE INTO api_cache (k, at, json) VALUES (?, ?, ?)', [
      key,
      Date.now(),
      JSON.stringify(value)
    ])
  }

  meta(k: string): string | null {
    return this.get<{ v: string }>('SELECT v FROM meta WHERE k = ?', [k])?.v ?? null
  }
  setMeta(k: string, v: string): void {
    this.run('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', [k, v])
  }

  /**
   * 一次性搬家：把 4.0.x 的 batrace-cache.json 导进 api_cache。
   * 只做一次（meta 里记一笔），失败不影响启动——大不了重新请求。
   */
  importLegacyCache(dataDir: string): number {
    if (this.meta('legacyCacheImported')) return 0
    const file = join(dataDir, 'batrace-cache.json')
    if (!existsSync(file)) {
      this.setMeta('legacyCacheImported', String(Date.now()))
      return 0
    }
    let n = 0
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, { t?: number; value?: unknown }>
      this.tx(() => {
        for (const [k, v] of Object.entries(json)) {
          if (!v || v.value === undefined) continue
          this.run('INSERT OR REPLACE INTO api_cache (k, at, json) VALUES (?, ?, ?)', [
            k,
            Number(v.t) || 0,
            JSON.stringify(v.value)
          ])
          n++
        }
      })
    } catch {
      /* 老缓存坏了就当没有 */
    }
    this.setMeta('legacyCacheImported', String(Date.now()))
    return n
  }
}
