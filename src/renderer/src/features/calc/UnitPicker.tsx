// 选单位：一个铺开的浏览器，按国家 / 类别 / 专精筛，可以搜名字。
// 选好之后下面是这个单位的配装槽位（默认按游戏的默认件选好）。
import { useMemo, useState } from 'react'
import { BUNDLED } from '@shared/game'
import { U, type CombatData } from '@shared/game/combat'
import { CAT_NAME, CLASS_NAME, defaultOpts, type UnitProfile } from '@shared/combat/model'

export interface Pick {
  unit: number
  opts: number[]
}

const optLabel = (id: number): string => {
  const o = BUNDLED.options[id]
  if (!o) return '#' + id
  const label = o[3] || o[1] || o[2] || ''
  return (label || '默认') + (o[0] ? '（+' + o[0] + '）' : '')
}

export function UnitBrowser({
  data,
  current,
  onPick,
  onClose
}: {
  data: CombatData
  current: number
  onPick: (id: number) => void
  onClose: () => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [country, setCountry] = useState<number | null>(null)
  const [cat, setCat] = useState<number | null>(null)
  const [spec, setSpec] = useState<number | null>(null)

  const countries = useMemo(
    () => Object.entries(data.countries || {}).map(([id, name]) => ({ id: Number(id), name })),
    [data]
  )
  const specs = useMemo(
    () =>
      Object.entries(data.specs || {})
        .map(([id, [name, c]]) => ({ id: Number(id), name, country: c }))
        .filter((s) => s.name && s.name !== 'Editor')
        .sort((a, b) => a.country - b.country || a.name.localeCompare(b.name)),
    [data]
  )

  // 有些单位是别的单位「换配装」换出来的变体（比如 Rangers Mk47 AGL），
  // 它们自己没有配装槽——槽位在母单位身上。列表里标一下，免得以为是漏了。
  const variants = useMemo(() => {
    const out = new Set<number>()
    for (const e of Object.values(data.options || {})) if (e?.u) out.add(e.u)
    return out
  }, [data])

  const list = useMemo(() => {
    const text = q.trim().toLowerCase()
    return Object.entries(data.units)
      .map(([id, u]) => ({
        id: Number(id),
        name: u[U.name],
        cost: u[U.cost],
        cat: u[U.cat],
        country: u[U.country]
      }))
      .filter((u) => u.name && u.cost > 0)
      .filter((u) => (country == null ? true : u.country === country))
      .filter((u) => (cat == null ? true : u.cat === cat))
      .filter((u) => (spec == null ? true : (data.unitSpecs[u.id] || []).includes(spec)))
      .filter((u) => !text || u.name.toLowerCase().includes(text))
      .sort((a, b) => a.cat - b.cat || b.cost - a.cost)
  }, [data, q, country, cat, spec])

  return (
    <div className="ub-mask" onClick={onClose}>
      <div className="ub" onClick={(e) => e.stopPropagation()}>
        <div className="ub-head">
          <input autoFocus value={q} placeholder="搜单位名" onChange={(e) => setQ(e.target.value)} />
          <span className="dim">{list.length} 个</span>
          <span className="grow" />
          <button onClick={onClose}>✕</button>
        </div>

        <div className="ub-filters">
          <div className="ub-row">
            <span className="dim">国家</span>
            <button className={country == null ? 'primary' : ''} onClick={() => setCountry(null)}>
              全部
            </button>
            {countries.map((c) => (
              <button
                key={c.id}
                className={country === c.id ? 'primary' : ''}
                onClick={() => {
                  setCountry(c.id)
                  setSpec(null)
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="ub-row">
            <span className="dim">类别</span>
            <button className={cat == null ? 'primary' : ''} onClick={() => setCat(null)}>
              全部
            </button>
            {Object.entries(CAT_NAME).map(([k, label]) => (
              <button key={k} className={cat === Number(k) ? 'primary' : ''} onClick={() => setCat(Number(k))}>
                {label}
              </button>
            ))}
          </div>
          <div className="ub-row">
            <span className="dim">专精</span>
            <button className={spec == null ? 'primary' : ''} onClick={() => setSpec(null)}>
              全部
            </button>
            {specs
              .filter((s) => country == null || s.country === country)
              .map((s) => (
                <button key={s.id} className={spec === s.id ? 'primary' : ''} onClick={() => setSpec(s.id)}>
                  {s.name}
                </button>
              ))}
          </div>
        </div>

        <div className="ub-list">
          {list.map((u) => (
            <button
              key={u.id}
              className={'ub-item' + (u.id === current ? ' on' : '')}
              onClick={() => {
                onPick(u.id)
                onClose()
              }}
            >
              <span className="ub-name">
                {u.name}
                {variants.has(u.id) && !(data.unitOptions[u.id] || []).length && (
                  <i className="tag dimtag" title="这是别的单位换配装换出来的版本，所以它自己没有配装槽">
                    变体
                  </i>
                )}
              </span>
              <span className="dim ub-cat">{CAT_NAME[u.cat] || ''}</span>
              <span className="ub-cost">{u.cost}</span>
            </button>
          ))}
          {!list.length && <div className="dim">没有符合条件的单位</div>}
        </div>
      </div>
    </div>
  )
}

export default function UnitPicker({
  title,
  data,
  value,
  onChange,
  profile
}: {
  title: string
  data: CombatData
  value: Pick
  onChange: (p: Pick) => void
  profile: UnitProfile | null
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const slots = data.unitOptions[value.unit] || []

  return (
    <div className="pick">
      <div className="pick-head">
        <span className="pick-title">{title}</span>
        <button className="pick-name" onClick={() => setOpen(true)}>
          {profile ? profile.name : '选一个单位'}
          <span className="dim"> {profile ? profile.cost + ' 分 · ' + CLASS_NAME[profile.klass] : ''}</span>
          <span className="dim"> ▾</span>
        </button>
      </div>

      {open && (
        <UnitBrowser
          data={data}
          current={value.unit}
          onPick={(id) => onChange({ unit: id, opts: defaultOpts(data, id) })}
          onClose={() => setOpen(false)}
        />
      )}

      {profile && (
        <div className="pick-stats dim">
          HP {profile.hp}
          {!profile.directional ? (
            <> · 装甲 {profile.armorValue}（不分方向）</>
          ) : (
            <>
              {' '}
              · 动能 {profile.kin.join('/')} · 破甲 {profile.heat.join('/')}
            </>
          )}
          {profile.abilities.aps && <> · APS {profile.abilities.aps.qty} 发</>}
          {profile.abilities.ecm < 1 && <> · ECM ×{profile.abilities.ecm}</>}
          {profile.abilities.decoy && <> · 干扰弹 {profile.abilities.decoy.qty} 发</>}
          {' · '}
          {profile.size.len}×{profile.size.wid}×{profile.size.hei} m
        </div>
      )}

      <div className="pick-slots">
        {slots.map(([name, opts], i) => (
          <label key={name + i} className="pick-slot">
            <span className="dim">{name}</span>
            <select
              value={String(opts.find(([id]) => value.opts.includes(id))?.[0] ?? '')}
              onChange={(e) => {
                const keep = value.opts.filter((id) => !opts.some(([oid]) => oid === id))
                const v = Number(e.target.value)
                onChange({ unit: value.unit, opts: v ? [...keep, v] : keep })
              }}
            >
              <option value="">（不选）</option>
              {opts.map(([id]) => (
                <option key={id} value={id}>
                  {optLabel(id)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}
