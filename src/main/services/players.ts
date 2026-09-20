// 玩家卡片：粗查（/api/analysis/player）和龙区分（/api/players/matches）合并成一个东西。
// 4.0.x 分成两个按钮、两个窗口，实测只差一个请求，合并后开局一次算好、点开直接看存档。
import { computeDragonScore, type DragonScore } from '@shared/dragon'
import type { PlayerCard, PlayerInfo } from '@shared/ipc'
import type { AnalysisPlayer } from './batrace'
import type { BatraceClient } from './batrace'
import type { Db } from './db'

// 地图 ID → 名字：接口里没有地图表，只能从玩家分析的 mapPerformance 里见一个记一个。
// 记进本地库，下次启动直接有，不然复盘页开头几次只能显示「地图#20」。
const MAP_NAMES = new Map<number, string>()
let mapDb: Db | null = null

export function loadMapNames(db: Db): void {
  mapDb = db
  try {
    const raw = db.meta('mapNames')
    if (!raw) return
    for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, string>)) MAP_NAMES.set(Number(k), v)
  } catch {
    /* 存坏了就当没有，下次见到再记 */
  }
}

export function registerMapNames(list?: { mapId: number; mapName?: string }[]): void {
  let changed = false
  for (const m of list || []) {
    if (!m.mapName) continue
    if (MAP_NAMES.get(Number(m.mapId)) === m.mapName) continue
    MAP_NAMES.set(Number(m.mapId), m.mapName)
    changed = true
  }
  if (changed && mapDb) {
    try {
      mapDb.setMeta('mapNames', JSON.stringify(Object.fromEntries(MAP_NAMES)))
    } catch {
      /* 写不进去也只是下次要重新学 */
    }
  }
}
export function mapName(id?: number): string {
  if (id == null) return ''
  return MAP_NAMES.get(Number(id)) || '地图#' + id
}

const r2 = (x: number): number => Math.round(x * 100) / 100

/** /api/analysis/player → 卡片上的基础档案 */
export function toInfo(stbid: string, a: AnalysisPlayer): PlayerInfo | null {
  if (!a || typeof a !== 'object' || (a.matchCount == null && !Array.isArray(a.trend?.points))) return null
  registerMapNames(a.mapPerformance)
  const points = Array.isArray(a.trend?.points) ? a.trend.points : []
  const latest = points[points.length - 1]
  const wins = points.filter((p) => p.won).length
  return {
    stbid,
    elo: latest?.ratingAfter != null ? r2(latest.ratingAfter) : null,
    matchCount: a.matchCount || points.length,
    winRate: points.length ? Math.round((wins / points.length) * 100) : 0,
    wins,
    losses: points.length - wins,
    kd: latest?.kdRatio != null ? r2(latest.kdRatio) : null,
    dmr: latest?.dmr != null ? r2(latest.dmr) : null,
    favUnits: (a.highlightUnits || []).slice(0, 3).map((u) => ({
      name: u.unitName || `单位#${u.unitId}`,
      val: Math.round(u.totalDamage || 0),
      spawn: u.spawnCount || 0,
      roi: u.avgRoi != null ? r2(u.avgRoi) : null
    })),
    categories: (a.categoryPreferences || []).slice(0, 3).map((c) => ({
      key: String(c.categoryKey),
      pct: Number(c.percentage) || 0
    })),
    mapStats: (a.mapPerformance || []).slice(0, 5).map((m) => ({
      mapId: m.mapId,
      name: m.mapName || mapName(m.mapId),
      matchCount: m.matchCount,
      winRate: m.winRate
    })),
    playStyle: a.playStyle || null,
    recentMatches: points
      .slice(-12)
      .reverse()
      .map((p) => ({
        matchId: p.matchId,
        win: p.won,
        eloDelta:
          p.ratingAfter != null && p.ratingBefore != null
            ? Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10
            : null,
        kd: p.kdRatio ?? null,
        dmr: p.dmr ?? null,
        destruction: p.destructionScore || 0,
        losses: p.lossesScore || 0,
        objectives: p.objectivesCaptured || 0,
        endTime: p.endTime
      }))
  }
}

export class PlayerService {
  constructor(
    private client: BatraceClient,
    private db: Db
  ) {}

  emptyCard(id: string, name: string, team?: string | null): PlayerCard {
    return {
      id,
      name,
      team: team ?? null,
      info: null,
      dragon: null,
      infoState: 'idle',
      dragonState: 'idle',
      lastSeen: this.lastSeen(id)
    }
  }

  /** 本地库里上一次算过的分数（「上次遇到 6.2，这次 7.8」） */
  lastSeen(pid: string): { score: number; at: number } | null {
    const row = this.db.get<{ at: number; json: string }>(
      'SELECT at, json FROM card WHERE pid = ? ORDER BY at DESC LIMIT 1',
      [pid]
    )
    if (!row) return null
    try {
      const c = JSON.parse(row.json) as PlayerCard
      const v = c.dragon && !('error' in c.dragon) ? (c.dragon as DragonScore).value : null
      return v == null ? null : { score: v, at: row.at }
    } catch {
      return null
    }
  }

  /** 存档：按（玩家, 对局）存一份，重启还在，翻档案也不用重查 */
  saveCard(card: PlayerCard, fid: string | null): void {
    const at = Date.now()
    this.db.run('INSERT OR REPLACE INTO card (pid, fid, at, json) VALUES (?, ?, ?, ?)', [
      card.id,
      fid || '',
      at,
      JSON.stringify({ ...card, updatedAt: at })
    ])
    this.db.run(
      `INSERT INTO player (pid, name, names, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(pid) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`,
      [card.id, card.name, JSON.stringify([card.name]), at, at]
    )
    const elo = card.info?.elo
    if (elo != null) {
      this.db.run('INSERT OR REPLACE INTO elo_snapshot (pid, at, elo, source) VALUES (?, ?, ?, ?)', [
        card.id,
        at,
        elo,
        'analysis'
      ])
    }
  }

  /** 第一轮：基础档案（1 次请求） */
  async loadInfo(card: PlayerCard, force?: boolean): Promise<PlayerCard> {
    card.infoState = 'loading'
    try {
      const a = await this.client.analysisPlayer(card.id, force)
      card.info = toInfo(card.id, a)
      card.infoState = card.info ? 'done' : 'error'
      if (!card.info) card.error = '无数据'
      if (card.info && !card.name) card.name = card.info.name || card.name
    } catch (e) {
      card.infoState = 'error'
      card.error = String((e as Error)?.message || e)
    }
    return card
  }

  /** 第二轮：龙区分（再 1 次请求；角色构成用第一轮已经缓存的分析） */
  async loadDragon(card: PlayerCard, force?: boolean): Promise<PlayerCard> {
    card.dragonState = 'loading'
    try {
      const analysis = this.client.peek<AnalysisPlayer>('analysis:' + card.id, 6 * 3600 * 1000)
      const res = await this.client.playerMatchesPage(card.id, 20, force)
      const r = computeDragonScore({
        stbid: card.id,
        matches: res?.matches || [],
        categoryPreferences: analysis?.categoryPreferences,
        highlightUnits: analysis?.highlightUnits
      })
      if ('error' in r) {
        card.dragon = null
        card.dragonState = 'done' // 没有排位局不算失败，就是没分
      } else {
        for (const row of r.rows as { mapId?: number; map?: string }[]) {
          row.map = row.mapId != null ? mapName(row.mapId) : ''
        }
        card.dragon = r
        card.dragonState = 'done'
      }
    } catch (e) {
      card.dragonState = 'error'
      card.error = String((e as Error)?.message || e)
    }
    return card
  }

  /** 单个玩家：两步一起（搜索页点进来的走这个） */
  async fullCard(stbid: string, opts: { name?: string; refresh?: boolean; fid?: string | null } = {}): Promise<PlayerCard> {
    const card = this.emptyCard(stbid, opts.name || '')
    await this.loadInfo(card, opts.refresh)
    await this.loadDragon(card, opts.refresh)
    this.saveCard(card, opts.fid ?? null)
    return card
  }

  /** 存档里的卡片（点开先显示它，再决定要不要刷新） */
  cached(pid: string, maxAgeMs = 6 * 3600 * 1000): PlayerCard | null {
    const row = this.db.get<{ at: number; json: string }>(
      'SELECT at, json FROM card WHERE pid = ? ORDER BY at DESC LIMIT 1',
      [pid]
    )
    if (!row || Date.now() - row.at > maxAgeMs) return null
    try {
      return JSON.parse(row.json) as PlayerCard
    } catch {
      return null
    }
  }
}
