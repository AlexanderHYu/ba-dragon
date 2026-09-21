// 配装计算器：选一个攻击单位、一个目标，看每件武器每种弹药打上去是什么结果。
// 数据来自游戏自带的表；哪些是直读、哪些是推算，表格和下面的说明里都标了。
import { useEffect, useMemo, useState } from 'react'
import { COMBAT, type CombatData } from '@shared/game/combat'
import {
  CLASS_NAME,
  FACE_NAME,
  aoeCurve,
  canTarget,
  hitChance,
  lethalRadius,
  profileOf,
  shotAt,
  type AmmoProfile,
  type Facing,
  type Falloff,
  type UnitProfile
} from '@shared/combat/model'
import UnitPicker, { defaultOpts } from './UnitPicker'
import AoeChart from './AoeChart'
import './calc.css'

const FACES: Facing[] = ['front', 'side', 'rear', 'top']

export default function Calculator(): React.JSX.Element {
  /** 主进程给的那份（本机解过就是最新的），没拿到之前先用打包进来的 */
  const [data, setData] = useState<CombatData>(COMBAT)
  // 默认拿两辆主战坦克对打，配装按游戏的默认件选好
  const [attacker, setAttacker] = useState<{ unit: number; opts: number[] }>(() => ({
    unit: 191,
    opts: defaultOpts(COMBAT, 191)
  }))
  const [target, setTarget] = useState<{ unit: number; opts: number[] }>(() => ({
    unit: 238,
    opts: defaultOpts(COMBAT, 238)
  }))
  const [dist, setDist] = useState(500)
  const [facing, setFacing] = useState<Facing>('front')
  const [falloff, setFalloff] = useState<Falloff>('linear')
  const [decoy, setDecoy] = useState(true)
  const [onlyUsable, setOnlyUsable] = useState(true)

  useEffect(() => {
    void window.BA.getCombatData().then((d) => {
      const c = d as CombatData | null
      if (!c || !Object.keys(c.units || {}).length) return
      setData(c)
      // 本机那份可能和打包的不是同一个游戏版本，配装 id 会变，重新按默认件选一遍
      setAttacker((p) => ({ unit: p.unit, opts: defaultOpts(c, p.unit) }))
      setTarget((p) => ({ unit: p.unit, opts: defaultOpts(c, p.unit) }))
    })
  }, [])

  const A = useMemo(() => profileOf(attacker.unit, attacker.opts, data), [attacker, data])
  const T = useMemo(() => profileOf(target.unit, target.opts, data), [target, data])

  const rows = useMemo(() => {
    if (!A || !T) return []
    const out: { w: (typeof A.weapons)[number]; a: AmmoProfile; r: ReturnType<typeof shotAt> }[] = []
    for (const w of A.weapons) {
      for (const a of w.ammo) {
        const r = shotAt(w, a, T, dist, facing)
        if (onlyUsable && !r.usable) continue
        out.push({ w, a, r })
      }
    }
    return out.sort((x, y) => y.r.dps - x.r.dps || y.r.dmg - x.r.dmg)
  }, [A, T, dist, facing, onlyUsable])

  const maxRange = useMemo(
    () => Math.max(700, ...(A?.weapons.flatMap((w) => w.ammo.map((a) => Math.max(a.range, a.lowAlt, a.highAlt))) || [])),
    [A]
  )

  const aoeAmmo = useMemo(() => rows.filter((x) => x.a.aoe > 0).map((x) => x.a), [rows])
  const [aoePick, setAoePick] = useState(0)
  const aoe = aoeAmmo[Math.min(aoePick, aoeAmmo.length - 1)]

  return (
    <div className="calc">
      <div className="card">
        <h2>
          <span className="ico">🧮</span>
          配装计算器
          <span className="dim">
            数据来自游戏自带的单位表
            {data.meta?.updatedAt ? '（' + data.meta.updatedAt + '）' : ''}
          </span>
        </h2>

        <div className="calc-pickers">
          <UnitPicker
            title="攻击方"
            data={data}
            value={attacker}
            onChange={setAttacker}
            profile={A}
          />
          <UnitPicker title="目标" data={data} value={target} onChange={setTarget} profile={T} />
        </div>

        <div className="calc-controls">
          <label className="calc-range">
            距离 <b>{dist} m</b>
            <input
              type="range"
              min={0}
              max={Math.round(maxRange / 50) * 50}
              step={25}
              value={dist}
              onChange={(e) => setDist(Number(e.target.value))}
            />
          </label>
          <div className="calc-faces">
            打哪面
            {FACES.map((f) => (
              <button key={f} className={facing === f ? 'primary' : ''} onClick={() => setFacing(f)}>
                {FACE_NAME[f]}
              </button>
            ))}
          </div>
          <label className="calc-check">
            <input type="checkbox" checked={onlyUsable} onChange={(e) => setOnlyUsable(e.target.checked)} />
            只看能打这类目标的弹药
          </label>
        </div>
      </div>

      {A && T && (
        <>
          <div className="card">
            <h2>
              打上去什么样
              <span className="dim">
                {A.name} → {T.name}（{CLASS_NAME[T.klass]}，HP {T.hp}
                {T.klass === 'inf' ? '，护甲 ' + T.infArmor : '，' + FACE_NAME[facing] + '动能 ' + T.kin[FACES.indexOf(facing)] + ' / 破甲 ' + T.heat[FACES.indexOf(facing)]}）
              </span>
            </h2>
            <div className="calc-scroll">
              <table className="t calc-table">
                <thead>
                  <tr>
                    <th>武器</th>
                    <th>弹药</th>
                    <th className="num" title="这个距离上的穿深（近距穿深按射程线性掉到远距穿深）">穿深</th>
                    <th className="num" title="目标这一面的装甲（破甲弹看破甲装甲，动能弹看动能装甲）">装甲</th>
                    <th className="num">单发伤害</th>
                    <th className="num" title="打死要几发（血量 ÷ 单发伤害）">几发</th>
                    <th className="num" title="含瞄准和装填">几秒</th>
                    <th className="num" title="持续输出：单发伤害 ÷ 平均每发耗时，班组按人数乘">每秒</th>
                    <th className="num" title="压制条打满要几发">压满</th>
                    <th className="num">射程</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ w, a, r }) => (
                    <tr key={w.id + ':' + a.id} className={r.through ? '' : 'calc-nopen'}>
                      <td>
                        {w.name}
                        {w.count > 1 && <span className="dim"> ×{w.count}</span>}
                      </td>
                      <td>
                        {a.name}
                        <span className="calc-tags">
                          {a.armorType === 1 ? <i className="tag kin">动能</i> : a.armorType === 2 ? <i className="tag heat">破甲</i> : null}
                          {a.aoe > 0 && <i className="tag aoe">AOE {a.aoe}m</i>}
                          {a.topAttack && <i className="tag">顶攻</i>}
                          {a.laser && <i className="tag">激光</i>}
                          {a.intercept && <i className="tag warn">可被 APS 拦</i>}
                          {!r.usable && <i className="tag dimtag">不打这类</i>}
                        </span>
                      </td>
                      <td className="num">{r.pen}</td>
                      <td className="num">{r.armor}</td>
                      <td className="num">
                        {r.through ? r.dmg : <span className="lit-bad">打不穿</span>}
                      </td>
                      <td className="num">{r.shots ?? '—'}</td>
                      <td className="num">{r.seconds ?? '—'}</td>
                      <td className="num">{r.dps || '—'}</td>
                      <td className="num dim">{r.stressShots ?? '—'}</td>
                      <td className={'num' + (r.inRange ? '' : ' lit-bad')}>
                        {Math.round(T.klass === 'plane' ? a.highAlt || a.range : T.klass === 'heli' ? a.lowAlt || a.range : a.range)}
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={10} className="dim">
                        这个单位没有能打这类目标的武器（把上面的勾去掉可以看全部）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="dim calc-note">
              穿深 ≥ 装甲才算打穿（游戏的数值就是照这个调的：M829A4 穿深 840 对 M1A2 正面 850 打不动）。
              「几秒」是从开火算起：瞄准 + 后面每发按弹匣节奏（点射间隔、装填）平摊。
            </div>
          </div>

          <div className="cols">
            <div className="card">
              <h2>导弹打得中吗</h2>
              <MissilePanel target={T} rows={rows} decoy={decoy} onDecoy={setDecoy} />
            </div>

            <div className="card">
              <h2>
                AOE 伤害 · 随距离
                {aoeAmmo.length > 1 && (
                  <select value={aoePick} onChange={(e) => setAoePick(Number(e.target.value))}>
                    {aoeAmmo.map((a, i) => (
                      <option key={a.id + ':' + i} value={i}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </h2>
              {aoe ? (
                <>
                  <AoeChart curve={aoeCurve(aoe, falloff)} hp={T.hp} radius={aoe.aoe} overpressure={aoe.overpressure} />
                  <div className="calc-aoe-info">
                    <span>
                      中心 <b>{aoe.dmg}</b> 伤害 · 半径 <b>{aoe.aoe} m</b>
                      {aoe.overpressure > 0 && (
                        <>
                          {' · '}超压 <b>{aoe.overpressure} m</b>（这圈里按满伤算）
                        </>
                      )}
                    </span>
                    <span>
                      打死 {T.name}（{T.hp} HP）要落在 <b>{lethalRadius(aoe, T.hp, falloff) ?? '—'} m</b> 以内
                    </span>
                    <span className="calc-falloff">
                      衰减模型
                      {(
                        [
                          ['linear', '线性'],
                          ['quadratic', '平方']
                        ] as const
                      ).map(([k, label]) => (
                        <button key={k} className={falloff === k ? 'primary' : ''} onClick={() => setFalloff(k)}>
                          {label}
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="dim calc-note">
                    ⚠ 游戏只给了「AOE 半径」和中心伤害，<b>没给衰减曲线</b>，所以这条线是推的：线性 = 到边缘线性降到 0，
                    平方 = 降得更快（更接近爆炸的实际衰减）。半径和中心伤害是真值。
                  </div>
                </>
              ) : (
                <div className="empty">这一组里没有 AOE 弹药</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MissilePanel({
  target,
  rows,
  decoy,
  onDecoy
}: {
  target: UnitProfile
  rows: { a: AmmoProfile }[]
  decoy: boolean
  onDecoy: (v: boolean) => void
}): React.JSX.Element {
  const missiles = rows.filter((x) => x.a.intercept || x.a.laser || x.a.dispH <= 1.2)
  const sample = missiles[0]?.a
  const h = sample ? hitChance(sample, target, decoy) : null
  const ab = target.abilities
  return (
    <div className="stack">
      <div className="kv">
        <div>
          <b>{ab.ecm === 1 ? '无' : '×' + ab.ecm}</b>
          <span>目标的 ECM</span>
        </div>
        <div>
          <b>{ab.decoy ? '×' + ab.decoy.mul : '无'}</b>
          <span>诱饵（{ab.decoy ? ab.decoy.qty + ' 发，每次 ' + ab.decoy.duration + ' 秒' : '没有'}）</span>
        </div>
        <div>
          <b className={h && h.total < 1 ? 'lit-bad' : ''}>{h ? Math.round(h.total * 100) + '%' : '—'}</b>
          <span>命中率（相对没有干扰时）</span>
        </div>
        <div>
          <b>{ab.aps ? ab.aps.qty + ' 发' : '无'}</b>
          <span>APS 拦截次数{ab.aps ? '（冷却 ' + ab.aps.cooldown + ' 秒）' : ''}</span>
        </div>
      </div>
      <label className="calc-check">
        <input type="checkbox" checked={decoy} onChange={(e) => onDecoy(e.target.checked)} />
        目标正在放诱饵（铝箔条 / 热焰弹）
      </label>
      {ab.aps && (
        <div className="dim calc-note">
          APS 只拦得住标了「可被 APS 拦」的弹药（导弹、火箭弹之类）；动能弹、炸弹拦不住。
          一共 {ab.aps.qty} 发，每拦一次冷却 {ab.aps.cooldown} 秒——
          所以<b>同时打过去几发，或者打完它的拦截次数，就能穿过去</b>。
        </div>
      )}
      <div className="dim calc-note">
        ECM 和诱饵在游戏数据里就是直接乘命中率的，所以这里的百分比 = ECM × 诱饵。
        基础命中率（多远、什么姿态下打得中）游戏没写进数据，这里不猜。
      </div>
    </div>
  )
}
