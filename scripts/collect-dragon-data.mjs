// 龙区分建模数据采集（BATrace 运营方已同意使用其 API）。
// 数据存到仓库外（默认 H:/github/ba-dragon-data/<日期>，BA_DATA_DIR 可改），已有的文件不会重复请求。
// 规则见 CLAUDE.md「BATrace」：严格串行、间隔 ≥ 2 秒；Cloudflare 403 立即停止，不重试；
// 超时或 5xx 停 30 秒重试一次，再失败就停止。每个命令都有请求上限，开始前先把上限报给用户。
//
// 用法：
//   node scripts/collect-dragon-data.mjs probe <stbid...>                 每人 1 次 /api/players/matches?limit=100，定对局号段
//   node scripts/collect-dragon-data.mjs matches <起> <止> <要几局> <上限> <种子>
//        在号段里不放回随机抽对局号，拉 /api/match，凑够「更新后的 5v5 排位」就停
//   node scripts/collect-dragon-data.mjs players <上限>                   从随机对局里取全部玩家，
//        每人 /api/players/matches?limit=100 和 /api/analysis/player 各 1 次
// 环境变量：CUTOFF（更新日期，北京时间当天 0 点起算，默认 2026-10-21），GAP_MS（默认 2000，不能小于 2000）
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.BA_DATA_DIR || 'H:/github/ba-dragon-data/2026-11-11'
fs.mkdirSync(DIR, { recursive: true })
const BASE = 'https://bot.batrace.top'
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const HEADERS = {
  Accept: 'application/json',
  'User-Agent': `ba-dragon-collector/${VERSION} (+https://github.com/AlexanderHYu/ba-dragon)`,
  'X-Client': 'ba-dragon-collector'
}
const GAP_MS = Math.max(2000, Number(process.env.GAP_MS) || 2000)
const CUTOFF = Date.parse((process.env.CUTOFF || '2026-10-21') + 'T00:00:00+08:00') / 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const LOG = path.join(DIR, 'requests.log')

let sent = 0
let cap = 0
let last = 0

class Stop extends Error {}

/** 有缓存就读缓存；没有就发一次请求。返回 undefined 表示额度用完 */
async function cached(file, url) {
  const f = path.join(DIR, file)
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'))
  if (sent >= cap) return undefined
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait)
    sent++
    let err = null
    let r
    try {
      r = await fetch(BASE + url, { headers: HEADERS, signal: AbortSignal.timeout(30000) })
      last = Date.now()
      fs.appendFileSync(LOG, `${new Date().toISOString()} ${r.status} ${url}\n`)
      const json = /json/.test(r.headers.get('content-type') || '')
      if (r.status === 403) throw new Stop('HTTP 403' + (json ? '' : '（Cloudflare 防火墙）') + '，停止，不重试：' + url)
      if (r.status >= 500) err = new Error('服务器错误 HTTP ' + r.status + ' ' + url)
      else if (!json) throw new Stop('非 JSON 响应 HTTP ' + r.status + '（可能是人机验证或限流），停止：' + url)
    } catch (e) {
      last = Date.now()
      if (e instanceof Stop) throw e
      fs.appendFileSync(LOG, `${new Date().toISOString()} ERR ${url} ${e.message}\n`)
      err = e
    }
    if (!err) {
      // 带 JSON 的 404 = 没有数据，照样存下来，下次不再请求
      const j = await r.json()
      fs.writeFileSync(f, JSON.stringify(j))
      return j
    }
    if (attempt >= 1) throw new Stop(err.message + '（已重试一次）')
    console.log('  ' + err.message + '，30 秒后重试一次')
    await sleep(30000)
  }
}

const teamOf = (p) => (p.TeamId == null ? 0 : p.TeamId)
const isRated = (p) =>
  typeof p.OldRating === 'number' && typeof p.NewRating === 'number' && Math.abs(p.NewRating - p.OldRating) >= 0.01
/** 和 scripts/fit-outcome.ts 同一个筛选：10 人、两边各 5、全员有 ELO 变化 */
const isRanked5v5 = (mi) => {
  const all = Object.values(mi?.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1)
  return all.length === 10 && all.filter((p) => teamOf(p) === 0).length === 5 && all.every(isRated)
}
const goodMatch = (j) => j?.matchInfo?.Data && (j.matchInfo.EndTime || 0) >= CUTOFF && isRanked5v5(j.matchInfo)

/** mulberry32：固定种子，抽号可复现 */
const rng = (seed) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const progress = () => sent && sent % 25 === 0 && console.log('  已请求 ' + sent + ' 次')

async function main() {
  const [cmd, ...args] = process.argv.slice(2)
  const t0 = Date.now()
  if (cmd === 'probe') {
    cap = args.length
    for (const id of args) {
      const j = await cached('probe-' + id + '.json', '/api/players/matches?stbid=' + encodeURIComponent(id) + '&limit=100&offset=0')
      const ms = (j?.matches || []).filter((x) => x.data?.EndTime).sort((a, b) => a.data.EndTime - b.data.EndTime)
      console.log(id, '共', ms.length, '局')
      for (const x of [ms[0], ...ms.filter((_, i) => i % 10 === 0), ms.at(-1)].filter(Boolean))
        console.log('  ', x.matchId, new Date(x.data.EndTime * 1000).toISOString())
    }
  } else if (cmd === 'matches') {
    const [lo, hi, want, max, seed] = args.map(Number)
    cap = max
    const r = rng(seed)
    const tried = new Set()
    const idsFile = path.join(DIR, 'random-ids-' + seed + '.txt')
    const ids = fs.existsSync(idsFile) ? fs.readFileSync(idsFile, 'utf8').split(/\r?\n/).filter(Boolean) : []
    let good = 0
    // 先数已经拉过的，再按同一个随机序列续抽
    for (const id of ids) {
      tried.add(id)
      const f = path.join(DIR, 'm-' + id + '.json')
      if (fs.existsSync(f) && goodMatch(JSON.parse(fs.readFileSync(f, 'utf8')))) good++
    }
    while (good < want && tried.size < hi - lo + 1) {
      const id = String(lo + Math.floor(r() * (hi - lo + 1)))
      if (tried.has(id)) continue
      if (sent >= cap) break
      const j = await cached('m-' + id + '.json', '/api/match?matchid=' + id)
      tried.add(id)
      ids.push(id)
      fs.writeFileSync(idsFile, ids.join('\n') + '\n')
      if (goodMatch(j)) good++
      progress()
    }
    console.log(`抽了 ${ids.length} 个号，更新后的 5v5 排位 ${good} 局`)
  } else if (cmd === 'players') {
    cap = Number(args[0])
    const ids = new Set()
    for (const f of fs.readdirSync(DIR).filter((f) => /^random-ids-\d+\.txt$/.test(f)))
      for (const id of fs.readFileSync(path.join(DIR, f), 'utf8').split(/\r?\n/).filter(Boolean)) {
        const mf = path.join(DIR, 'm-' + id + '.json')
        if (!fs.existsSync(mf)) continue
        const j = JSON.parse(fs.readFileSync(mf, 'utf8'))
        if (goodMatch(j)) for (const p of Object.values(j.matchInfo.Data)) ids.add(String(p.Id))
      }
    const list = [...ids].sort((a, b) => Number(a) - Number(b))
    fs.writeFileSync(path.join(DIR, 'sample-players.txt'), list.join('\n') + '\n')
    console.log(`随机对局里共 ${list.length} 名玩家，需要请求 ${list.length * 2} 次（已缓存的不算）`)
    let done = 0
    for (const id of list) {
      const a = await cached('pm-' + id + '-o0.json', '/api/players/matches?stbid=' + encodeURIComponent(id) + '&limit=100&offset=0')
      if (a === undefined) break
      progress()
      const b = await cached('ap-' + id + '.json', '/api/analysis/player?stbid=' + encodeURIComponent(id))
      if (b === undefined) break
      progress()
      done++
    }
    console.log(`玩家：完成 ${done}/${list.length}`)
  } else {
    console.error('用法见文件头注释')
    process.exit(1)
  }
  console.log(`${cmd}：本次真实请求 ${sent} 次，用时 ${Math.round((Date.now() - t0) / 1000)} 秒`)
}

main().catch((e) => {
  console.error('停止：' + e.message + '（本次已请求 ' + sent + ' 次）')
  process.exit(1)
})
