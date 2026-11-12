// 拟合实力 ELO：实力 ELO = ELO + (b0 + b1·(ELO−2000)/500)·(龙区分 − 5.5)
// 数据：scripts/collect-dragon-data.mjs 采集的随机玩家（pm-<id>-o0.json 最近 50 场 + ap-<id>.json 生涯兵种）。
//   1. 每人每一局：只用这局之前的 20 场排位算赛前龙区分（computeDragonScore，和软件里一样）
//   2. 主校准：P(本队赢) = 1 / (1 + 10^(−(本队平均有效 ELO − 对方平均 ELO)/400))，
//      只有本人的修正值已知，队友按 0，所以本人的修正值在本队平均里要除以本队人数。极大似然拟合 b0、b1
//   3. 验证：龙区分高的人之后 30 场 ELO 是否往实力 ELO 的方向走，和主校准推出的走势对照
//   4. 回测：按玩家留出 30%，比较「只看 ELO」和「实力 ELO」的对数损失、Brier 分数、分档校准表
//   npx vite-node -c vitest.config.ts scripts/fit-effective-elo.ts           只看，不写
//   npx vite-node -c vitest.config.ts scripts/fit-effective-elo.ts --write   写回 model.json 的 effElo
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MatchEntry, PlayerData } from '../src/shared/types/batrace'
import { computeDragonScore, hasRating, isRated, teamOf } from '../src/shared/dragon/score'
import { effEloShift, type EffEloParams } from '../src/shared/dragon/effElo'

const DIR = process.env.BA_DATA_DIR || 'H:/github/ba-dragon-data/2026-11-11'
if (!existsSync(DIR)) throw new Error('没有数据目录：' + DIR)
const HIST = 20
const REF = 2000
const SPAN = 500
const MID = 5.5
const LN = Math.log(10) / 400
const files = readdirSync(DIR)
const J = (f: string): any => JSON.parse(readFileSync(join(DIR, f), 'utf8'))

interface Row {
  pid: string
  t: number
  elo: number
  /** 赛前龙区分（1~10） */
  score: number
  /** 本队平均 ELO − 对方平均 ELO（赛前，全员） */
  d: number
  n: number
  S: number
  delta: number
}

// ---------- 1. 赛前龙区分 ----------
const rows: Row[] = []
/** 每人按时间从旧到新的排位局（验证用） */
const seqs = new Map<string, Row[]>()
let players = 0
for (const f of files) {
  const m = /^pm-(\d+)-o0\.json$/.exec(f)
  if (!m) continue
  const pid = m[1]
  const ms = ((J(f).matches || []) as MatchEntry[])
    .filter((x) => x.data?.EndTime)
    .sort((a, b) => (b.data!.EndTime as number) - (a.data!.EndTime as number)) // 新 → 旧
  const ap = files.includes('ap-' + pid + '.json') ? J('ap-' + pid + '.json') : null
  const a = ap?.data || ap || {}
  players++
  const seq: Row[] = []
  for (let i = 0; i < ms.length; i++) {
    const all = Object.values(ms[i].data?.Data || {}) as PlayerData[]
    const me = all.find((p) => String(p.Id) === pid)
    if (!me || !isRated(me) || (teamOf(me) !== 0 && teamOf(me) !== 1)) continue
    const team = all.filter((p) => teamOf(p) === teamOf(me) && hasRating(p))
    const opp = all.filter((p) => teamOf(p) === 1 - teamOf(me) && hasRating(p))
    if (!opp.length) continue
    const avg = (l: PlayerData[]): number => l.reduce((s, p) => s + (p.OldRating as number), 0) / l.length
    const ds = computeDragonScore({
      stbid: pid,
      matches: ms.slice(i + 1),
      categoryPreferences: a.categoryPreferences,
      highlightUnits: a.highlightUnits
    })
    if ('error' in ds && ds.error) continue
    if (!('value' in ds) || ds.matchCount < HIST) continue
    const r: Row = {
      pid,
      t: ms[i].data!.EndTime as number,
      elo: me.OldRating as number,
      score: ds.value,
      d: avg(team) - avg(opp),
      n: team.length,
      S: (me.NewRating as number) > (me.OldRating as number) ? 1 : 0,
      delta: (me.NewRating as number) - (me.OldRating as number)
    }
    rows.push(r)
    seq.push(r)
  }
  seq.sort((p, q) => p.t - q.t)
  if (seq.length) seqs.set(pid, seq)
}
const eloLo = Math.min(...rows.map((r) => r.elo))
const eloHi = Math.max(...rows.map((r) => r.elo))
console.log(`${players} 名玩家，${rows.length} 局有完整 ${HIST} 场赛前龙区分（${seqs.size} 人），ELO ${eloLo.toFixed(0)}~${eloHi.toFixed(0)}`)

// ---------- 2. 极大似然（牛顿法，带一点岭惩罚防发散） ----------
const RANGE: [number, number] = [Math.round(quantile(rows.map((r) => r.elo), 0.01)), Math.round(quantile(rows.map((r) => r.elo), 0.99))]
function quantile(a: number[], q: number): number {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.round(q * (s.length - 1))]
}
const params = (b0: number, b1: number): EffEloParams => ({ b0, b1, ref: REF, span: SPAN, mid: MID, eloRange: RANGE })
const sig = (z: number): number => 1 / (1 + Math.exp(-z))
const pElo = (r: Row): number => sig(LN * r.d)
const pEff = (r: Row, p: EffEloParams): number => sig(LN * (r.d + effEloShift(r.elo, r.score, p) / r.n))
function features(r: Row): [number, number] {
  const e = Math.min(RANGE[1], Math.max(RANGE[0], r.elo))
  const x0 = (LN * (r.score - MID)) / r.n
  return [x0, (x0 * (e - REF)) / SPAN]
}
function fit(data: Row[]): { b0: number; b1: number; se0: number; se1: number; cov: number } {
  let b = [0, 0]
  let H = [0, 0, 0]
  for (let it = 0; it < 50; it++) {
    const g = [0, 0]
    H = [1e-9, 0, 1e-9]
    for (const r of data) {
      const x = features(r)
      const p = sig(LN * r.d + b[0] * x[0] + b[1] * x[1])
      const w = p * (1 - p)
      g[0] += (r.S - p) * x[0]
      g[1] += (r.S - p) * x[1]
      H[0] += w * x[0] * x[0]
      H[1] += w * x[0] * x[1]
      H[2] += w * x[1] * x[1]
    }
    const det = H[0] * H[2] - H[1] * H[1]
    const step = [(H[2] * g[0] - H[1] * g[1]) / det, (H[0] * g[1] - H[1] * g[0]) / det]
    b = [b[0] + step[0], b[1] + step[1]]
    if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-6) break
  }
  const det = H[0] * H[2] - H[1] * H[1]
  return { b0: b[0], b1: b[1], se0: Math.sqrt(H[2] / det), se1: Math.sqrt(H[0] / det), cov: -H[1] / det }
}

// 按玩家留出 30%（玩家 ID 的哈希，固定可复现）
const hash = (s: string): number => {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) / 4294967296
}
const isTest = (pid: string): boolean => hash(pid + ':holdout') < 0.3
const train = rows.filter((r) => !isTest(r.pid))
const test = rows.filter((r) => isTest(r.pid))
const fAll = fit(rows)
const fTr = fit(train)
const fmt = (f: ReturnType<typeof fit>): string =>
  `b0 = ${f.b0.toFixed(1)} ± ${f.se0.toFixed(1)}，b1 = ${f.b1.toFixed(1)} ± ${f.se1.toFixed(1)}`
console.log(`\n主校准（全部 ${rows.length} 局）：${fmt(fAll)}`)
console.log(`训练集（${train.length} 局，${new Set(train.map((r) => r.pid)).size} 人）：${fmt(fTr)}`)
for (const e of [1500, 2000, 2500])
  console.log(
    `  ELO ${e}：龙区分每 +1 → 实力 ELO +${(fAll.b0 + (fAll.b1 * (e - REF)) / SPAN).toFixed(0)}；` +
      `龙区分 8 → ${(e + effEloShift(e, 8, params(fAll.b0, fAll.b1))).toFixed(0)}`
  )

// ---------- 4. 回测 ----------
function metrics(data: Row[], pf: (r: Row) => number): { ll: number; brier: number } {
  let ll = 0
  let br = 0
  for (const r of data) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, pf(r)))
    ll -= r.S ? Math.log(p) : Math.log(1 - p)
    br += (p - r.S) ** 2
  }
  return { ll: ll / data.length, brier: br / data.length }
}
const pTr = params(fTr.b0, fTr.b1)
const base = metrics(test, pElo)
const eff = metrics(test, (r) => pEff(r, pTr))
const coin = metrics(test, () => 0.5)
console.log(`\n回测（留出 ${test.length} 局，${new Set(test.map((r) => r.pid)).size} 人，参数只用训练集拟合）`)
console.log(`             对数损失   Brier`)
console.log(`  五五开       ${coin.ll.toFixed(4)}   ${coin.brier.toFixed(4)}`)
console.log(`  只看 ELO     ${base.ll.toFixed(4)}   ${base.brier.toFixed(4)}`)
console.log(`  实力 ELO     ${eff.ll.toFixed(4)}   ${eff.brier.toFixed(4)}`)
// 自助法：按玩家重抽留出集，看对数损失差的区间
const testPids = [...new Set(test.map((r) => r.pid))]
const byPid = new Map<string, Row[]>()
for (const r of test) byPid.set(r.pid, [...(byPid.get(r.pid) || []), r])
let seed = 7
const rnd = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296)
const diffs: number[] = []
for (let b = 0; b < 1000; b++) {
  const sample: Row[] = []
  for (let i = 0; i < testPids.length; i++) sample.push(...byPid.get(testPids[Math.floor(rnd() * testPids.length)])!)
  diffs.push(metrics(sample, pElo).ll - metrics(sample, (r) => pEff(r, pTr)).ll)
}
diffs.sort((x, y) => x - y)
const dLL = base.ll - eff.ll
console.log(
  `  对数损失降低 ${dLL.toFixed(4)}（按玩家自助法 95% 区间 ${diffs[25].toFixed(4)} ~ ${diffs[974].toFixed(4)}）`
)

function calTable(label: string, pf: (r: Row) => number): void {
  console.log(`\n  分档校准（${label}）：预测胜率档  局数  平均预测  实际胜率`)
  const edges = [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 1.01]
  for (let i = 0; i < edges.length - 1; i++) {
    const b = test.filter((r) => pf(r) >= edges[i] && pf(r) < edges[i + 1])
    if (!b.length) continue
    const mp = b.reduce((s, r) => s + pf(r), 0) / b.length
    const ws = b.reduce((s, r) => s + r.S, 0) / b.length
    console.log(`    ${(edges[i] * 100).toFixed(0).padStart(3)}%~${Math.min(100, edges[i + 1] * 100).toFixed(0).padStart(3)}%  ${String(b.length).padStart(5)}  ${(mp * 100).toFixed(1).padStart(6)}%  ${(ws * 100).toFixed(1).padStart(6)}%`)
  }
}
calTable('只看 ELO', pElo)
calTable('实力 ELO', (r) => pEff(r, pTr))
// 按赛前龙区分分档：只看 ELO 时，龙区分高的人是不是赢得比预期多
console.log('\n  按赛前龙区分分档（留出集）：龙区分  局数  实际胜率  只看 ELO  实力 ELO')
for (const [lo, hi] of [[1, 3], [3, 4.5], [4.5, 6.5], [6.5, 8], [8, 10.1]]) {
  const b = test.filter((r) => r.score >= lo && r.score < hi)
  if (!b.length) continue
  const av = (f: (r: Row) => number): string => ((b.reduce((s, r) => s + f(r), 0) / b.length) * 100).toFixed(1) + '%'
  console.log(`    ${lo}~${Math.min(10, hi)}  ${String(b.length).padStart(5)}  ${av((r) => r.S).padStart(7)}  ${av(pElo).padStart(7)}  ${av((r) => pEff(r, pTr)).padStart(7)}`)
}

// ---------- 3. 验证：之后 30 场 ELO 的走向 ----------
// 每人取第一个有完整赛前龙区分的局为起点，记下当时的修正值 g；之后最多 30 场的实际 ELO 变化，
// 和「真实水平 = 实力 ELO」时的预期变化比：每场预期 = K ×（按剩余差距算的胜率 − 按 ELO 算的胜率），
// 差距随 ELO 追上来而缩小。K 用全部局的 |ELO 变化| ÷ |胜负 − 预期| 的中位数估。
const ks = rows.map((r) => Math.abs(r.delta) / Math.abs(r.S - pElo(r))).filter(Number.isFinite).sort((a, b) => a - b)
const K = ks[ks.length >> 1]
const pAll = params(fAll.b0, fAll.b1)
const ver: { g: number; score: number; obs: number; pred: number; n: number }[] = []
for (const seq of seqs.values()) {
  if (seq.length < 11) continue
  const start = seq[0]
  const g = effEloShift(start.elo, start.score, pAll)
  const next = seq.slice(0, 30)
  let moved = 0
  let pred = 0
  for (const r of next) {
    const gap = g - pred
    pred += K * (sig(LN * (r.d + gap / r.n)) - pElo(r))
    moved += r.delta
  }
  ver.push({ g, score: start.score, obs: moved, pred, n: next.length })
}
const slope = (xs: number[], ys: number[]): number => {
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length
  const my = ys.reduce((a, b) => a + b, 0) / ys.length
  let a = 0
  let b = 0
  for (let i = 0; i < xs.length; i++) {
    a += (xs[i] - mx) * (ys[i] - my)
    b += (xs[i] - mx) ** 2
  }
  return a / b
}
console.log(`\n验证：${ver.length} 人，从第一个有完整赛前龙区分的局起最多 30 场（平均 ${(ver.reduce((s, v) => s + v.n, 0) / ver.length).toFixed(1)} 场），K ≈ ${K.toFixed(1)}`)
console.log('  赛前龙区分  人数  平均修正值  实际 ELO 变化  按主校准预期')
for (const [lo, hi] of [[1, 3], [3, 4.5], [4.5, 6.5], [6.5, 8], [8, 10.1]]) {
  const b = ver.filter((v) => v.score >= lo && v.score < hi)
  if (!b.length) continue
  const av = (f: (v: (typeof ver)[number]) => number): string => (b.reduce((s, v) => s + f(v), 0) / b.length).toFixed(0)
  console.log(`    ${lo}~${Math.min(10, hi)}  ${String(b.length).padStart(5)}  ${av((v) => v.g).padStart(8)}  ${av((v) => v.obs).padStart(10)}  ${av((v) => v.pred).padStart(10)}`)
}
const sl = slope(ver.map((v) => v.pred), ver.map((v) => v.obs))
console.log(`  实际变化对预期变化的回归斜率 ${sl.toFixed(2)}（1 = 和主校准一致，0 = ELO 没有往实力 ELO 方向走）`)

const out = {
  b0: Math.round(fAll.b0 * 10) / 10,
  b1: Math.round(fAll.b1 * 10) / 10,
  ref: REF,
  span: SPAN,
  mid: MID,
  eloRange: RANGE
}
console.log('\neffElo =', JSON.stringify(out))
if (process.argv.includes('--write')) {
  const file = join(__dirname, '..', 'src', 'shared', 'dragon', 'model.json')
  const model = JSON.parse(readFileSync(file, 'utf8'))
  model.effElo = out
  writeFileSync(file, JSON.stringify(model))
  console.log('已写回 model.json')
}
