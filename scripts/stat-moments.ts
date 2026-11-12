// 关键时刻的门槛校准：拿一批单局原始数据（/api/match 的 matchInfo，一局一个 JSON 文件），
// 统计每类时刻出现在多少局里、每局平均几条，用来定 shared/match/moments.ts 里的默认门槛。
// 目标：每类出现在一部分对局里（不是每局都有），进本局要点的总条数每局几条，不刷屏。
//   npx vite-node -c vitest.config.ts scripts/stat-moments.ts -- <目录>
// 只读本地文件，不发请求。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeMatch } from '../src/shared/dragon'
import { buildMatchReport, topMoments, type Moment } from '../src/shared/match'
import { BUNDLED, hasBundled } from '../src/shared/game'
import type { MatchInfo } from '../src/shared/types/batrace'

const dir = process.argv.slice(2).filter((a) => a !== '--')[0]
if (!dir) throw new Error('用法：stat-moments.ts -- <放 matchInfo JSON 的目录>')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
const subs = new Map<string, { matches: number; total: number }>()
let top = 0
let n = 0
const samples: Moment[] = []
for (const f of files) {
  const mi = JSON.parse(readFileSync(join(dir, f), 'utf8')) as MatchInfo
  if (!mi?.Data) continue
  const fid = f.replace(/\.json$/, '')
  const r = buildMatchReport(mi, {
    fid,
    review: analyzeMatch(mi, fid),
    game: hasBundled() ? BUNDLED : undefined,
    gameSource: 'bundled',
    // 试门槛：MOMENT_OPTS='{"reapKills":4}'
    moments: process.env.MOMENT_OPTS ? JSON.parse(process.env.MOMENT_OPTS) : undefined
  })
  n++
  const seen = new Set<string>()
  for (const m of r.moments) {
    const k = m.sub
    const s = subs.get(k) || { matches: 0, total: 0 }
    s.total++
    if (!seen.has(k)) s.matches++
    seen.add(k)
    subs.set(k, s)
  }
  const t = topMoments(r.moments)
  top += t.length
  if (samples.length < 12) samples.push(...t.slice(0, 2))
}
console.log('对局', n)
for (const [k, s] of [...subs.entries()].sort()) {
  console.log(k.padEnd(12), '出现在', ((s.matches / n) * 100).toFixed(0).padStart(3) + '% 的局', ' 每局平均', (s.total / n).toFixed(2))
}
console.log('进本局要点：每局平均', (top / n).toFixed(2), '条')
for (const m of samples.slice(0, 12)) console.log('·', m.kind, m.text, m.detail ? '｜' + m.detail : '')
