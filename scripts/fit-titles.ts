// 称号阈值校准 + 出现率检查。
// 用老仓库 backtest-data/ 里采集的对局，按 SPECS 里的 target 重新算阈值和罕见度分布，
// 写回 src/shared/dragon/model.json（titles / titleDist），再统计每种称号实际发了多少、多少人有称号。
//   npx vite-node -c vitest.config.ts scripts/fit-titles.ts          只看，不写
//   npx vite-node -c vitest.config.ts scripts/fit-titles.ts --write  写回 model.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchInfo } from '../src/shared/types/batrace'
import { MODEL } from '../src/shared/dragon/model'
import { analyzeMatch } from '../src/shared/dragon/score'
import { calibrateTitles } from '../src/shared/dragon/titles'

const DIR = process.env.BA_DATA_DIR || 'H:/github/brokenarrow-log-maggot/backtest-data'
if (!existsSync(DIR)) throw new Error('没有 backtest-data：' + DIR)
const matches = readdirSync(DIR)
  .filter((f) => f.startsWith('m-') && f.endsWith('.json'))
  .map((f) => ({
    fid: f.slice(2, -5),
    mi: (JSON.parse(readFileSync(join(DIR, f), 'utf8')) as { matchInfo: MatchInfo }).matchInfo
  }))
  .filter((x) => x.mi?.Data)

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
if (process.argv.includes('--write')) {
  const { th, dist } = calibrateTitles(matches.map((m) => m.mi))
  const file = join(__dirname, '..', 'src', 'shared', 'dragon', 'model.json')
  const model = JSON.parse(readFileSync(file, 'utf8'))
  model.titles = { ...model.titles, ...th }
  model.titleDist = dist
  writeFileSync(file, JSON.stringify(model))
  Object.assign(MODEL.titles, th)
  MODEL.titleDist = dist
  console.log('\n新阈值', JSON.stringify(th))
  stats('重新校准后')
}
