// ================= 本地录像管理（userData/replays/*.mp4，旧版 *.webm） =================
// 本模块只动本地文件。
// 录像文件名沿用 4.0.x 的编码（老录像还在同一个目录里，不能认不出来）：
//   {fid}__{uploaderId}__{teamId}__{mapId}__{ts}__{nameHex}.mp4
//   nameHex = 上传者名字 UTF-8 的 hex（避免分隔符/特殊字符冲突）
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 本地录像文件：新版 .mp4，旧版 .webm（以 . 开头的是录制中的临时目录/文件） */
export const REPLAY_EXT_RE = /\.(webm|mp4)$/i

export function isReplayFile(name: string): boolean {
  const n = String(name || '')
  return REPLAY_EXT_RE.test(n) && !n.startsWith('.')
}

export interface ReplayKeyParts {
  fid: string | number
  uploaderId: string | number
  uploaderName?: string
  teamId?: number | null
  mapId?: number | null
  ts?: number
  ext?: string
}

/** 编码录像对象名（带 replays/ 前缀；本地保存时取最后一段即可） */
export function encodeReplayKey({ fid, uploaderId, uploaderName, teamId, mapId, ts, ext }: ReplayKeyParts): string {
  const nameHex = Buffer.from(String(uploaderName || ''), 'utf8').toString('hex')
  return (
    'replays/' +
    String(fid) +
    '__' +
    String(uploaderId) +
    '__' +
    (teamId == null ? '' : teamId) +
    '__' +
    (mapId == null ? '' : mapId) +
    '__' +
    (ts || Date.now()) +
    '__' +
    nameHex +
    '.' +
    (ext || 'mp4')
  )
}

export interface ReplayKeyMeta {
  key: string
  fid: string
  uploaderId: string
  teamId: number | null
  mapId: number | null
  ts: number
  uploaderName: string
}

export function parseReplayKey(key: string): ReplayKeyMeta | null {
  const base = String(key || '').split('/').pop() || ''
  const m = base.match(/^(.*)\.(webm|mp4)$/i)
  if (!m) return null
  const parts = m[1].split('__')
  if (parts.length < 6) return null
  const [fid, uploaderId, teamId, mapId, ts, nameHex] = parts
  let uploaderName = ''
  try {
    uploaderName = Buffer.from(nameHex, 'hex').toString('utf8')
  } catch {
    /* 名字解不出来就留空 */
  }
  return {
    key,
    fid,
    uploaderId,
    teamId: teamId === '' ? null : Number(teamId),
    mapId: mapId === '' ? null : Number(mapId),
    ts: Number(ts) || 0,
    uploaderName
  }
}

const NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(webm|mp4)$/i

function safeName(key: string): string | null {
  const name = String(key || '').split(/[\\/]/).pop() || ''
  return NAME_RE.test(name) ? name : null
}

export interface LocalReplay {
  /** 文件名，也是各处用的 key */
  id: string
  fid: string
  mapId: number | null
  map: string
  uploaderId: string
  uploaderName: string
  teamId: number | null
  size: number
  createdAt: number
  localPath: string
  source: 'local'
}

/** 扫描目录：返回本地录像列表，时间倒序 */
export function localReplayList(dir: string, mapName?: (id: number) => string): LocalReplay[] {
  const out: LocalReplay[] = []
  try {
    if (!existsSync(dir)) return out
    for (const f of readdirSync(dir)) {
      if (!isReplayFile(f)) continue
      const meta = parseReplayKey(f)
      const full = join(dir, f)
      let size = 0
      let mtime = 0
      try {
        const st = statSync(full)
        size = st.size
        mtime = st.mtimeMs
      } catch {
        /* 文件刚被删掉：按 0 处理 */
      }
      out.push({
        id: f,
        fid: meta ? meta.fid : f.replace(REPLAY_EXT_RE, ''),
        mapId: meta ? meta.mapId : null,
        map: meta && meta.mapId != null && mapName ? mapName(meta.mapId) : '',
        uploaderId: meta ? meta.uploaderId : '',
        uploaderName: meta ? meta.uploaderName : '',
        teamId: meta ? meta.teamId : null,
        size,
        createdAt: mtime || 0,
        localPath: full,
        source: 'local'
      })
    }
  } catch {
    /* 目录读不了：当作没有录像 */
  }
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return out
}

export function localReplayDelete(dir: string, key: string): { ok: boolean; message: string } {
  const name = safeName(key)
  if (!name) return { ok: false, message: '无效文件名' }
  const full = join(dir, name)
  try {
    if (!existsSync(full)) return { ok: false, message: '文件不存在' }
    unlinkSync(full)
    return { ok: true, message: '已删除本地录像' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** days>0 删 N 天前；days=0 全部删除。返回删除条数。 */
export function localReplayClean(dir: string, days: number): number {
  let removed = 0
  try {
    if (!existsSync(dir)) return removed
    const cutoff = days > 0 ? Date.now() - days * 24 * 3600 * 1000 : Infinity
    for (const f of readdirSync(dir)) {
      if (!isReplayFile(f)) continue
      const full = join(dir, f)
      try {
        const st = statSync(full)
        if (days > 0 && st.mtimeMs > cutoff) continue
        unlinkSync(full)
        removed++
      } catch {
        /* 这个删不掉就跳过 */
      }
    }
  } catch {
    /* 目录读不了：什么都不删 */
  }
  return removed
}

/** 本地录像的绝对路径（文件名经过白名单校验，防止路径穿越） */
export function localReplayPath(dir: string, key: string): string | null {
  const name = safeName(key)
  if (!name) return null
  const full = join(dir, name)
  return existsSync(full) ? full : null
}

/** 列表里补出来的对局信息（由调用方从追踪库 / 对局档案里查） */
export interface ReplayMatchInfo {
  map?: string
  endTime?: number
  firstSeenAt?: number
  mode?: string | null
  restarted?: boolean
  localWon?: boolean | null
}

export interface EnrichedReplay extends LocalReplay {
  endTime: number
  mode: string | null
  restarted: boolean
  localWon: boolean | null
}

// 与对局档案/追踪库联动：按 fid 反查地图名等，避免录像文件 mapId 缺失时显示"未知地图"
// matchOf = 追踪库里的这一局；archive = 对局档案（只用它的 map），同一 fid 取先出现的那条
export function enrichReplayMaps(
  list: LocalReplay[],
  matchOf: (fid: string) => ReplayMatchInfo | null | undefined,
  archive: { fid?: string | number; map?: string }[] | null,
  mapName: (id: number) => string
): EnrichedReplay[] {
  const archMap: Record<string, string> = {}
  try {
    for (const a of archive || []) {
      if (a && a.fid && archMap[String(a.fid)] == null) archMap[String(a.fid)] = a.map || ''
    }
  } catch {
    /* 档案读不了就只靠追踪库 */
  }
  return (list || []).map((it) => {
    const rec = matchOf(String(it.fid))
    const archMapName = archMap[String(it.fid)] || ''
    const trkMap = rec && rec.map && !/^map:\d+$/.test(rec.map) ? rec.map : ''
    const map = archMapName || trkMap || (it.mapId != null ? mapName(it.mapId) : it.map || '') || ''
    return {
      ...it,
      map,
      endTime: (rec && (rec.endTime || rec.firstSeenAt)) || it.createdAt || 0,
      mode: rec ? rec.mode || null : null,
      restarted: !!(rec && rec.restarted),
      localWon: rec && rec.localWon != null ? !!rec.localWon : null
    }
  })
}
