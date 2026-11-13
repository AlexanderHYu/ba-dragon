// ================= 封禁监控 =================
// 4.0.x 是每小时轮询一次封禁名单。改成：启动时查一次，其余时候手动刷新。
// 名单拉回来后只标记「我见过的人」，没见过的不入库。
import type { BatraceClient } from './batrace'
import type { Db } from './db'

export interface BanResult {
  checkedAt: number
  /** 名单里有多少人 */
  total: number
  /** 这次新发现被封的熟人 */
  newly: { pid: string; name: string }[]
  /** 见过的人里所有被封的 */
  met: { pid: string; name: string; at: number | null }[]
}

const PAGE = 1000
/** 防止接口的 total 出错时一直翻下去 */
const MAX_PAGES = 20

export class BanService {
  private last: BanResult | null = null

  constructor(
    private client: BatraceClient,
    private db: Db
  ) {}

  latest(): BanResult | null {
    return this.last
  }

  async check(): Promise<BanResult> {
    // 名单按 rating 排序，只拿第一页就只有高分段的人，所以按 total 翻完（每页 1000，现在约 5 页）
    const list: { id: number | string; name: string }[] = []
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.client.leaderboardBan(PAGE, page * PAGE)
      const rows = res?.leaderboard || []
      list.push(...rows)
      if (rows.length < PAGE || list.length >= (res?.total ?? 0)) break
    }
    const at = Date.now()
    const newly: { pid: string; name: string }[] = []
    this.db.tx(() => {
      for (const p of list) {
        const pid = String(p.id)
        const known = this.db.get<{ banned: number }>('SELECT banned FROM player WHERE pid = ?', [pid])
        if (!known) continue // 没见过的人不入库，本地库只记我遇到过的
        if (!known.banned) newly.push({ pid, name: p.name })
        this.db.run('UPDATE player SET banned = 1, ban_seen_at = ? WHERE pid = ?', [at, pid])
      }
    })
    this.last = {
      checkedAt: at,
      total: list.length,
      newly,
      met: this.db
        .all<{ pid: string; name: string; ban_seen_at: number | null }>(
          'SELECT pid, name, ban_seen_at FROM player WHERE banned = 1 ORDER BY ban_seen_at DESC LIMIT 50'
        )
        .map((r) => ({ pid: r.pid, name: r.name, at: r.ban_seen_at }))
    }
    return this.last
  }
}
