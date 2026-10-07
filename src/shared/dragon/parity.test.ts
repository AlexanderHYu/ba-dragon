// 对拍：新版（TS）和 4.0.x 老版（JS）在同一批真实对局上必须算出一模一样的结果。
// 需要本机有老仓库和缓存的对局数据，缺任何一个就跳过（CI 上不会跑）。
//   BA_LEGACY  老仓库路径，默认 H:/github/brokenarrow-log-maggot
//   BA_DATA    老版数据目录，默认 %APPDATA%/broken-arrow-log-assistant
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MatchInfo } from '../types/batrace'
import { analyzeMatch } from './score'
import { MODEL } from './model'
import { titleMetrics } from './titles'
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

  // v1.0.8 起故意和老版分开：K/D 按兵种加权（关掉 trade 就对得上）、称号阈值重新校准且每人最多两个。
  // 所以这里关掉加权、去掉称号再比，称号只比原始指标（最后一条）
  const noTitles = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v, (k, x) => (k === 'titles' ? undefined : x)))
  // v1.0.9 起胜负项不计分，百分位表和卡尔曼参数跟着重新拟合过。对拍时临时换回老版的这几项参数，
  // 这样其余流程（特征、标准化、掉线判定、复盘页的每个数字）仍然逐个对得上
  const oldModel = JSON.parse(readFileSync(join(LEGACY, 'src', 'dragonModel.json'), 'utf8')) as typeof MODEL
  const SWAP = ['weights', 'matchPct', 'playerPct', 'kalman'] as const
  const saved = Object.fromEntries(SWAP.map((k) => [k, MODEL[k]]))
  beforeAll(() => {
    for (const k of SWAP) Object.assign(MODEL, { [k]: oldModel[k] })
  })
  afterAll(() => {
    Object.assign(MODEL, saved)
  })

  it('单局复盘的龙/区/泯、净交换完全一致（不加权）', () => {
    for (const { fid, mi } of matches) {
      const a = analyzeMatch(mi, fid, { trade: false })
      const b = oldScore.analyzeMatch(mi, fid)
      expect(noTitles(a), '对局 ' + fid).toEqual(noTitles(b))
    }
  })

  it('单局复盘页的所有数字完全一致', () => {
    const oldReport = require(join(LEGACY, 'src', 'matchReport.js'))
    for (const { fid, mi } of matches) {
      const review = analyzeMatch(mi, fid, { trade: false })
      // 配装分组、配装真名、花费口径都是新版才有的：对拍时关掉分组，抹掉新增字段
      const a = buildMatchReport(mi, { fid, review, groupByLoadout: false })
      const b = oldReport.buildMatchReport(mi, { fid, review: oldScore.analyzeMatch(mi, fid) })
      const NEW_FIELDS = new Set(['options', 'loadout', 'priced', 'titles'])
      // 本局要点的措辞在新版改写过，只比条数和好/坏/中性
      const strip = (v: unknown): unknown =>
        JSON.parse(
          JSON.stringify(v, (k, x) =>
            NEW_FIELDS.has(k) ? undefined : k === 'insights' ? (x as { kind: string }[]).map((i) => i.kind) : x
          )
        )
      expect(strip(a), '对局 ' + fid).toEqual(strip(b))
    }
  })

  it('称号的原始指标完全一致', () => {
    for (const { fid, mi } of matches) {
      expect(titleMetrics(mi), '对局 ' + fid).toEqual(oldTitles.titleMetrics(mi))
    }
  })
})
