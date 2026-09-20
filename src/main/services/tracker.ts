// ================= 玩家追踪 / 调查羁绊 =================
// 复盘算完就顺手把「谁和谁在哪一局、同队还是敌对、输赢」记进本地库，
// 之后查一个人只要一条带索引的 SQL，不用像 4.0.x 那样把整个 JSON 读进来遍历。
import type { Db } from './db'

export interface Bond {
  pid: string
  name: string
  /** 一起打过几局（有我在场的局） */
  matches: number
  together: number
  againstYou: number
  /** 同队时的胜负 */
  withWin: number
  withLose: number
  /** 敌对时我方的胜负 */
  vsWin: number
  vsLose: number
  firstSeen: number | null
  lastSeen: number | null
  names: string[]
  banned: boolean
  /** 他在这些局里的平均龙区分 */
  avgScore: number | null
}

export class Tracker {
  constructor(private db: Db) {}

  /** 复盘入库时调用：给本机账号和其他人记一条相遇 */
  recordMatch(
    fid: string,
    players: { id: string; name: string; team: number }[],
    winnerTeam: number | null,
    localIds: string[]
  ): void {
    const locals = players.filter((p) => localIds.includes(p.id))
    if (!locals.length) return
    const at = Date.now()
    for (const me of locals) {
      const won = winnerTeam == null ? null : winnerTeam === me.team
      for (const p of players) {
        if (p.id === me.id) continue
        this.db.run(
          'INSERT OR REPLACE INTO encounter (fid, pid, local_id, same_team, won, at) VALUES (?, ?, ?, ?, ?, ?)',
          [fid, p.id, me.id, p.team === me.team ? 1 : 0, won == null ? null : won ? 1 : 0, at]
        )
        this.touchPlayer(p.id, p.name, at)
      }
    }
  }

  /** 记一个人的名字（改名了就往 names 里追加一个） */
  private touchPlayer(pid: string, name: string, at: number): void {
    const row = this.db.get<{ names: string }>('SELECT names FROM player WHERE pid = ?', [pid])
    if (!row) {
      this.db.run('INSERT INTO player (pid, name, names, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)', [
        pid,
        name,
        JSON.stringify(name ? [name] : []),
        at,
        at
      ])
      return
    }
    let names: string[] = []
    try {
      names = JSON.parse(row.names || '[]') as string[]
    } catch {
      names = []
    }
    if (name && !names.includes(name)) names.push(name)
    this.db.run('UPDATE player SET name = ?, names = ?, last_seen = ? WHERE pid = ?', [
      name,
      JSON.stringify(names),
      at,
      pid
    ])
  }

  /** 调查一个人：见过几次、同队/敌对的胜负、改名历史、有没有被封 */
  bond(pid: string): Bond | null {
    const p = this.db.get<{ pid: string; name: string; names: string; first_seen: number; last_seen: number; banned: number }>(
      'SELECT pid, name, names, first_seen, last_seen, banned FROM player WHERE pid = ?',
      [pid]
    )
    const rows = this.db.all<{ same_team: number; won: number | null }>(
      'SELECT same_team, won FROM encounter WHERE pid = ?',
      [pid]
    )
    if (!p && !rows.length) return null
    const withRows = rows.filter((r) => r.same_team === 1)
    const vsRows = rows.filter((r) => r.same_team === 0)
    const score = this.db.get<{ avg: number | null }>(
      'SELECT AVG(score) AS avg FROM match_player WHERE pid = ? AND score IS NOT NULL',
      [pid]
    )
    let names: string[] = []
    try {
      names = JSON.parse(p?.names || '[]') as string[]
    } catch {
      names = p?.name ? [p.name] : []
    }
    return {
      pid,
      name: p?.name || '',
      matches: rows.length,
      together: withRows.length,
      againstYou: vsRows.length,
      withWin: withRows.filter((r) => r.won === 1).length,
      withLose: withRows.filter((r) => r.won === 0).length,
      vsWin: vsRows.filter((r) => r.won === 1).length,
      vsLose: vsRows.filter((r) => r.won === 0).length,
      firstSeen: p?.first_seen ?? null,
      lastSeen: p?.last_seen ?? null,
      names,
      banned: !!p?.banned,
      avgScore: score?.avg != null ? Math.round(score.avg * 10) / 10 : null
    }
  }

  /** 见过的人里被封的那些 */
  bannedMet(): { pid: string; name: string; at: number | null }[] {
    return this.db
      .all<{ pid: string; name: string; ban_seen_at: number | null }>(
        'SELECT pid, name, ban_seen_at FROM player WHERE banned = 1 ORDER BY ban_seen_at DESC LIMIT 50'
      )
      .map((r) => ({ pid: r.pid, name: r.name, at: r.ban_seen_at }))
  }
}
