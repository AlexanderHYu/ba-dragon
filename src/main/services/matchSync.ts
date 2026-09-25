// ================= 对局同步 =================
// 每小时把本机账号最近的对局拉一遍（每个账号 1 个请求），写进本地库：
// 对局档案自己就长起来了，不用等你去点复盘。
// 这里只存战绩，不存单位数据——单位数据要另外拉 /api/match，点开复盘时再说。
import { isRated, teamOf } from '@shared/dragon'
import { num, type MatchInfo, type PlayerData } from '@shared/types/batrace'
import type { BatraceClient } from './batrace'
import type { Db } from './db'
import type { Tracker } from './tracker'

export class MatchSync {
  private timer: NodeJS.Timeout | null = null
  private lastAt = 0

  constructor(
    private client: BatraceClient,
    private db: Db,
    private tracker: Tracker,
    private localIds: () => string[]
  ) {}

  start(everyMs = 3600 * 1000): void {
    this.stop()
    this.timer = setInterval(() => void this.run().catch(() => undefined), everyMs)
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** @returns 新写进本地库的对局数 */
  async run(): Promise<{ added: number; accounts: number }> {
    const ids = this.localIds()
    let added = 0
    for (const id of ids) {
      let res
      try {
        res = await this.client.playerMatchesRecent(id, 10)
      } catch {
        continue // 这个号拉不到就跳过，下一轮再说
      }
      for (const entry of res?.matches || []) {
        const fid = String(entry.matchId ?? '')
        const mi = entry.data as MatchInfo | undefined
        if (!fid || !mi?.Data) continue
        if (this.db.get('SELECT fid FROM match WHERE fid = ?', [fid])) continue
        if (this.save(fid, mi, ids)) added++
      }
    }
    this.lastAt = Date.now()
    return { added, accounts: ids.length }
  }

  at(): number {
    return this.lastAt
  }

  /** 一局：对局行 + 每局每人 + 相遇。没有单位数据，复盘时会重新拉一次完整数据 */
  private save(fid: string, mi: MatchInfo, localIds: string[]): boolean {
    const all = Object.values(mi.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1)
    if (!all.length) return false
    // 胜方：排位局看 ELO 涨跌（赢必涨）
    const ratedP = all.find((p) => isRated(p))
    const winnerTeam = ratedP
      ? (ratedP.NewRating as number) > (ratedP.OldRating as number)
        ? teamOf(ratedP)
        : 1 - teamOf(ratedP)
      : null
    const dur = num(mi.TotalPlayTimeInSec) || null
    // 列表接口只给 EndTime，没有 StartTime：用结束时间倒推
    const start = num(mi.StartTime) * 1000 || (num(mi.EndTime) && dur ? (num(mi.EndTime) - dur) * 1000 : null)
    try {
      this.db.tx(() => {
        this.db.run(
          `INSERT OR REPLACE INTO match (fid, map_id, start_time, duration_sec, winner_team, rated, end_reason, raw, fetched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          [fid, mi.MapId ?? null, start, dur, winnerTeam, ratedP ? 1 : 0, mi.EndMatchReason ?? null, Date.now()]
        )
        for (const p of all) {
          const D = num(p.DestructionScore)
          const L = num(p.LossesScore)
          this.db.run(
            `INSERT OR REPLACE INTO match_player
             (fid, pid, name, team, elo_before, elo_after, score, mark, titles, d, l, kills, deaths, dmg, spent, afk)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, NULL, 0)`,
            [
              fid, String(p.Id), p.Name || '', teamOf(p),
              hasRating(p) ? p.OldRating : null, hasRating(p) ? p.NewRating : null,
              D, L, num(p.Destruction), num(p.Losses), num(p.DamageDealt)
            ]
          )
        }
      })
      this.tracker.recordMatch(
        fid,
        all.map((p) => ({ id: String(p.Id), name: p.Name || '', team: teamOf(p) })),
        winnerTeam,
        localIds
      )
      return true
    } catch {
      return false // 写库失败不影响别的
    }
  }
}

const hasRating = (p: PlayerData): boolean =>
  typeof p.OldRating === 'number' && typeof p.NewRating === 'number'
