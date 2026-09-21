// ================= 单位效能 =================
// 把本地档案里所有对局的出兵记录摊平，按「单位 + 配装」聚合，算死亡率、存活、伤害、每点花费打出多少东西。
//
// 为什么现算而不是查 match_unit：那张表里的花费是存进去那一刻的口径（老版本是估算的），
// 新旧混着不好比；raw 里存着 BATrace 的原始对局 JSON，拿现在的价目表重算一遍，
// 口径永远是一致的。31 局、5000 多条记录，几十毫秒的事。
import type { Db } from './db'
import type { GameDbService } from './gameDb'
import { MODEL, teamOf } from '@shared/dragon'
import { ROLE_NAME } from '@shared/match'
import type { MatchInfo, PlayerData } from '@shared/types/batrace'
import type { UnitStatRow, UnitStatsFilter, UnitStatsResult } from '@shared/ipc'
import { mapName } from './players'

interface MatchRow {
  fid: string
  map_id: number | null
  winner_team: number | null
  start_time: number
  rated: number
  raw: string
}

interface Agg {
  unitId: number
  options: string
  name: string
  loadout: string
  role: string | null
  cost: number
  deployed: number
  refunded: number
  dead: number
  dmg: number
  kills: number
  lives: number[]
  matches: Set<string>
  users: Set<string>
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const a = [...xs].sort((x, y) => x - y)
  const i = a.length >> 1
  return a.length % 2 ? a[i] : Math.round((a[i - 1] + a[i]) / 2)
}
const r1 = (n: number): number => Math.round(n * 10) / 10
const r2 = (n: number): number => Math.round(n * 100) / 100

export class Analytics {
  constructor(
    private db: Db,
    private gamedb: GameDbService,
    private localIds: () => string[]
  ) {}

  /** 档案里出现过的地图，做筛选用 */
  maps(): { id: number; name: string; matches: number }[] {
    const rows = this.db.all<{ map_id: number | null; n: number }>(
      'SELECT map_id, COUNT(*) n FROM match WHERE raw IS NOT NULL GROUP BY map_id ORDER BY n DESC'
    )
    return rows
      .filter((r) => r.map_id != null)
      .map((r) => ({ id: r.map_id as number, name: mapName(r.map_id as number), matches: r.n }))
  }

  /** 按「单位 + 配装」聚合 */
  unitStats(f: UnitStatsFilter = {}): UnitStatsResult {
    const mine = new Set(this.localIds().map(String))
    const where: string[] = ['raw IS NOT NULL']
    const args: unknown[] = []
    if (f.mapId != null) {
      where.push('map_id = ?')
      args.push(f.mapId)
    }
    if (f.rankedOnly) where.push('rated = 1')
    if (f.sinceDays) {
      where.push('start_time >= ?')
      args.push(Date.now() - f.sinceDays * 86400000)
    }
    const rows = this.db.all<MatchRow>(
      'SELECT fid, map_id, winner_team, start_time, rated, raw FROM match WHERE ' +
        where.join(' AND ') +
        ' ORDER BY start_time DESC',
      args
    )

    const agg = new Map<string, Agg>()
    let matches = 0
    let records = 0
    let unpriced = 0
    for (const m of rows) {
      let mi: MatchInfo
      try {
        mi = JSON.parse(m.raw) as MatchInfo
      } catch {
        continue
      }
      const players = Object.values(mi.Data || {}) as PlayerData[]
      if (!players.length) continue
      matches++
      for (const p of players) {
        const id = String(p.Id)
        const isMine = mine.has(id)
        if (f.who === 'me' && !isMine) continue
        if (f.who === 'others' && isMine) continue
        const team = teamOf(p)
        if (f.result && m.winner_team != null) {
          const won = team === m.winner_team
          if (f.result === 'win' && !won) continue
          if (f.result === 'lose' && won) continue
        }
        for (const u of Object.values(p.UnitData || {})) {
          records++
          const gl = this.gamedb.loadout(u.Id, u.OptionIds)
          if (!gl) unpriced++
          const entry = MODEL.units[String(u.Id)]
          const key = u.Id + '|' + [...(u.OptionIds || [])].sort((a, b) => a - b).join(',')
          let a = agg.get(key)
          if (!a) {
            a = {
              unitId: u.Id,
              options: key.split('|')[1] || '',
              name: gl?.name || entry?.[2] || '单位#' + u.Id,
              loadout: gl?.parts.map((x) => x.label).join(' · ') || '',
              role: entry?.[0] || null,
              cost: gl?.cost || entry?.[1] || 0,
              deployed: 0,
              refunded: 0,
              dead: 0,
              dmg: 0,
              kills: 0,
              lives: [],
              matches: new Set(),
              users: new Set()
            }
            agg.set(key, a)
          }
          a.deployed++
          if (u.WasRefunded) a.refunded++
          if (u.DeathTime) {
            a.dead++
            if (u.SpawnTime) a.lives.push(Math.max(0, Number(u.DeathTime) - Number(u.SpawnTime)))
          }
          a.dmg += Number(u.TotalDamageDealt) || 0
          a.kills += Number(u.KilledCount) || 0
          a.matches.add(m.fid)
          a.users.add(p.Name || id)
        }
      }
    }

    const min = Math.max(1, f.minDeployed || 1)
    const list: UnitStatRow[] = [...agg.values()]
      .filter((a) => a.deployed >= min)
      .map((a) => {
        const spent = a.cost * a.deployed
        return {
          unitId: a.unitId,
          options: a.options,
          name: a.name,
          loadout: a.loadout,
          roleName: a.role ? ROLE_NAME[a.role] || '' : '',
          cost: Math.round(a.cost),
          deployed: a.deployed,
          refunded: a.refunded,
          dead: a.dead,
          deathRate: a.deployed ? Math.round((a.dead / a.deployed) * 100) : null,
          lifeMedian: median(a.lives),
          dmg: Math.round(a.dmg),
          kills: a.kills,
          dmgPer100: spent ? Math.round((a.dmg / spent) * 100) : null,
          killsPer1k: spent ? r2((a.kills / spent) * 1000) : null,
          dmgPerSortie: a.deployed ? Math.round(a.dmg / a.deployed) : 0,
          killsPerSortie: a.deployed ? r1(a.kills / a.deployed) : 0,
          matches: a.matches.size,
          users: a.users.size
        }
      })
      .sort((x, y) => y.deployed - x.deployed)

    return {
      rows: list,
      matches,
      records,
      /** 价目表里查不到的记录（配装名和精确单价用不上，退回老单位表） */
      unpriced,
      priced: this.gamedb.source()
    }
  }
}
