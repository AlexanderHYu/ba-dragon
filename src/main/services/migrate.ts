// ================= 4.0.x 的老数据搬进本地库 =================
// 老版把东西存在几个大 JSON 里：
//   players-db.json  —— 见过的人、本机账号、每局的战绩和 ELO 快照
//   match-archive.json —— 日志里攒的对局档案（地图、时长、名单）
// 只搬一次（meta 里记一笔），只新增不覆盖：新库里已经有的对局不动。
// 老文件原样留着，4.0.x 还能继续用，也方便出问题时回头看。
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Db } from './db'

interface LegacyName {
  name: string
  firstSeen?: number
  lastSeen?: number
}
interface LegacyPlayer {
  id: string
  names?: LegacyName[]
  firstSeen?: number
  lastSeen?: number
}
interface LegacyMatchPlayer {
  id: string
  name?: string
  teamId?: number
  oldRating?: number | null
  newRating?: number | null
  destructionScore?: number | null
  lossesScore?: number | null
}
interface LegacyMatch {
  fid: string
  mapId?: number | null
  endTime?: number | null
  durationSec?: number | null
  winnerTeam?: number | null
  localPlayerId?: string | null
  players?: LegacyMatchPlayer[]
}
interface LegacyDb {
  matches?: Record<string, LegacyMatch>
  players?: Record<string, LegacyPlayer>
  playerSnapshots?: Record<string, { id: string; elo?: number | null; at?: number }>
  localAccounts?: Record<string, { id: string; name?: string }>
}
interface LegacyArchiveItem {
  fid?: string | null
  map?: string
  startTime?: number | null
  durationSec?: number | null
}

export interface MigrateResult {
  ran: boolean
  players: number
  matches: number
  matchPlayers: number
  encounters: number
  eloSnapshots: number
  archive: number
  localIds: string[]
}

export function migrateLegacy(db: Db, dataDir: string): MigrateResult {
  const out: MigrateResult = {
    ran: false, players: 0, matches: 0, matchPlayers: 0, encounters: 0, eloSnapshots: 0, archive: 0, localIds: []
  }
  if (db.meta('legacyDataImported')) return out
  out.ran = true

  const read = <T,>(file: string): T | null => {
    const p = join(dataDir, file)
    if (!existsSync(p)) return null
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as T
    } catch {
      return null // 老文件坏了就跳过，不要影响启动
    }
  }

  const legacy = read<LegacyDb>('players-db.json')
  if (legacy) {
    const localIds = Object.keys(legacy.localAccounts || {})
    out.localIds = localIds
    if (localIds.length) db.setMeta('localIds', JSON.stringify(localIds))

    db.tx(() => {
      // 见过的人
      for (const p of Object.values(legacy.players || {})) {
        const names = (p.names || []).map((n) => n.name).filter(Boolean)
        const exists = db.get('SELECT pid FROM player WHERE pid = ?', [p.id])
        if (exists) continue
        db.run('INSERT INTO player (pid, name, names, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', [
          p.id,
          names[names.length - 1] || '',
          JSON.stringify(names),
          p.firstSeen ?? null,
          p.lastSeen ?? null
        ])
        out.players++
      }

      // 每局的战绩：老版没存单位数据，所以只补对局和每局每人，复盘要重算时会自己拉原始数据
      for (const m of Object.values(legacy.matches || {})) {
        if (!m.fid) continue
        const have = db.get('SELECT fid FROM match WHERE fid = ?', [m.fid])
        if (!have) {
          const start = m.endTime && m.durationSec ? m.endTime - m.durationSec * 1000 : (m.endTime ?? null)
          db.run(
            `INSERT INTO match (fid, map_id, start_time, duration_sec, winner_team, rated, end_reason, raw, fetched_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [m.fid, m.mapId ?? null, start, m.durationSec ?? null, m.winnerTeam ?? null, 1, null, null, m.endTime ?? null]
          )
          out.matches++
        }
        const me = m.localPlayerId ? String(m.localPlayerId) : null
        const myTeam = m.players?.find((p) => String(p.id) === me)?.teamId ?? null
        for (const p of m.players || []) {
          const pid = String(p.id)
          const had = db.get('SELECT pid FROM match_player WHERE fid = ? AND pid = ?', [m.fid, pid])
          if (!had) {
            db.run(
              `INSERT INTO match_player (fid, pid, name, team, elo_before, elo_after, score, mark, titles, d, l, kills, deaths, dmg, spent, afk)
               VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, NULL, 0)`,
              [
                m.fid, pid, p.name || '', p.teamId ?? 0,
                p.oldRating ?? null, p.newRating ?? null,
                p.destructionScore ?? null, p.lossesScore ?? null
              ]
            )
            out.matchPlayers++
          }
          // 相遇：本机账号 vs 其他人
          if (me && pid !== me && myTeam != null) {
            const has = db.get('SELECT fid FROM encounter WHERE fid = ? AND pid = ? AND local_id = ?', [m.fid, pid, me])
            if (!has) {
              const won = m.winnerTeam == null ? null : m.winnerTeam === myTeam ? 1 : 0
              db.run(
                'INSERT INTO encounter (fid, pid, local_id, same_team, won, at) VALUES (?, ?, ?, ?, ?, ?)',
                [m.fid, pid, me, (p.teamId ?? 0) === myTeam ? 1 : 0, won, m.endTime ?? null]
              )
              out.encounters++
            }
          }
        }
      }

      // ELO 快照
      for (const s of Object.values(legacy.playerSnapshots || {})) {
        if (!s?.id || s.elo == null) continue
        db.run('INSERT OR REPLACE INTO elo_snapshot (pid, at, elo, source) VALUES (?, ?, ?, ?)', [
          String(s.id),
          s.at ?? 0,
          s.elo,
          'legacy'
        ])
        out.eloSnapshots++
      }
    })
  }

  // 日志攒的对局档案：补那些还没有的对局（只有地图名和时长）
  const archive = read<LegacyArchiveItem[]>('match-archive.json')
  if (Array.isArray(archive)) {
    db.tx(() => {
      for (const a of archive) {
        if (!a.fid) continue
        if (db.get('SELECT fid FROM match WHERE fid = ?', [a.fid])) continue
        db.run(
          `INSERT INTO match (fid, map_id, start_time, duration_sec, winner_team, rated, end_reason, raw, fetched_at)
           VALUES (?, NULL, ?, ?, NULL, 0, NULL, NULL, ?)`,
          [a.fid, a.startTime ?? null, a.durationSec ?? null, a.startTime ?? null]
        )
        out.archive++
      }
    })
  }

  db.setMeta('legacyDataImported', String(Date.now()))
  return out
}

/** 本机账号 ID：老数据里搬过来的那份 */
export function legacyLocalIds(db: Db): string[] {
  try {
    return JSON.parse(db.meta('localIds') || '[]') as string[]
  } catch {
    return []
  }
}
