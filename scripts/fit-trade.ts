// 交换加权的缩放系数 + 效果检查。
// 用老仓库 backtest-data/ 里采集的对局（m-<id>.json），算出 TRADE_NORM，
// 再对比加权前后各兵种玩家的单局分，确认「普通人不动、只在兵种之间挪分」。
//   npx vite-node -c vitest.config.ts scripts/fit-trade.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchInfo } from '../src/shared/types/batrace'
import { ROLE_KEYS, type RoleKey } from '../src/shared/dragon/model'
import { rolesFromUnits } from '../src/shared/dragon/roles'
import { TRADE_NORM, analyzeMatch, isRated, tradeMult } from '../src/shared/dragon/score'

const DIR = process.env.BA_DATA_DIR || 'H:/github/brokenarrow-log-maggot/backtest-data'
if (!existsSync(DIR)) throw new Error('没有 backtest-data：' + DIR)
const matches = readdirSync(DIR)
  .filter((f) => f.startsWith('m-') && f.endsWith('.json'))
  .map((f) => ({
    fid: f.slice(2, -5),
    mi: (JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { matchInfo: MatchInfo }).matchInfo
  }))
  .filter((x) => x.mi?.Data)

// 1) 缩放：全体排位玩家的 log2 平均倍数（未缩放）
let sk = 0
let sl = 0
let n = 0
for (const { mi } of matches) {
  for (const p of Object.values(mi.Data || {})) {
    if (!isRated(p)) continue
    const t = tradeMult(p, rolesFromUnits(p))
    sk += Math.log2(t.k / TRADE_NORM.kill)
    sl += Math.log2(t.l / TRADE_NORM.loss)
    n++
  }
}
const norm = { kill: +Math.pow(2, -sk / n).toFixed(4), loss: +Math.pow(2, -sl / n).toFixed(4) }
console.log('玩家局数', n, '→ TRADE_NORM =', JSON.stringify(norm), '（当前', JSON.stringify(TRADE_NORM) + '）')

// 2) 效果：按主兵种分组，看单局分（1~10）平均变了多少
const acc: Record<string, { n: number; d: number; up: number; down: number; mark: number }> = {}
let all = { n: 0, d: 0, abs: 0, markFlip: 0 }
for (const { fid, mi } of matches) {
  const a = analyzeMatch(mi, fid, { trade: false })
  const b = analyzeMatch(mi, fid)
  for (const pb of b.players) {
    const pa = a.players.find((x) => x.id === pb.id)
    if (!pa || !pb.rated || !pb.roleKnown) continue
    const top = ROLE_KEYS.reduce((x, y) => (pb.roles[x] >= pb.roles[y] ? x : y)) as RoleKey
    // 主兵种：花钱最多的那个；占比不到 40% 的算混编
    const g = pb.roles[top] >= 40 ? top : 'mixed'
    const r = (acc[g] ||= { n: 0, d: 0, up: 0, down: 0, mark: 0 })
    const d = pb.score - pa.score
    r.n++
    r.d += d
    if (d >= 0.5) r.up++
    if (d <= -0.5) r.down++
    if (pa.mark !== pb.mark) r.mark++
    all.n++
    all.d += d
    all.abs += Math.abs(d)
    if (pa.mark !== pb.mark) all.markFlip++
  }
}
console.log('\n主兵种     人次   平均变化   涨≥0.5  跌≥0.5  龙区泯变了')
for (const [g, r] of Object.entries(acc).sort((x, y) => y[1].n - x[1].n)) {
  console.log(
    g.padEnd(8),
    String(r.n).padStart(6),
    (r.d / r.n >= 0 ? '+' : '') + (r.d / r.n).toFixed(2).padStart(8),
    (((r.up / r.n) * 100).toFixed(0) + '%').padStart(8),
    (((r.down / r.n) * 100).toFixed(0) + '%').padStart(7),
    (((r.mark / r.n) * 100).toFixed(0) + '%').padStart(9)
  )
}
console.log(
  '\n全体', all.n, '人次：平均变化', (all.d / all.n).toFixed(3), '，平均绝对变化', (all.abs / all.n).toFixed(2),
  '，龙区泯变了', ((all.markFlip / all.n) * 100).toFixed(1) + '%'
)
