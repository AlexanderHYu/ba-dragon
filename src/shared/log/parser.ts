// ================= 日志解析器 =================
// 把游戏日志的一行行文本翻译成结构化事件（对局开始/名单/地图/FID/结束等）。
// 解析规则来自实测日志格式，改动前先拿真实日志对一遍。纯逻辑，不碰文件系统（读文件是 main 的 watcher）。

const RE = {
  persona: /^Log: GetPersonaName\s+(.+)$/,
  loginSuccess: /^Log: \[AUTH\] Rest: Login success/,
  // 游戏后来给这几行加了 [LOBBY] 前缀（进厅那行现在**只有**带前缀的版本），
  // 前缀写成可选的，新旧日志都能认
  lobbyEnter: /^Log: (?:\[LOBBY\] )?Enter to lobby \(id: \d+\)/,
  lobbyExit: /^Log: (?:\[LOBBY\] )?Exit lobby/,
  incoming: /^Log: (?:\[LOBBY\] )?Incoming client (.*?):(\d+) to lobby/,
  outgoing: /^Log: (?:\[LOBBY\] )?Outgoing client (.*?):(\d+) exit/,
  battleStart: /^Log: Start loading battle\.\.\. map: ([^,]+),\s*scenario:\s*(.*)$/,
  playerList: /^Log: Player list:\s*$/,
  playerRow: /^ID: (\d+), Name: (.*?), Team: (\w+)$/,
  roomClient: /^Log: Room: \(GameRoom\|\d+\), Client: \(([^|]+)\|(\d+)\)$/,
  fid: /^Log: FID:(\d+)/,
  deck: /^Log: Deck set to: (.*)$/,
  totalPoints: /^Log: TOTAL POINTS: ([0-9.]+)$/,
  gameControllerDispose: /^Log: GameController dispose called/,
  netRoomEnter: /^Log: \[NET_ROOM\] GameRoom entered/,
  netRoomExit: /^Log: \[NET_ROOM\] GameRoom exited/,
  connClosed: /^Log: \[NET_ROOM\] Connection closed\. .*LiveTime: (\d+) sec/
}

/** 日志里的队伍名，Spectators 是观战 */
export type LogTeam = 'Alpha' | 'Bravo' | 'Spectators' | string | null

export interface LogPlayer {
  id: string
  name: string
  team: LogTeam
}

export interface LogMatch {
  fid: string | null
  map: string
  scenario: string
  startTime: number | null
  endTime: number | null
  durationSec: number | null
  points: number | null
  localDeck: string
  players: LogPlayer[]
  source: 'log'
}

export interface LogSnapshot {
  localName: string | null
  accountKey: string | null
  loginSeen: boolean
  lobbyPlayers: Record<string, string>
  /** 有没有从头看到自己进大厅那一行；没看到就不该反推房主（信息不全） */
  sawLobbyEnter: boolean
  currentDeck: string
  current: LogMatch | null
  archivedCount: number
}

export type LogEvent =
  | { type: 'localName'; data: string }
  | { type: 'lobbyReset'; data?: undefined }
  | { type: 'lobbyPlayers'; data: Record<string, string> }
  | { type: 'matchStart'; data: LogMatch }
  | { type: 'roster'; data: { fid: string | null; map: string; players: LogPlayer[] } }
  | { type: 'fid'; data: string }
  | { type: 'deck'; data: string }
  | { type: 'points'; data: number | null }
  | { type: 'matchMeta'; data: LogMatch }
  | { type: 'matchEnd'; data: LogMatch }

export type LogEventHandler = (type: LogEvent['type'], data?: unknown) => void

const emptyMatch = (): LogMatch => ({
  fid: null,
  map: '',
  scenario: '',
  startTime: null,
  endTime: null,
  durationSec: null,
  points: null,
  localDeck: '',
  players: [],
  source: 'log'
})

export class LogParser {
  private onEvent: LogEventHandler
  localName: string | null = null
  /** 大厅里的人：uid → 名字（开战前就能看到） */
  lobbyPlayers: Record<string, string> = {}
  sawLobbyEnter = false
  currentDeck = ''
  /** 当前对局（进行中或最近一次） */
  current: LogMatch | null = null
  archived: LogMatch[] = []
  /** 刚结束的对局（等网络统计补时长） */
  lastEnded: LogMatch | null = null
  private sessionLogin = false
  private sessionPersona: string | null = null
  private inPlayerList = false

  constructor(onEvent?: LogEventHandler) {
    this.onEvent = onEvent || ((): void => {})
  }

  /** 切换日志文件时调用 */
  reset(keepLocalName?: boolean): void {
    if (!keepLocalName) this.localName = null
    this.lobbyPlayers = {}
    this.sawLobbyEnter = false
    this.currentDeck = ''
    this.current = null
    this.archived = []
    this.inPlayerList = false
    this.sessionLogin = false
    this.sessionPersona = null
  }

  feed(lines: string[]): void {
    for (const line of lines) this.handleLine(line)
  }

  handleLine(raw: string): void {
    const line = (raw || '').replace(/\r$/, '')
    if (!line) return
    const ev = (type: LogEvent['type'], data?: unknown): void => this.onEvent(type, data)

    let m: RegExpExecArray | null

    if ((m = RE.persona.exec(line))) {
      this.localName = m[1].trim()
      this.sessionPersona = m[1].trim()
      ev('localName', this.localName)
      return
    }

    if (RE.loginSuccess.test(line)) {
      this.sessionLogin = true
      return
    }

    if (RE.lobbyEnter.test(line) || RE.lobbyExit.test(line)) {
      // 进入新大厅 = 清空上一局状态（存档过的已经存过）
      this.lobbyPlayers = {}
      // 进厅那行看到了，说明这个房间从头跟到尾，之后才有资格反推房主
      this.sawLobbyEnter = RE.lobbyEnter.test(line)
      this.current = null
      this.inPlayerList = false
      ev('lobbyReset')
      return
    }

    if ((m = RE.incoming.exec(line))) {
      this.lobbyPlayers[m[2]] = m[1].trim()
      ev('lobbyPlayers', { ...this.lobbyPlayers })
      return
    }
    if ((m = RE.outgoing.exec(line))) {
      delete this.lobbyPlayers[m[2]]
      ev('lobbyPlayers', { ...this.lobbyPlayers })
      return
    }

    if ((m = RE.battleStart.exec(line))) {
      this.beginMatch(m[1].trim(), m[2].trim())
      return
    }

    if (RE.netRoomEnter.test(line)) {
      // 进入对局房间（没有 battleStart 行时兜底）
      if (!this.current) this.beginMatch('', '')
      return
    }

    if (RE.playerList.test(line)) {
      this.inPlayerList = true
      return
    }

    if (this.inPlayerList && (m = RE.playerRow.exec(line))) {
      const id = m[1]
      const name = m[2].trim()
      const team = m[3] // Alpha / Bravo / Spectators
      if (this.current) {
        // 自定义房间里，人先是从 Room: Client: 那行进来的（没有队伍），
        // 开战时这份 Player list 才带队伍。所以已经认识的人要把队伍补上，不能直接跳过，
        // 否则整个房间的人永远是「没分队」。
        const known = this.current.players.find((p) => p.id === id)
        if (!known) {
          this.current.players.push({ id, name, team })
        } else if (known.team !== team || (name && known.name !== name)) {
          known.team = team
          if (name) known.name = name
        } else {
          return // 没变化，不用再广播一次
        }
        ev('roster', { fid: this.current.fid, map: this.current.map, players: this.current.players })
      }
      return
    }

    if ((m = RE.roomClient.exec(line))) {
      // 房间客户端名单（无队伍信息，作为名单兜底）
      const name = m[1].trim()
      const id = m[2]
      if (this.current && !this.current.players.some((p) => p.id === id)) {
        this.current.players.push({ id, name, team: null })
        ev('roster', { fid: this.current.fid, map: this.current.map, players: this.current.players })
      }
      return
    }

    if ((m = RE.fid.exec(line))) {
      if (this.current) this.current.fid = m[1]
      ev('fid', m[1])
      return
    }

    if ((m = RE.deck.exec(line))) {
      const v = m[1].trim()
      this.currentDeck = v && v.toLowerCase() !== 'null' ? v : ''
      if (this.current) this.current.localDeck = this.currentDeck
      ev('deck', this.currentDeck)
      return
    }

    if ((m = RE.totalPoints.exec(line))) {
      if (this.current) this.current.points = parseFloat(m[1])
      ev('points', this.current ? this.current.points : null)
      return
    }

    if ((m = RE.connClosed.exec(line))) {
      const sec = parseInt(m[1], 10)
      if (this.current && !this.current.durationSec) {
        this.current.durationSec = sec
        ev('matchMeta', { ...this.current })
      } else if (!this.current && this.lastEnded && !this.lastEnded.durationSec) {
        // 对局已结束，用网络统计补记时长
        this.lastEnded.durationSec = sec
        ev('matchMeta', { ...this.lastEnded })
      }
      return
    }

    if (RE.gameControllerDispose.test(line)) this.endMatch()

    if (RE.netRoomExit.test(line)) {
      // 离开对局房间（部分日志没有 dispose 行，作为兜底结束）
      if (this.current && this.current.players.length) this.endMatch()
    }
  }

  private beginMatch(map: string, scenario: string): void {
    // 上一局未结束时先收尾
    if (this.current && this.current.players.length) this.endMatch()
    this.current = emptyMatch()
    this.current.map = map
    this.current.scenario = scenario
    this.current.startTime = Date.now()
    this.current.localDeck = this.currentDeck
    this.inPlayerList = false
    this.onEvent('matchStart', { ...this.current })
  }

  private endMatch(): void {
    if (!this.current) return
    this.current.endTime = Date.now()
    if (!this.current.durationSec && this.current.startTime) {
      this.current.durationSec = Math.round((this.current.endTime - this.current.startTime) / 1000)
    }
    const done = { ...this.current }
    this.archived.push(done)
    this.lastEnded = done
    this.onEvent('matchEnd', done)
    this.current = null
    this.inPlayerList = false
  }

  snapshot(): LogSnapshot {
    return {
      localName: this.localName,
      accountKey: this.sessionPersona ? 'persona:' + this.sessionPersona : null,
      loginSeen: this.sessionLogin,
      lobbyPlayers: { ...this.lobbyPlayers },
      sawLobbyEnter: this.sawLobbyEnter,
      currentDeck: this.currentDeck,
      current: this.current ? { ...this.current } : null,
      archivedCount: this.archived.length
    }
  }
}
