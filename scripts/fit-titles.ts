// 称号阈值校准 + 出现率检查。
// 用 scripts/collect-dragon-data.mjs 采集的对局（BA_DATA_DIR，老数据在老仓库 backtest-data/），按 SPECS 里的 target 重新算阈值和罕见度分布，
// 写回 src/shared/dragon/model.json（titles / titleDist），再统计每种称号实际发了多少、多少人有称号。
//   npx vite-node -c vitest.config.ts scripts/fit-titles.ts          只看（新阈值只在内存里试），不写
//   npx vite-node -c vitest.config.ts scripts/fit-titles.ts --write  写回 model.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchInfo } from '../src/shared/types/batrace'
import { MODEL } from '../src/shared/dragon/model'
import { analyzeMatch, isRated, teamOf } from '../src/shared/dragon/score'
import { calibrateTitles } from '../src/shared/dragon/titles'

// BA_DATA_DIR 可以用分号隔开多个目录，合在一起校准（同一局只算一次）
const DIRS = (process.env.BA_DATA_DIR || 'H:/github/ba-dragon-data/2026-11-11').split(';').filter(Boolean)
for (const d of DIRS) if (!existsSync(d)) throw new Error('没有数据目录：' + d)
const seen = new Set<string>()
const matches = DIRS.flatMap((DIR) =>
  readdirSync(DIR)
    .filter((f) => f.startsWith('m-') && f.endsWith('.json') && !seen.has(f) && !!seen.add(f))
    .map((f) => ({
      fid: f.slice(2, -5),
      mi: (JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { matchInfo: MatchInfo }).matchInfo
    }))
)
  .filter((x) => x.mi?.Data)
  // RANKED=1：只用 5v5 排位（随机抽号会抽到剧本、僵尸活动等非对战局，里面大量零战果的人会拉偏掉线类称号）
  .filter((x) => process.env.RANKED !== '1' || isRanked5v5(x.mi))
function isRanked5v5(mi: MatchInfo): boolean {
  const all = Object.values(mi.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1)
  return all.length === 10 && all.filter((p) => teamOf(p) === 0).length === 5 && all.every(isRated)
}

function stats(label: string): void {
  const shown: Record<string, number> = {}
  const cand: Record<string, number> = {}
  let players = 0
  let titled = 0
  for (const { fid, mi } of matches) {
    const r = analyzeMatch(mi, fid)
    for (const p of r.players) {
      players++
      if (p.titles.length) titled++
      for (const t of p.titles) shown[t.id] = (shown[t.id] || 0) + 1
    }
  }
  console.log(`\n[${label}] ${matches.length} 局 ${players} 人次：有称号 ${((titled / players) * 100).toFixed(1)}%`)
  const ids = Object.keys(shown).sort((a, b) => shown[b] - shown[a])
  console.log(ids.map((id) => `${id} ${((shown[id] / matches.length) * 100).toFixed(0)}%`).join('  '))
  void cand
}

stats('当前')
// 不带 --write 也算出新阈值、在内存里换上看效果，只是不写文件
const { th, dist } = calibrateTitles(matches.map((m) => m.mi))
console.log('\n称号        当前阈值    新阈值    变化')
for (const id of Object.keys(th)) {
  const a = MODEL.titles[id]
  const b = th[id]
  const pct = a ? (((b - a) / Math.abs(a)) * 100).toFixed(0) + '%' : '-'
  console.log(id.padEnd(12), String(a).padStart(9), String(b).padStart(9), pct.padStart(7))
}
Object.assign(MODEL.titles, th)
MODEL.titleDist = dist
stats('重新校准后')
if (process.argv.includes('--write')) {
  const file = join(__dirname, '..', 'src', 'shared', 'dragon', 'model.json')
  const model = JSON.parse(readFileSync(file, 'utf8'))
  model.titles = { ...model.titles, ...th }
  model.titleDist = dist
  writeFileSync(file, JSON.stringify(model))
  console.log('已写回 model.json')
}
