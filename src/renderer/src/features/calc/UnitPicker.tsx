// 选一个单位 + 给它配装。配装槽位和选项都来自游戏自带的表，默认按游戏的默认件选。
import { useMemo, useState } from 'react'
import { BUNDLED } from '@shared/game'
import { U, type CombatData } from '@shared/game/combat'
import { CLASS_NAME, type UnitProfile } from '@shared/combat/model'

export interface Pick {
  unit: number
  opts: number[]
}

/** 这个单位每个槽位默认选哪个 */
export function defaultOpts(data: CombatData, unitId: number): number[] {
  const slots = data.unitOptions[unitId] || []
  const out: number[] = []
  for (const [, list] of slots) {
    const def = list.find(([, isDefault]) => isDefault) || list[0]
    if (def) out.push(def[0])
  }
  return out
}

const optLabel = (id: number): string => {
  const o = BUNDLED.options[id]
  if (!o) return '#' + id
  const label = o[3] || o[1] || o[2] || ''
  return (label || '默认') + (o[0] ? '（+' + o[0] + '）' : '')
}

/** 槽位名去掉单位型号那几个词，留「Armor」「MainTurret」这种 */
const slotLabel = (name: string): string => name.split(/\s+/)[0] || name

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
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)

  const list = useMemo(() => {
    const text = q.trim().toLowerCase()
    const all = Object.entries(data.units)
      .map(([id, u]) => ({ id: Number(id), name: u[U.name], cost: u[U.cost], cat: u[U.cat] }))
      .filter((u) => u.name && u.cost > 0)
    const hit = text ? all.filter((u) => u.name.toLowerCase().includes(text)) : all
    return hit.sort((a, b) => b.cost - a.cost).slice(0, 60)
  }, [q, data])

  const slots = data.unitOptions[value.unit] || []

  return (
    <div className="pick">
      <div className="pick-head">
        <span className="pick-title">{title}</span>
        <button className="pick-name" onClick={() => setOpen(!open)}>
          {profile ? profile.name : '选一个单位'}
          <span className="dim"> {profile ? profile.cost + ' 分 · ' + CLASS_NAME[profile.klass] : ''}</span>
          <span className="dim"> ▾</span>
        </button>
      </div>

      {open && (
        <div className="pick-list">
          <input autoFocus value={q} placeholder="搜单位" onChange={(e) => setQ(e.target.value)} />
          <div className="pick-items">
            {list.map((u) => (
              <button
                key={u.id}
                className={u.id === value.unit ? 'on' : ''}
                onClick={() => {
                  onChange({ unit: u.id, opts: defaultOpts(data, u.id) })
                  setOpen(false)
                }}
              >
                {u.name}
                <span className="dim">{u.cost}</span>
              </button>
            ))}
            {!list.length && <div className="dim">没搜到</div>}
          </div>
        </div>
      )}

      {profile && (
        <div className="pick-stats dim">
          HP {profile.hp}
          {profile.klass === 'inf' ? (
            <> · 护甲 {profile.infArmor}</>
          ) : (
            <>
              {' '}
              · 动能 {profile.kin.join('/')} · 破甲 {profile.heat.join('/')}
            </>
          )}
          {profile.abilities.aps && <> · APS {profile.abilities.aps.qty} 发</>}
          {profile.abilities.ecm < 1 && <> · ECM ×{profile.abilities.ecm}</>}
        </div>
      )}

      <div className="pick-slots">
        {slots.map(([name, opts], i) => (
          <label key={name + i} className="pick-slot">
            <span className="dim">{slotLabel(name)}</span>
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
