// IPC 注册：通道名和类型来自 shared/ipc.ts，两边共用一份契约。
import { app, dialog, ipcMain, shell } from 'electron'
import { analyzeMatch } from '@shared/dragon'
import { buildMatchReport } from '@shared/match'
import type { ArchiveItem, IpcMap, PlayerCard, Settings } from '@shared/ipc'
import type { Services } from '../index'
import { detectLogDir } from '../services/config'
import { mapName } from '../services/players'

type Handler<K extends keyof IpcMap> = (arg: IpcMap[K][0]) => IpcMap[K][1] | Promise<IpcMap[K][1]>

export function registerIpc(s: Services): void {
  const on = <K extends keyof IpcMap>(ch: K, fn: Handler<K>): void => {
    ipcMain.handle(ch, (_e, arg) => fn(arg as IpcMap[K][0]))
  }

  on('config:get', () => s.config.all())
  on('config:set', (patch) => {
    const before = s.config.all()
    const next = s.config.set(patch as Partial<Settings>)
    if (before.logDir !== next.logDir || before.pollMs !== next.pollMs) s.watcher.restart()
    return next
  })
  on('config:selectDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择 GameLogs 目录' })
    if (r.canceled || !r.filePaths[0]) return null
    s.config.set({ logDir: r.filePaths[0] })
    s.watcher.restart()
    return r.filePaths[0]
  })
  on('config:detectDir', () => {
    const dir = detectLogDir()
    if (dir) {
      s.config.set({ logDir: dir })
      s.watcher.restart()
    }
    return dir
  })

  on('session:get', () => s.session())

  on('players:search', async (q) => {
    const query = String(q || '').trim()
    if (!query) return []
    const res = await s.client.searchPlayers(query, 20)
    // 搜索接口的 rating 是档案里的旧值，卡片里的 ELO 以本地快照/分析接口为准
    return (res?.players || []).map((p) => {
      const card = s.players.cached(String(p.stbid)) || s.players.emptyCard(String(p.stbid), p.name)
      card.name = p.name || card.name
      return card
    })
  })

  on('player:card', async ({ stbid, refresh }) => {
    const id = String(stbid)
    if (!refresh) {
      const cached = s.players.cached(id)
      if (cached && cached.dragonState === 'done') return cached
    }
    return s.players.fullCard(id, { refresh })
  })

  on('match:query', (arg) => {
    const players = (arg && 'players' in arg ? arg.players : null) || null
    if (players?.length) {
      void s.query.run(
        players.map((p) => ({ id: String(p.id), name: p.name, team: p.team ?? null })),
        { refresh: true }
      )
    } else {
      s.queryRoster({ refresh: true })
    }
  })
  on('match:state', () => s.query.current())

  on('match:report', async ({ fid, localIds }) => {
    try {
      const res = await s.client.matchById(fid)
      const mi = res?.matchInfo
      if (!mi?.Data || !Object.keys(mi.Data).length) return { error: 'notYet' }
      const review = analyzeMatch(mi, fid)
      const ids = localIds?.length ? localIds : localPlayerIds(s)
      const report = buildMatchReport(mi, { fid, review, localIds: ids, mapName })
      saveMatch(s, fid, mi, report)
      s.tracker.recordMatch(
        fid,
        report.players.map((p) => ({ id: p.id, name: p.name, team: p.team })),
        report.winnerTeam,
        ids
      )
      return report
    } catch (e) {
      return { error: String((e as Error)?.message || e) }
    }
  })

  // 对局档案：本地库里算过的 + 本次会话日志里打完但还没算的
  on('archive:list', () => {
    const rows = s.db.all<{
      fid: string
      map_id: number | null
      start_time: number | null
      duration_sec: number | null
      winner_team: number | null
    }>('SELECT fid, map_id, start_time, duration_sec, winner_team FROM match ORDER BY start_time DESC LIMIT 100')
    const localIds = new Set(localPlayerIds(s))
    const out: ArchiveItem[] = rows.map((r) => {
      // 不知道本机账号（日志还没读到名字）时就不查「我这局」
      const mineRow = localIds.size
        ? s.db.get<{ score: number | null; mark: string | null; team: number }>(
            'SELECT score, mark, team FROM match_player WHERE fid = ? AND pid IN (' +
              [...localIds].map(() => '?').join(',') +
              ') LIMIT 1',
            [r.fid, ...localIds]
          )
        : null
      return {
        fid: r.fid,
        map: mapName(r.map_id ?? undefined),
        startTime: r.start_time,
        durationSec: r.duration_sec,
        winnerTeam: r.winner_team,
        mine: mineRow
          ? { won: r.winner_team == null ? null : r.winner_team === mineRow.team, score: mineRow.score, mark: mineRow.mark }
          : null,
        cached: true
      }
    })
    const have = new Set(out.map((x) => x.fid))
    for (const m of s.parser.archived.slice().reverse()) {
      if (!m.fid || have.has(m.fid)) continue
      out.unshift({
        fid: m.fid,
        map: m.map,
        startTime: m.startTime,
        durationSec: m.durationSec,
        winnerTeam: null,
        mine: null,
        cached: false
      })
    }
    return out
  })

  // 上一局：日志里刚打完的那局
  on('match:prev', () => {
    const last = s.parser.lastEnded || s.parser.archived[s.parser.archived.length - 1] || null
    return { fid: last?.fid ?? null }
  })

  on('deck:list', () => ({
    found: s.decks.found(),
    dir: s.decks.decksDir,
    decks: s.decks.list(),
    backups: s.decks.backups()
  }))
  on('deck:backup', (arg) => s.decks.backup(arg && 'name' in arg ? arg.name : undefined))
  on('deck:restore', ({ name, overwrite }) => s.decks.restore(name, { overwrite }))

  on('tracker:bond', (pid) => s.tracker.bond(String(pid)))

  on('ban:get', () => s.bans.latest())
  on('ban:check', async () => {
    try {
      return await s.bans.check()
    } catch (e) {
      return { error: String((e as Error)?.message || e) }
    }
  })

  on('app:version', () => ({ current: app.getVersion(), latest: app.getVersion(), hasUpdate: false }))
  on('update:get', () => null)
  on('update:install', () => false)

  ipcMain.handle('shell:open', (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
}

/** 本机账号的 batrace ID：日志里名字和本机玩家名对得上的那个人 */
function localPlayerIds(s: Services): string[] {
  const snap = s.parser.snapshot()
  const name = snap.localName
  if (!name) return []
  const ids = new Set<string>()
  for (const m of [snap.current, ...s.parser.archived]) {
    for (const p of m?.players || []) if (p.name === name) ids.add(p.id)
  }
  for (const [id, n] of Object.entries(snap.lobbyPlayers || {})) if (n === name) ids.add(id)
  return [...ids]
}

/** 复盘算完顺手入库：对局、每局每人、每局每人每单位（配装原样存着） */
function saveMatch(
  s: Services,
  fid: string,
  mi: Parameters<typeof analyzeMatch>[0],
  report: ReturnType<typeof buildMatchReport>
): void {
  try {
    s.db.tx(() => {
      s.db.run(
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
        s.db.run(
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
          s.db.run(
            `INSERT OR REPLACE INTO match_unit
             (fid, pid, unit_id, options, deployed, refunded, dead, spent, lost, dmg, kills, destr)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [fid, p.id, u.id, '', u.deployed, u.refunded, u.dead, u.spent, u.lost, u.dmg, u.kills, u.destr]
          )
        }
      }
    })
  } catch {
    /* 入库失败不影响看复盘 */
  }
}

export type { PlayerCard }
