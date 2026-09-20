// ================= 对局名单查询 =================
// 进对局就把名单里每个人都算好，分两轮：
//   第一轮：10 个人的基础档案（约 12 秒，列表先填满 ELO/胜率/偏好兵种）
//   第二轮：回头补龙区分（再约 12 秒，分数陆续亮起来）
// 先查敌方那一队。算好的卡片存进本地库，点开就是读存档，不再发请求。
import type { PlayerCard, QueryState } from '@shared/ipc'
import type { LogPlayer } from '@shared/log'
import type { PlayerService } from './players'

/** 机器人、观战、空 ID：不查 */
const skippable = (p: { id?: string; name?: string }): boolean => {
  const id = String(p.id || '')
  if (!id || !/^\d+$/.test(id)) return true
  const name = String(p.name || '')
  return /^(AI|Bot)[ _-]/i.test(name)
}

export class QueryService {
  private state: QueryState = { fid: null, pass: null, done: 0, total: 0, prev: false, cards: [] }
  private running = false
  private cancelled = false

  constructor(
    private players: PlayerService,
    private emit: { state: (s: QueryState) => void; card: (c: PlayerCard) => void }
  ) {}

  current(): QueryState {
    return { ...this.state, cards: this.state.cards.map((c) => ({ ...c })) }
  }

  /** 正在查的时候又进了新对局：停掉旧的 */
  cancel(): void {
    if (this.running) this.cancelled = true
  }

  /**
   * @param roster 名单（日志里的 players 或大厅里的人）
   * @param opts.localName 本机玩家名（用来判断哪队是敌人，先查敌人）
   */
  async run(
    roster: LogPlayer[],
    opts: { fid?: string | null; localName?: string | null; prev?: boolean; refresh?: boolean } = {}
  ): Promise<void> {
    if (this.running) {
      this.cancel()
      // 等上一轮自己收尾
      for (let i = 0; i < 100 && this.running; i++) await new Promise((r) => setTimeout(r, 50))
    }
    const seen = new Set<string>()
    let list = roster.filter((p) => {
      if (skippable(p) || seen.has(p.id)) return false
      seen.add(p.id)
      return true
    })
    // 保险：一局最多 20 人
    list = list.slice(0, 20)
    // 先查敌方那队
    const localRow = opts.localName ? list.find((p) => String(p.name) === String(opts.localName)) : null
    if (localRow?.team) {
      const enemy = localRow.team === 'Alpha' ? 'Bravo' : 'Alpha'
      list = [...list.filter((p) => p.team === enemy), ...list.filter((p) => p.team !== enemy)]
    }
    if (!list.length) return

    this.running = true
    this.cancelled = false
    const fid = opts.fid ?? null
    const cards = list.map((p) => this.players.emptyCard(p.id, p.name, p.team))
    this.state = { fid, pass: 1, done: 0, total: cards.length, prev: !!opts.prev, cards }
    this.emit.state(this.current())

    try {
      // 第一轮：基础档案
      for (const card of cards) {
        if (this.cancelled) return
        await this.players.loadInfo(card, opts.refresh)
        this.state.done++
        this.emit.card({ ...card })
        this.emit.state(this.current())
      }
      // 第二轮：龙区分
      this.state.pass = 2
      this.state.done = 0
      this.emit.state(this.current())
      for (const card of cards) {
        if (this.cancelled) return
        await this.players.loadDragon(card, opts.refresh)
        this.players.saveCard(card, fid)
        this.state.done++
        this.emit.card({ ...card })
        this.emit.state(this.current())
      }
      this.state.pass = null
      this.emit.state(this.current())
    } finally {
      this.running = false
    }
  }
}
