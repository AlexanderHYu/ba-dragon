// ================= 单局入库 =================
// 对局档案唯一可靠的来源是 /api/match?matchid=：按 fid 拿，打完一两分钟就有。
// （/api/players/matches 那个列表 BATrace 那边会停更——2026-09 实测最新一条停在 9 月 17 日，
//   靠它同步，打完的局只活在当前日志里，游戏一重开换了新日志就从档案里消失了。）
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { analyzeMatch } from '@shared/dragon'
import { buildMatchReport } from '@shared/match'
import type { BatraceClient } from './batrace'
import type { Db } from './db'
import type { GameDbService } from './gameDb'
import { mapName } from './players'
import type { Tracker } from './tracker'

export interface ImportDeps {
  client: BatraceClient
  db: Db
  gamedb: GameDbService
  tracker: Tracker
}

export type Report = ReturnType<typeof buildMatchReport>

/** 拿一局、算复盘、入库。BATrace 还没出数据时返回 notYet */
export async function importMatch(
  s: ImportDeps,
  fid: string,
  localIds: string[]
): Promise<Report | { error: 'notYet' }> {
  const res = await s.client.matchById(fid)
  const mi = res?.matchInfo
  if (!mi?.Data || !Object.keys(mi.Data).length) return { error: 'notYet' }
  const review = analyzeMatch(mi, fid)
  const src = s.gamedb.source()
  const report = buildMatchReport(mi, {
    fid,
    review,
    localIds,
    mapName,
    game: s.gamedb.priceTable() || undefined,
    gameSource: src === 'none' ? undefined : src
  })
  saveMatch(s.db, fid, mi, report)
  s.tracker.recordMatch(
    fid,
    report.players.map((p) => ({ id: p.id, name: p.name, team: p.team })),
    report.winnerTeam,
    localIds
  )
  return report
}

export const hasMatch = (db: Db, fid: string): boolean => !!db.get('SELECT fid FROM match WHERE fid = ?', [fid])

/**
 * 打完一局后等 BATrace 出数据再入库。实测 90 秒左右，偶尔要好几分钟，
 * 所以 2 → 5 → 15 → 30 分钟各试一次，拿到就停。
 */
export function importAfterMatch(
  s: ImportDeps,
  fid: string,
  localIds: () => string[],
  done: () => void,
  delays = [2, 5, 15, 30]
): void {
  const attempt = (i: number): void => {
    if (i >= delays.length) return
    setTimeout(
      () => {
        if (hasMatch(s.db, fid)) return done()
        importMatch(s, fid, localIds())
          .then((r) => ('error' in r ? attempt(i + 1) : done()))
          .catch(() => attempt(i + 1))
      },
      (delays[i] - (delays[i - 1] ?? 0)) * 60 * 1000
    )
  }
  attempt(0)
}

const FID_RE = /^Log: FID:(\d+)/
const MISS_KEY = 'importMiss'

/** 最近几天日志里出现过的 fid（按时间先后） */
export async function recentLogFids(dir: string, days = 3): Promise<string[]> {
  const since = Date.now() - days * 86400 * 1000
  let files: { path: string; mtime: number }[] = []
  try {
    files = readdirSync(dir)
      .filter((f) => /^Gamelog__.*\.log$/i.test(f))
      .map((f) => {
        const path = join(dir, f)
        return { path, mtime: statSync(path).mtimeMs }
      })
      .filter((f) => f.mtime >= since)
      .sort((a, b) => a.mtime - b.mtime)
  } catch {
    return []
  }
  const out: string[] = []
  for (const f of files) {
    // 日志动辄几十上百 MB，一行一行流着读
    const rl = createInterface({ input: createReadStream(f.path, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of rl) {
      const m = FID_RE.exec(line)
      if (m && !out.includes(m[1])) out.push(m[1])
    }
  }
  return out
}

/**
 * 开软件时补漏：最近几天日志里打过、但本地库里没有的局，逐个按 fid 拿回来。
 * BATrace 一直没有的（比如开了个房没打起来）试满 3 次就不再试。
 * @returns 补进来的局数
 */
export async function catchUpFromLogs(s: ImportDeps, dir: string, localIds: () => string[], max = 10): Promise<number> {
  if (!dir) return 0
  let miss: Record<string, number> = {}
  try {
    miss = JSON.parse(s.db.meta(MISS_KEY) || '{}')
  } catch {
    /* 坏了就从头记 */
  }
  const todo = (await recentLogFids(dir))
    .filter((fid) => !hasMatch(s.db, fid) && (miss[fid] || 0) < 3)
    .slice(-max)
  let added = 0
  for (const fid of todo) {
    try {
      const r = await importMatch(s, fid, localIds())
      if ('error' in r) miss[fid] = (miss[fid] || 0) + 1
      else added++
    } catch {
      miss[fid] = (miss[fid] || 0) + 1
    }
  }
  // 只留最近的，别让这张表无限长
  const keep = Object.fromEntries(Object.entries(miss).slice(-50))
  s.db.setMeta(MISS_KEY, JSON.stringify(keep))
  return added
}

/** 复盘算完入库：对局、每局每人、每局每人每单位（配装原样存着） */
function saveMatch(db: Db, fid: string, mi: Parameters<typeof analyzeMatch>[0], report: Report): void {
  try {
    db.tx(() => {
      db.run(
        `INSERT OR REPLACE INTO match (fid, map_id, start_time, duration_sec, winner_team, rated, end_reason, raw, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fid,
          mi.MapId ?? null,
          report.startTime,
          report.durationSec,
          report.winnerTeam,
          report.rated ? 1 : 0,
          report.endReason,
          JSON.stringify(mi),
          Date.now()
        ]
      )
      for (const p of report.players) {
        db.run(
          `INSERT OR REPLACE INTO match_player
           (fid, pid, name, team, elo_before, elo_after, score, mark, titles, d, l, kills, deaths, dmg, spent, afk)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            fid, p.id, p.name, p.team, p.eloBefore, p.eloAfter, p.score, p.mark,
            JSON.stringify(p.titles.map((t) => t.id)),
            p.D, p.L, p.kills, p.deaths, p.dmg, p.spent, p.afk ? 1 : 0
          ]
        )
        for (const u of p.units) {
          db.run(
            `INSERT OR REPLACE INTO match_unit
             (fid, pid, unit_id, options, deployed, refunded, dead, spent, lost, dmg, kills, destr)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [fid, p.id, u.id, u.options, u.deployed, u.refunded, u.dead, u.spent, u.lost, u.dmg, u.kills, u.destr]
          )
        }
      }
    })
  } catch {
    /* 入库失败不影响看复盘 */
  }
}
