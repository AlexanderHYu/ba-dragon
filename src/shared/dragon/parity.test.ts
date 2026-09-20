// 对拍：新版（TS）和 4.0.x 老版（JS）在同一批真实对局上必须算出一模一样的结果。
// 需要本机有老仓库和缓存的对局数据，缺任何一个就跳过（CI 上不会跑）。
//   BA_LEGACY  老仓库路径，默认 H:/github/brokenarrow-log-maggot
//   BA_DATA    老版数据目录，默认 %APPDATA%/broken-arrow-log-assistant
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MatchInfo } from '../types/batrace'
import { analyzeMatch } from './score'
import { awardTitles, titleMetrics } from './titles'
import { buildMatchReport } from '../match/report'

const LEGACY = process.env.BA_LEGACY || 'H:/github/brokenarrow-log-maggot'
const DATA = process.env.BA_DATA || join(process.env.APPDATA || '', 'broken-arrow-log-assistant')
const CACHE = join(DATA, 'batrace-cache.json')
const legacyScore = join(LEGACY, 'src', 'dragonScore.js')

const ready = existsSync(legacyScore) && (existsSync(CACHE) || existsSync(join(LEGACY, 'backtest-data')))

/** 老仓库 backtest-data/ 里采集的对局（m-<id>.json），建模和对拍都用这批 */
function sampleMatches(): { fid: string; mi: MatchInfo }[] {
  const dir = join(LEGACY, 'backtest-data')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith('m-') && f.endsWith('.json'))
    .map((f) => ({
      fid: f.slice(2, -5),
      mi: (JSON.parse(readFileSync(join(dir, f), 'utf8')) as { matchInfo: MatchInfo }).matchInfo
    }))
    .filter((x) => x.mi?.Data)
}

/** 缓存里所有 match:<id> 的 matchInfo */
function cachedMatches(): { fid: string; mi: MatchInfo }[] {
  const c = JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, { value?: unknown }>
  const out: { fid: string; mi: MatchInfo }[] = []
  for (const [k, v] of Object.entries(c)) {
    if (!k.startsWith('match:')) continue
    const val = v?.value as { matchInfo?: MatchInfo } | MatchInfo | undefined
    const mi = (val as { matchInfo?: MatchInfo })?.matchInfo || (val as MatchInfo)
    if (mi?.Data) out.push({ fid: k.slice(6), mi })
  }
  return out
}

describe.runIf(ready)('和 4.0.x 老版对拍', () => {
  // describe.skip 仍然会执行这个函数体来收集用例，所以 require 必须放在这道门后面
  if (!ready) return
  const require = createRequire(import.meta.url)
  const oldScore = require(legacyScore)
  const oldTitles = require(join(LEGACY, 'src', 'matchTitles.js'))
  // 优先用采集的样本（上千局），没有就用本机缓存的那几局
  const sample = sampleMatches()
  const matches = sample.length ? sample : cachedMatches()

  it('缓存里有对局可以对拍', () => {
    expect(matches.length).toBeGreaterThan(0)
  })

  it('单局复盘的龙/区/泯、称号、净交换完全一致', () => {
    for (const { fid, mi } of matches) {
      const a = analyzeMatch(mi, fid)
      const b = oldScore.analyzeMatch(mi, fid)
      expect(JSON.parse(JSON.stringify(a)), '对局 ' + fid).toEqual(JSON.parse(JSON.stringify(b)))
    }
  })

  it('单局复盘页的所有数字完全一致', () => {
    const oldReport = require(join(LEGACY, 'src', 'matchReport.js'))
    for (const { fid, mi } of matches) {
      const review = analyzeMatch(mi, fid)
      const a = buildMatchReport(mi, { fid, review })
      const b = oldReport.buildMatchReport(mi, { fid, review: oldScore.analyzeMatch(mi, fid) })
      expect(JSON.parse(JSON.stringify(a)), '对局 ' + fid).toEqual(JSON.parse(JSON.stringify(b)))
    }
  })

  it('称号的原始指标完全一致', () => {
    for (const { fid, mi } of matches) {
      expect(titleMetrics(mi), '对局 ' + fid).toEqual(oldTitles.titleMetrics(mi))
      expect(awardTitles(mi, { winnerTeam: 0 }), '对局 ' + fid).toEqual(
        oldTitles.awardTitles(mi, { winnerTeam: 0 })
      )
    }
  })
})
