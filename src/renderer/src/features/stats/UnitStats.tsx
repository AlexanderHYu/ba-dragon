// 单位效能：把本地档案里所有对局的出兵记录按「单位 + 配装」摊开来比。
// 这一页不发任何网络请求，全是本地库里已经有的对局数据现算的。
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { UnitStatRow, UnitStatsFilter, UnitStatsResult } from '@shared/ipc'
import './stats.css'

const num = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString('zh-CN')
const sec = (n: number | null): string => {
  if (n == null) return '—'
  const m = Math.floor(n / 60)
  return m + '′' + String(Math.round(n % 60)).padStart(2, '0') + '″'
}

type Col = [key: string, label: string, get: (u: UnitStatRow) => number | null, render?: (u: UnitStatRow) => React.ReactNode, tip?: string]

const COLS: Col[] = [
  ['cost', '单价', (u) => u.cost, (u) => num(u.cost), '含配装的精确单价'],
  ['deployed', '出动', (u) => u.deployed, (u) => (
    <>
      {u.deployed}
      {u.refunded > 0 && <span className="dim">（回收 {u.refunded}）</span>}
    </>
  ), '这些对局里一共出动了多少次（飞机按架次）'],
  ['deathRate', '死亡率', (u) => u.deathRate, (u) => (
    <span className={(u.deathRate ?? 0) >= 80 ? 'lit-bad' : (u.deathRate ?? 100) <= 30 ? 'lit-ok' : ''}>
      {u.deathRate == null ? '—' : u.deathRate + '%'}
    </span>
  ), '阵亡 ÷ 出动'],
  ['lifeMedian', '存活·中位', (u) => u.lifeMedian, (u) => sec(u.lifeMedian), '阵亡的那些从出兵到死了多久，取中位数'],
  ['dmgPerSortie', '伤害/次', (u) => u.dmgPerSortie, (u) => num(u.dmgPerSortie), '平均每出动一次打出多少伤害'],
  ['dmgPer100', '伤害/100花费', (u) => u.dmgPer100, (u) => num(u.dmgPer100), '每 100 点花费打出多少伤害——横向比不同价位的单位就看这个'],
  ['killsPerSortie', '击杀/次', (u) => u.killsPerSortie, (u) => (u.killsPerSortie || 0).toFixed(1)],
  ['killsPer1k', '击杀/1000花费', (u) => u.killsPer1k, (u) => (u.killsPer1k ?? 0).toFixed(2)],
  ['dmg', '总伤害', (u) => u.dmg, (u) => num(u.dmg)],
  ['matches', '局数', (u) => u.matches, (u) => String(u.matches), '在几局里出现过'],
  ['users', '用过的人', (u) => u.users, (u) => String(u.users)]
]

export default function UnitStats(): React.JSX.Element {
  const [res, setRes] = useState<UnitStatsResult | null>(null)
  const [maps, setMaps] = useState<{ id: number; name: string; matches: number }[]>([])
  const [f, setF] = useState<UnitStatsFilter>({ who: 'all', minDeployed: 5 })
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'dmgPer100', dir: -1 })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  /** 展开对比某个单位的所有配装 */
  const [openUnit, setOpenUnit] = useState<number | null>(null)

  const reload = useCallback(async (filter: UnitStatsFilter): Promise<void> => {
    setBusy(true)
    setRes(await window.BA.unitStats(filter))
    setBusy(false)
  }, [])

  useEffect(() => {
    void window.BA.statsMaps().then(setMaps)
  }, [])
  useEffect(() => {
    void reload(f)
  }, [f, reload])

  const patch = (p: Partial<UnitStatsFilter>): void => setF((old) => ({ ...old, ...p }))

  const rows = useMemo(() => {
    const col = COLS.find((c) => c[0] === sort.key)
    const text = q.trim().toLowerCase()
    const list = (res?.rows || []).filter(
      (u) => !text || u.name.toLowerCase().includes(text) || u.loadout.toLowerCase().includes(text)
    )
    if (!col) return list
    return [...list].sort((a, b) => ((col[2](a) ?? -1) - (col[2](b) ?? -1)) * sort.dir)
  }, [res, sort, q])

  /** 同一个单位的其它配装，用来并排比 */
  const variantsOf = (unitId: number): UnitStatRow[] =>
    (res?.rows || []).filter((u) => u.unitId === unitId).sort((a, b) => b.deployed - a.deployed)

  return (
    <div className="card">
      <h2>
        <span className="ico">📊</span>
        单位效能
        <span className="dim">
          {res ? res.matches + ' 局 · ' + res.records.toLocaleString('zh-CN') + ' 条出兵记录' : '算着…'}
        </span>
        {busy && <span className="spin" />}
        <span className="grow" />
        <input
          value={q}
          placeholder="搜单位或挂载"
          onChange={(e) => setQ(e.target.value)}
          style={{ width: 160 }}
        />
      </h2>

      <div className="st-filters">
        <select value={String(f.mapId ?? '')} onChange={(e) => patch({ mapId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">所有地图</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}（{m.matches} 局）
            </option>
          ))}
        </select>
        <select value={f.who || 'all'} onChange={(e) => patch({ who: e.target.value as UnitStatsFilter['who'] })}>
          <option value="all">所有人</option>
          <option value="me">只看我</option>
          <option value="others">只看别人</option>
        </select>
        <select value={f.result || ''} onChange={(e) => patch({ result: (e.target.value || null) as UnitStatsFilter['result'] })}>
          <option value="">胜负都算</option>
          <option value="win">只看赢的那一方</option>
          <option value="lose">只看输的那一方</option>
        </select>
        <select value={String(f.minDeployed ?? 5)} onChange={(e) => patch({ minDeployed: Number(e.target.value) })}>
          {[1, 3, 5, 10, 20].map((n) => (
            <option key={n} value={n}>
              至少出动 {n} 次
            </option>
          ))}
        </select>
        <label className="st-check">
          <input type="checkbox" checked={!!f.rankedOnly} onChange={(e) => patch({ rankedOnly: e.target.checked })} />
          只看排位
        </label>
      </div>

      {res && res.priced === 'none' && (
        <div className="lit-bad st-note">没有游戏单位表，配装名字和单价都用不了。</div>
      )}
      {res && res.unpriced > 0 && (
        <div className="dim st-note">
          有 {res.unpriced} 条记录在单位表里查不到（游戏更新后新加的单位），这些行的单价是老表里的估算。
        </div>
      )}

      <div className="st-scroll">
        <table className="t st-table">
          <thead>
            <tr>
              <th>单位</th>
              <th>兵种</th>
              {COLS.map(([k, label, , , tip]) => (
                <th
                  key={k}
                  title={tip}
                  className={'rp-sort' + (sort.key === k ? ' sorted' : '')}
                  onClick={() => setSort((s) => (s.key === k ? { key: k, dir: (-s.dir) as 1 | -1 } : { key: k, dir: -1 }))}
                >
                  {label}
                  {sort.key === k ? (sort.dir === -1 ? ' ▾' : ' ▴') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const variants = variantsOf(u.unitId)
              const open = openUnit === u.unitId
              return (
                <>
                  <tr
                    key={u.unitId + '|' + u.options}
                    className={'st-row' + (open ? ' open' : '')}
                    onClick={() => setOpenUnit(open ? null : u.unitId)}
                    title={variants.length > 1 ? '点一下：和这个单位的其它 ' + (variants.length - 1) + ' 套配装并排比' : '这个单位只有这一套配装'}
                  >
                    <td>
                      <b>{u.name}</b>
                      {variants.length > 1 && <span className="st-variants">{variants.length} 套配装</span>}
                      {!!u.loadout && <div className="dim st-load">{u.loadout}</div>}
                    </td>
                    <td className="dim">{u.roleName}</td>
                    {COLS.map(([k, , get, render]) => (
                      <td key={k} className="num">
                        {render ? render(u) : num(get(u))}
                      </td>
                    ))}
                  </tr>
                  {open && variants.length > 1 && (
                    <tr key={u.unitId + '|cmp'} className="st-cmp-row">
                      <td colSpan={COLS.length + 2}>
                        <div className="st-cmp">
                          <div className="st-cmp-head">{u.name} 的几套配装</div>
                          <table className="t">
                            <thead>
                              <tr>
                                <th>挂载</th>
                                <th className="num">单价</th>
                                <th className="num">出动</th>
                                <th className="num">死亡率</th>
                                <th className="num">存活·中位</th>
                                <th className="num">伤害/次</th>
                                <th className="num">伤害/100花费</th>
                                <th className="num">击杀/次</th>
                              </tr>
                            </thead>
                            <tbody>
                              {variants.map((v) => (
                                <tr key={v.options} className={v.options === u.options ? 'st-cmp-me' : ''}>
                                  <td>{v.loadout || <span className="dim">（没有配装）</span>}</td>
                                  <td className="num">{v.cost}</td>
                                  <td className="num">{v.deployed}</td>
                                  <td className="num">{v.deathRate == null ? '—' : v.deathRate + '%'}</td>
                                  <td className="num">{sec(v.lifeMedian)}</td>
                                  <td className="num">{num(v.dmgPerSortie)}</td>
                                  <td className="num">{num(v.dmgPer100)}</td>
                                  <td className="num">{(v.killsPerSortie || 0).toFixed(1)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="dim st-cmp-note">
                            样本少的时候别当真——出动个位数的行只能算个印象。
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={COLS.length + 2} className="dim">
                  {busy ? '算着…' : '没有符合条件的记录，把「至少出动」调小一点试试'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="dim st-note">
        数据来自本地档案里<b>存了完整单位记录</b>的对局（老版本迁移过来的只有战绩、没有出兵明细，不在内），
        全部本地现算，不发任何请求。伤害和存活是官方记的真值，「每 100 花费」用的是含配装的精确单价。
        打得越多这张表越准。
      </div>
    </div>
  )
}
