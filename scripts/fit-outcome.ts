// 龙区分去掉胜负项之后，重新拟合百分位表和卡尔曼参数。
// 做法照 4.0.x 的 scripts/fit-dragon-model.js 第 5、6 节，数据也是同一批（老仓库 backtest-data/，9/2 之后的对局），
// 只是分数用的是现在的算法（含兵种交换加权），胜负项权重取 W_OUT（默认 0）。
//   npx vite-node -c vitest.config.ts scripts/fit-outcome.ts           只看，不写
//   npx vite-node -c vitest.config.ts scripts/fit-outcome.ts --write   写回 src/shared/dragon/model.json
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchEntry, MatchInfo, PlayerData } from '../src/shared/types/batrace'
import { MODEL, type RoleShare } from '../src/shared/dragon/model'
import { rolesFromCareer, rolesFromUnits } from '../src/shared/dragon/roles'
import { absenceOf, isGone, titleMetrics } from '../src/shared/dragon/titles'
import {
  isRated,
  matchFeatures,
  scoreMatch,
  teamOf,
  tradeMult,
  type MatchFeatures,
  type TradeMult
} from '../src/shared/dragon/score'

const DIR = process.env.BA_DATA_DIR || 'H:/github/brokenarrow-log-maggot/backtest-data'
if (!existsSync(DIR)) throw new Error('没有 backtest-data：' + DIR)
const W_OUT = Number(process.env.W_OUT ?? 0)
const CUTOFF = Date.parse((process.env.CUTOFF || '2026-09-02') + 'T00:00:00+08:00') / 1000
const files = readdirSync(DIR)
const J = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'))
const after = (t: unknown): boolean => (Number(t) || 0) >= CUTOFF
const listFile = (f: string): string[] =>
  existsSync(join(DIR, f)) ? readFileSync(join(DIR, f), 'utf8').split(/\r?\n/).filter(Boolean) : []
const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const sd = (a: number[]): number => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}
const quantiles = (a: number[], n = 101): number[] => {
  const s = [...a].sort((x, y) => x - y)
  return Array.from({ length: n }, (_, i) => s[Math.round((i / (n - 1)) * (s.length - 1))])
}
const pearson = (x: number[], y: number[]): number => {
  const mx = mean(x)
  const my = mean(y)
  let a = 0
  let b = 0
  let c = 0
  for (let i = 0; i < x.length; i++) {
    a += (x[i] - mx) * (y[i] - my)
    b += (x[i] - mx) ** 2
    c += (y[i] - my) ** 2
  }
  return b && c ? a / Math.sqrt(b * c) : 0
}

// ---------- 数据（和老脚本同一套筛选） ----------
const randomIds = new Set(files.filter((f) => /^random-ids-\d+\.txt$/.test(f)).flatMap(listFile))
const isRanked5v5 = (mi: MatchInfo): boolean => {
  const all = Object.values(mi.Data || {}).filter((p) => teamOf(p) === 0 || teamOf(p) === 1)
  return all.length === 10 && all.filter((p) => teamOf(p) === 0).length === 5 && all.every(isRated)
}
const mById = new Map<string, MatchInfo>()
for (const f of files) {
  const m = /^m-(\d+)\.json$/.exec(f)
  if (!m || !randomIds.has(m[1])) continue
  const mi = J(f).matchInfo as MatchInfo
  if (mi?.Data && after(mi.EndTime) && isRanked5v5(mi)) mById.set(m[1], mi)
}
const pmById = new Map<string, MatchEntry>()
for (const f of files)
  if (/^pm-\d+-o\d+\.json$/.test(f))
    for (const x of (J(f).matches || []) as MatchEntry[]) if (after(x.data?.EndTime)) pmById.set(String(x.matchId), x)
const apById = new Map<string, any>()
for (const f of files) {
  const m = /^ap-(\d+)\.json$/.exec(f)
  if (m) {
    const a = J(f)
    apById.set(m[1], a.data || a)
  }
}

// ---------- 单场分：和 analyzeMatch / computeDragonScore 一样的算法，返回原始分 c ----------
interface Row {
  c: number
  minutes: number
  resid: number
  elo: number | null
  endTime: number
}
const rowOf = (f: MatchFeatures, roles: RoleShare, kind: 'match' | 'career'): Row => ({
  c: scoreMatch(f, roles, kind).c,
  minutes: f.minutes,
  resid: (f.S ?? 0) - f.E,
  elo: f.eloBefore,
  endTime: f.endTime || 0
})

MODEL.weights.out = W_OUT
const matchRows: Row[] = []
for (const [fid, mi] of mById) {
  const ms = titleMetrics(mi)
  const gone = ms.filter(isGone)
  const inactive = new Set(gone.map((m) => m.id))
  const absence = new Map(gone.map((m) => [m.id, absenceOf(m)] as const))
  const roles = new Map<string, RoleShare | null>()
  const trade = new Map<string, TradeMult>()
  for (const p of Object.values(mi.Data || {}) as PlayerData[]) {
    const r = rolesFromUnits(p)
    roles.set(String(p.Id), r)
    if (r) trade.set(String(p.Id), tradeMult(p, r))
  }
  for (const p of Object.values(mi.Data || {}) as PlayerData[]) {
    const f = matchFeatures({ matchId: fid, data: mi }, p.Id, { inactive, absence, trade })
    const r = roles.get(String(p.Id))
    if (!f || !f.rated || f.afk || !r) continue
    matchRows.push(rowOf(f, r, 'match'))
  }
}
const careerRows: Row[] = []
const seqs = new Map<string, Row[]>()
for (const [id, a] of apById) {
  const roles = rolesFromCareer(a.categoryPreferences, a.highlightUnits, undefined, MODEL.catSplit)
  if (!roles) continue
  const trade = new Map([[id, tradeMult({ Id: id }, roles)]])
  const rows: Row[] = []
  for (const off of [0, 20]) {
    const f = 'pm-' + id + '-o' + off + '.json'
    if (!files.includes(f)) continue
    for (const x of (J(f).matches || []) as MatchEntry[]) {
      if (!after(x.data?.EndTime)) continue
      const ft = matchFeatures(x, id, { trade })
      if (!ft || !ft.rated || ft.afk) continue
      rows.push(rowOf(ft, roles, 'career'))
    }
  }
  rows.sort((p, q) => p.endTime - q.endTime)
  careerRows.push(...rows)
  if (rows.length) seqs.set(id, rows)
}
console.log(`胜负项权重 ${W_OUT}；单局 ${mById.size} 局 ${matchRows.length} 行，生涯 ${careerRows.length} 行（${seqs.size} 人）`)

// ---------- 卡尔曼：一步预测似然最大化（照搬老脚本） ----------
type K = { P0: number; q: number; r: number; shortMin: number; P0f: number; qf: number }
function kalmanNLL(arr: Row[][], P0: number, q: number, rN: number, shortMin: number): number {
  let nll = 0
  let n = 0
  for (const s of arr) {
    let m = 0
    let P = P0
    for (const o of s) {
      P += q
      const R = rN / Math.min(1, Math.max(0.3, o.minutes / shortMin))
      const S = P + R
      const e = o.c - m
      nll += 0.5 * (Math.log(2 * Math.PI * S) + (e * e) / S)
      n++
      const Kg = P / S
      m += Kg * e
      P *= 1 - Kg
    }
  }
  return nll / n
}
function fitKalman(arr: Row[][]): K {
  let best: (K & { nll: number }) | null = null
  const v = sd(arr.flat().map((o) => o.c)) ** 2
  for (const P0f of [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.3])
    for (const qf of [0, 0.0001, 0.0003, 0.001, 0.003])
      for (const shortMin of [6, 9, 12, 16]) {
        const P0 = P0f * v
        const q = qf * v
        const rN = v * (1 - P0f)
        const nll = kalmanNLL(arr, P0, q, rN, shortMin)
        if (!best || nll < best.nll) best = { P0, q, r: rN, shortMin, nll, P0f, qf }
      }
  return best as K
}
const kalmanRun = (s: Row[], k: K): number => {
  let m = 0
  let P = k.P0
  for (const o of s) {
    P += k.q
    const R = k.r / Math.min(1, Math.max(0.3, o.minutes / k.shortMin))
    const Kg = P / (P + R)
    m += Kg * (o.c - m)
    P *= 1 - Kg
  }
  return m
}
const k = fitKalman([...seqs.values()])

// ---------- 回测：较早 20 场的分数，能不能预测之后 ≥10 场 ----------
const bt = [...seqs.values()].filter((r) => r.length >= 30)
const xs = bt.map((r) => kalmanRun(r.slice(0, 20), k))
const futRes = bt.map((r) => mean(r.slice(20).map((o) => o.resid)))
const futC = bt.map((r) => mean(r.slice(20).map((o) => o.c)))
console.log(
  `回测 ${bt.length} 人：预测之后「实际胜负 − ELO 预期」r = ${pearson(xs, futRes).toFixed(3)}，` +
    `预测之后的单场表现 r = ${pearson(xs, futC).toFixed(3)}`
)

// ---------- 百分位表 ----------
const r3 = (v: number): number => Math.round(v * 1000) / 1000
const matchPct = { match: quantiles(matchRows.map((r) => r.c)).map(r3), career: quantiles(careerRows.map((r) => r.c)).map(r3) }
// 玩家分布：每人最近 20 场跑卡尔曼；样本按 ELO 分层，按对局池里各档人数加权还原
const BANDS = [0, 1600, 1900, 2100, 2300, 2500, Infinity]
const bandOf = (e: number): number => BANDS.findIndex((b, i) => e >= b && e < BANDS[i + 1])
const poolCount = new Array(6).fill(0)
{
  const last = new Map<string, { t: number; e: number }>()
  for (const x of pmById.values())
    for (const p of Object.values(x.data?.Data || {}) as PlayerData[])
      if (isRated(p)) {
        const t = x.data?.EndTime || 0
        const o = last.get(String(p.Id))
        if (!o || t > o.t) last.set(String(p.Id), { t, e: p.NewRating as number })
      }
  for (const o of last.values()) poolCount[bandOf(o.e)]++
}
const players: { m: number; band: number }[] = []
for (const rows of seqs.values()) {
  const last20 = rows.slice(-20)
  if (last20.length < 5) continue
  const elo = last20[last20.length - 1].elo
  if (elo == null) continue
  players.push({ m: kalmanRun(last20, k), band: bandOf(elo) })
}
const sampleCount = new Array(6).fill(0)
for (const p of players) sampleCount[p.band]++
function wquantiles(items: { v: number; w: number }[], n = 101): number[] {
  const s = [...items].sort((a, b) => a.v - b.v)
  const tot = s.reduce((a, x) => a + x.w, 0)
  const out: number[] = []
  let acc = 0
  let i = 0
  for (let j = 0; j < n; j++) {
    const target = (j / (n - 1)) * tot
    while (i < s.length - 1 && acc + s[i].w < target) {
      acc += s[i].w
      i++
    }
    out.push(s[i].v)
  }
  return out
}
const playerPct = wquantiles(
  players.map((p) => ({ v: p.m, w: sampleCount[p.band] ? poolCount[p.band] / sampleCount[p.band] : 0 }))
).map((v) => Math.round(v * 10000) / 10000)
const kalman = { P0: +k.P0.toFixed(4), q: +k.q.toFixed(5), r: +k.r.toFixed(4), shortMin: k.shortMin }
console.log(`卡尔曼 ${JSON.stringify(kalman)}（现在 ${JSON.stringify(MODEL.kalman)}）；玩家分布 ${players.length} 人`)

if (process.argv.includes('--write')) {
  const file = join(__dirname, '..', 'src', 'shared', 'dragon', 'model.json')
  const model = JSON.parse(readFileSync(file, 'utf8'))
  model.weights.out = W_OUT
  model.matchPct = matchPct
  model.playerPct = playerPct
  model.kalman = kalman
  writeFileSync(file, JSON.stringify(model))
  console.log('已写回 model.json')
}
