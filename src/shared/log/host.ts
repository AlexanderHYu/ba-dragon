// 反推房主。
//
// 游戏**只在有人加入时**写一行 `Incoming client`，你进房之前就在里面的人一个都不写
// （翻过十份日志：进厅两秒内一条补播都没有）。所以房主在日志里是隐形的。
//
// 但开打时那份 `Player list` 是完整的，减掉「我进来之后才加入的」和「我自己」，
// 剩下的就是**我进房之前就在的人**——房主必在其中。只剩一个人时就能点名。
import type { LogPlayer } from './parser'

export interface HostGuess {
  /** 能确定是谁就给 pid，不能就是 null */
  id: string | null
  /** 我进房之前就在房里的人（房主在里面），人数 > 1 时只能给候选 */
  candidates: LogPlayer[]
  /** 我自己就是房主（我进来的时候房里没别人） */
  me: boolean
  /** 信息够不够（没从头看到进厅那行就不推） */
  known: boolean
}

export function guessHost(
  players: LogPlayer[],
  joinedAfterMe: Record<string, string>,
  localName: string | null,
  sawLobbyEnter: boolean
): HostGuess {
  const empty: HostGuess = { id: null, candidates: [], me: false, known: false }
  if (!sawLobbyEnter || !players.length) return empty
  const before = players.filter((p) => !joinedAfterMe[p.id] && (!localName || p.name !== localName))
  if (!before.length) return { id: null, candidates: [], me: true, known: true }
  return { id: before.length === 1 ? before[0].id : null, candidates: before, me: false, known: true }
}
