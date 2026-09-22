// 配装计算器：选攻击单位、目标、距离，剩下的自己算——
// 哪件武器会用哪种弹、打不打得中、穿不穿得动、几发几秒打死、溅射能盖多远。
import { useEffect, useMemo, useState } from 'react'
import { COMBAT, type CombatData } from '@shared/game/combat'
import {
  CLASS_NAME,
  FACE_NAME,
  aoeCurve,
  canTarget,
  rangeFor,
  apsAgainst,
  engage,
  guidedHit,
  isGuided,
  lethalRadius,
  defaultOpts,
  profileOf,
  simulate,
  toM,
  stressPenalty,
  STRESS_NAME,
  totalDps,
  type AmmoProfile,
  type Engagement,
  type Facing,
  type UnitProfile
} from '@shared/combat/model'
import UnitPicker from './UnitPicker'
import AoeChart from './AoeChart'
import StressChart from './StressChart'
import './calc.css'

const FACES: Facing[] = ['front', 'side', 'rear', 'top']
/** 每一行武器的身份：同一件武器可能挂好几份，得带上序号 */
const keyOf = (e: Engagement, i: number): string => e.weapon.id + ':' + i
const pct = (x: number): string => Math.round(x * 100) + '%'

export default function Calculator(): React.JSX.Element {
  /** 主进程给的那份（本机解过就是最新的），没拿到之前先用打包进来的 */
  const [data, setData] = useState<CombatData>(COMBAT)
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
  const [flares, setFlares] = useState(1)
  const [stress, setStress] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  /** 关掉的武器，不参与「同时开火」的总输出和曲线 */
  const [off, setOff] = useState<Set<string>>(new Set())

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

  // 换攻击方就把开关清空
  useEffect(() => setOff(new Set()), [attacker.unit])

  const A = useMemo(() => profileOf(attacker.unit, attacker.opts, data), [attacker, data])
  const T = useMemo(() => profileOf(target.unit, target.opts, data), [target, data])
  const opts = useMemo(() => ({ flares, stress }), [flares, stress])
  const list = useMemo(() => (A && T ? engage(A, T, dist, facing, opts) : []), [A, T, dist, facing, opts])

  // 滑条的上限 = 这个攻击方能够着这类目标的最远射程（打飞机看高空射程，打直升机看低空）
  const ranges = useMemo(() => {
    if (!A || !T) return []
    // 同名同射程的（比如两个一样的火箭巢）合成一条，免得列一排重复的
    const out = new Map<string, { name: string; range: number; n: number }>()
    for (const w of A.weapons) {
      const r = Math.round(Math.max(0, ...w.ammo.filter((a) => canTarget(a, T.klass)).map((a) => rangeFor(a, T))))
      if (r <= 0) continue
      const k = w.name + '@' + r
      const cur = out.get(k)
      if (cur) cur.n++
      else out.set(k, { name: w.name, range: r, n: 1 })
    }
    return [...out.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.range - a.range)
  }, [A, T])
  const maxRange = useMemo(() => Math.ceil(Math.max(100, ...ranges.map((r) => r.range)) / 25) * 25, [ranges])

  // 换了单位之后距离可能超出新的射程，拉回来
  useEffect(() => {
    setDist((d) => Math.min(d, maxRange))
  }, [maxRange])

  // 有溅射的那几种弹，画曲线用
  const aoeList = useMemo(() => {
    const out: AmmoProfile[] = []
    for (const e of list) {
      for (const x of e.all) if (x.ammo.aoe > 0 && !out.some((a) => a.id === x.ammo.id)) out.push(x.ammo)
    }
    return out
  }, [list])
  const [aoePick, setAoePick] = useState(0)
  const aoe = aoeList[Math.min(aoePick, aoeList.length - 1)]
  const anyGuided = list.some((e) => e.best && isGuided(e.best))
  /** 只算开关打开的那些武器 */
  const onList = useMemo(() => list.filter((e, i) => !off.has(keyOf(e, i))), [list, off])
  const total = useMemo(() => totalDps(onList), [onList])

  return (
    <div className="calc">
      <div className="card">
        <h2>
          <span className="ico">🧮</span>
          配装计算器
          <span className="dim">按游戏本体的算法算{data.meta?.updatedAt ? ' · 数据 ' + data.meta.updatedAt : ''}</span>
        </h2>

        <div className="calc-pickers">
          <UnitPicker title="攻击方" data={data} value={attacker} onChange={setAttacker} profile={A} />
          <UnitPicker title="目标" data={data} value={target} onChange={setTarget} profile={T} />
        </div>

        <div className="calc-controls">
          <label className="calc-range">
            距离 <b>{toM(dist)} m</b>
            <input
              type="range"
              min={0}
              max={maxRange}
              step={maxRange > 2000 ? 50 : 25}
              value={Math.min(dist, maxRange)}
              onChange={(e) => setDist(Number(e.target.value))}
            />
            <span className="dim">最远 {toM(maxRange)} m</span>
          </label>
          <div className="calc-faces">
            打哪面
            {FACES.map((f) => (
              <button key={f} className={facing === f ? 'primary' : ''} onClick={() => setFacing(f)}>
                {FACE_NAME[f]}
              </button>
            ))}
          </div>
        </div>
        {!!ranges.length && (
          <div className="calc-ticks">
            <span className="dim">各武器射程</span>
            {ranges.map((r) => (
              <button
                key={r.key}
                className={dist === r.range ? 'primary' : ''}
                title={'跳到 ' + r.name + ' 的最远射程'}
                onClick={() => setDist(r.range)}
              >
                {r.name} {toM(r.range)}
                {r.n > 1 && <span className="dim"> ×{r.n}</span>}
              </button>
            ))}
          </div>
        )}
        {anyGuided && (
          <div className="calc-controls">
            <label className="calc-range">
              目标放了 <b>{flares}</b> 发干扰弹
              <input
                type="range"
                min={0}
                max={4}
                step={1}
                value={flares}
                onChange={(e) => setFlares(Number(e.target.value))}
              />
            </label>
            <label className="calc-range">
              射手状态 <b>{pct(stress)}</b>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.05}
                value={stress}
                onChange={(e) => setStress(Number(e.target.value))}
              />
              <span className="dim">被压制会降命中</span>
            </label>
          </div>
        )}
      </div>

      {A && T && (
        <>
          <div className="card">
            <h2>
              {A.name} 打 {T.name}
              <span className="dim">
                {CLASS_NAME[T.klass]} · HP {T.hp} ·{' '}
                {T.klass === 'inf'
                  ? '护甲 ' + T.infArmor
                  : FACE_NAME[facing] +
                    ' 动能 ' +
                    T.kin[FACES.indexOf(facing)] +
                    ' / 破甲 ' +
                    T.heat[FACES.indexOf(facing)]}
              </span>
            </h2>

            <div className="calc-scroll">
              <table className="t calc-table">
                <thead>
                  <tr>
                    <th className="calc-onoff" title="取消勾选就不算进下面的「同时开火总输出」和曲线">
                      开
                    </th>
                    <th>武器</th>
                    <th>弹种</th>
                    <th className="num" title="非制导按散布和目标投影面积算；制导 = 基础命中 × ECM × 干扰弹 × 状态">
                      命中率
                    </th>
                    <th className="num" title="这个距离上的穿深 vs 目标这一面的装甲">
                      穿深/装甲
                    </th>
                    <th
                      className="num"
                      title="破甲弹：伤害 × 穿深² ÷ (穿深² + 装甲²)；动能弹：穿得动满伤，穿不动按 (1 + (穿深−装甲)/穿深) 打折，有 10% 下限"
                    >
                      单发伤害
                    </th>
                    <th className="num" title="命中 × 直击 + 未命中 × 溅射">
                      单发期望伤害
                    </th>
                    <th className="num">击杀所需数量</th>
                    <th className="num" title="含瞄准和装填，不含弹丸飞行时间">
                      击杀时间
                    </th>
                    <th className="num" title="期望伤害 ÷ 每发耗时，班组按人数乘">
                      秒伤
                    </th>
                    <th className="num">射程</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((e, i) => (
                    <Row
                      key={e.weapon.id + ':' + i}
                      e={e}
                      on={!off.has(keyOf(e, i))}
                      onSwitch={() =>
                        setOff((p) => {
                          const n = new Set(p)
                          const k = keyOf(e, i)
                          if (n.has(k)) n.delete(k)
                          else n.add(k)
                          return n
                        })
                      }
                      open={open === i}
                      onToggle={() => setOpen(open === i ? null : i)}
                    />
                  ))}
                  {!list.length && (
                    <tr>
                      <td colSpan={11} className="dim">
                        这个单位没有武器
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total.byChannel.length > 0 && (
              <div className="calc-total">
                <b>同时开火的总输出 {total.dps} / 秒</b>
                <span className="dim">
                  ——通道 0 的武器各打各的；同一个非零通道上的武器互相挡着，只算最能打的那件：
                  {total.byChannel
                    .map((c) => (c.channel ? ' 通道' + c.channel + ' ' : ' ') + c.weapon + '(' + c.dps + ')')
                    .join('，')}
                </span>
              </div>
            )}
            <div className="dim calc-note">
              每件武器用哪种弹是自动挑的（能打这类目标、够得着、期望伤害最高的那个）；点一行看这把武器的全部弹种。
              命中率、选弹、伤害、溅射、目标类型判定都是照游戏本体的机器码实现的，系数也是从游戏文件里读的。
              <b>穿甲不是二值的</b>：破甲弹按 伤害×穿深²÷(穿深²+装甲²) 走曲线，穿深等于装甲时正好剩一半；
              动能弹穿得动就是满伤，穿不动按 (1 + (穿深−装甲)/穿深) 打折，装甲到穿深两倍才归零（中间有 10% 的下限）。
              唯一还在估的是目标外壳半径（游戏用碰撞体，数据里只有长宽高）。
            </div>
          </div>

          <div className="card">
            <h2>伤害与压制曲线</h2>
            <StressPanel target={T} list={onList} />
          </div>

          <div className="cols">
            <div className="card">
              <h2>干扰与拦截</h2>
              <Missiles target={T} list={list} flares={flares} stress={stress} />
            </div>

            <div className="card">
              <h2>
                溅射 · 随距离
                {aoeList.length > 1 && (
                  <select value={aoePick} onChange={(e) => setAoePick(Number(e.target.value))}>
                    {aoeList.map((a, i) => (
                      <option key={a.id} value={i}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
              </h2>
              {aoe ? (
                <>
                  <AoeChart curve={aoeCurve(aoe, T)} hp={T.hp} bounds={T.bounds} radius={aoe.aoe} />
                  <div className="calc-aoe-info">
                    <span>
                      爆心 <b>{aoe.dmg}</b> 伤害 · 半径 <b>{toM(aoe.aoe)} m</b>
                      {aoe.noFalloff && <>（这种弹不衰减，圈里一律满伤）</>}
                    </span>
                    <span>
                      落点离 {T.name} 中心{' '}
                      <b>{lethalRadius(aoe, T) == null ? '—' : toM(lethalRadius(aoe, T) as number)} m</b> 以内能一发带走
                      （{T.hp} HP）
                    </span>
                    <span className="dim">
                      距离是从目标外壳算的：{T.name} 外壳半径 {toM(T.bounds)} m，所以大目标更容易被溅到； 引擎只处理爆心{' '}
                      {toM(100)} m 以内的单位。
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty">这一组里没有溅射弹药</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * 压制与掉人：把所有能同时开火的武器沿时间轴打一遍，
 * 看目标什么时候变黄、什么时候变红、步兵按什么顺序掉人。
 */
function StressPanel({ target, list }: { target: UnitProfile; list: Engagement[] }): React.JSX.Element {
  const sim = useMemo(() => simulate(list, target, { limit: 90 }), [list, target])
  const deaths = sim.events.filter((e) => e.kind === 'soldier').map((e) => e.t)
  const tiers = useMemo(() => {
    const by = new Map<number, string[]>()
    for (const m of target.squad) by.set(m.death, [...(by.get(m.death) || []), m.name])
    return [...by.entries()].sort((a, b) => b[0] - a[0])
  }, [target])

  if (!sim.firing.length) {
    return <div className="empty">这个距离上没有武器能打到它，自然也压不住</div>
  }

  return (
    <>
      <div className="calc-stress-top">
        <span className={sim.shockedAt == null ? 'dim' : 'lit-warn'}>
          变黄 <b>{sim.shockedAt == null ? '压不黄' : sim.shockedAt + 's'}</b>
        </span>
        <span className={sim.panickedAt == null ? 'dim' : 'lit-bad'}>
          变红 <b>{sim.panickedAt == null ? '压不红' : sim.panickedAt + 's'}</b>
        </span>
        <span>
          打死 <b>{sim.deadAt == null ? '打不死' : sim.deadAt + 's'}</b>
        </span>
        <span className="grow" />
        <span className="dim">
          压制 {sim.stressPerSec}/秒进账，上限 {target.maxStress}（黄 {sim.shocked} 红 {sim.panicked}）
        </span>
      </div>

      <StressChart
        samples={sim.samples}
        shocked={sim.shocked}
        panicked={sim.panicked}
        maxStress={target.maxStress}
        hp={target.hp}
        deaths={deaths}
      />

      <div className="calc-firing dim">
        参战武器：
        {sim.firing.map((f, i) => (
          <span key={i} className="calc-firing-one">
            {f.weapon.name}
            {f.weapon.count > 1 && ' ×' + f.weapon.count}
            <span className="dim">
              {' '}
              / {f.ammo.name} · 备弹 {f.stock}
              {f.dry != null && <b className="lit-bad"> · {f.dry}s 打光</b>}
            </span>
          </span>
        ))}
      </div>

      <div className="calc-stress-cols">
        <div>
          <div className="calc-sub">时间轴</div>
          <ul className="calc-timeline">
            {sim.events.map((e, i) => (
              <li key={i} className={'ev-' + e.kind}>
                <b>{e.t}s</b> {e.text}
              </li>
            ))}
            {!sim.events.length && <li className="dim">一直打不出反应</li>}
          </ul>
        </div>

        <div>
          <div className="calc-sub">
            {target.squad.length ? '掉人顺序（DeathPriority 大的先走，同级随机）' : '压制之后它会变成什么样'}
          </div>
          {target.squad.length ? (
            <ul className="calc-tiers">
              {tiers.map(([p, names]) => (
                <li key={p}>
                  <b>优先级 {p}</b>
                  <span className="dim">{names.join('、')}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <table className="t calc-mod">
            <thead>
              <tr>
                <th>状态</th>
                <th className="num">瞄准</th>
                <th className="num">装填</th>
                <th className="num">散布</th>
                <th className="num">导弹命中</th>
                <th className="num">移动</th>
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((lv) => {
                const m = stressPenalty(target, lv)
                return (
                  <tr key={lv} className={lv === 1 ? 'lit-warn' : lv === 2 ? 'lit-bad' : ''}>
                    <td>{STRESS_NAME[lv]}</td>
                    <td className="num">×{m.aim}</td>
                    <td className="num">×{m.reload}</td>
                    <td className="num">×{m.dispersion}</td>
                    <td className="num">×{m.missile}</td>
                    <td className="num">×{m.move}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dim calc-note">
        压制每 1 秒结算一次：这一秒挨了打就把伤害折成压制值加上去（弹药自带的 StressDamage + 上限 × 掉血比例），
        没挨打就往回退——停火第一秒退 {sim.recoveryFirst} 点，之后每多熬一秒再多退 1 点，所以断断续续打是压不住的。
        变红之后要等压制值掉回红线以下才会降级。
        {target.squad.length > 0 && (
          <>
            {' '}
            步兵按血量掉人：{target.squad.length} 人分 {target.hp} 血，每人 {sim.hpPerSoldier}，
            血量每跨过一格就走一个，走谁看 SquadMembers 表里的 DeathPriority。
          </>
        )}{' '}
        没算进去的：弹丸飞行时间、导弹中途丢失、溅射给旁边单位的压制。
      </div>
    </>
  )
}

function Row({
  e,
  on,
  onSwitch,
  open,
  onToggle
}: {
  e: Engagement
  on: boolean
  onSwitch: () => void
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const r = e.result
  const a = e.best
  return (
    <>
      <tr
        className={'calc-row' + (open ? ' open' : '') + (on ? '' : ' calc-row-off')}
        onClick={onToggle}
        title="点一下看这把武器的全部弹种"
      >
        <td className="calc-onoff" onClick={(ev) => ev.stopPropagation()}>
          <input
            type="checkbox"
            checked={on}
            disabled={!r}
            onChange={onSwitch}
            title="算不算进「同时开火总输出」和曲线"
          />
        </td>
        <td>
          {e.weapon.name}
          {e.weapon.count > 1 && <span className="dim"> ×{e.weapon.count}</span>}
          {e.weapon.pylons > 1 && (
            <span className="dim" title="同型挂架合并齐射，发射间隔按总弹量摊">
              {' '}
              ×{e.weapon.pylons} 挂架合并
            </span>
          )}
        </td>
        <td>
          {a ? (
            <>
              {a.name}
              <span className="calc-tags">
                {isGuided(a) ? <i className="tag">制导</i> : null}
                {a.armorType === 1 ? (
                  <i className="tag kin">动能</i>
                ) : a.armorType === 2 ? (
                  <i className="tag heat">破甲</i>
                ) : null}
                {a.aoe > 0 && <i className="tag aoe">溅射 {toM(a.aoe)}m</i>}
                {a.topAttack && <i className="tag">顶攻</i>}
                {a.intercept && <i className="tag warn">可被拦</i>}
              </span>
            </>
          ) : (
            <span className="dim">打不了（够不着，或者这类目标不用它）</span>
          )}
        </td>
        <td className="num">{r ? pct(r.hit) : '—'}</td>
        <td className="num">{r ? r.pen + ' / ' + r.armor : '—'}</td>
        <td className="num">
          {r ? (
            <span
              className={r.dmg <= 0 ? 'lit-bad' : r.through ? 'lit-ok' : ''}
              title={r.through ? '穿得动，满伤' : '穿不动，按公式打折'}
            >
              {r.dmg <= 0 ? '打不动' : r.dmg}
            </span>
          ) : (
            '—'
          )}
        </td>
        <td className="num">{r ? r.expected : '—'}</td>
        <td className="num">{r?.shots ?? '—'}</td>
        <td className="num">{r?.seconds ?? '—'}</td>
        <td className="num">{r?.dps || '—'}</td>
        <td className="num">{r ? toM(r.range) : '—'}</td>
      </tr>
      {open && (
        <tr className="calc-alt-row">
          <td colSpan={11}>
            <div className="calc-alt">
              <div className="calc-alt-head">{e.weapon.name} 带的全部弹种</div>
              <table className="t">
                <thead>
                  <tr>
                    <th>弹药</th>
                    <th className="num">带弹</th>
                    <th className="num">命中</th>
                    <th className="num">穿深/装甲</th>
                    <th className="num">直击</th>
                    <th className="num">溅射</th>
                    <th className="num">单发期望伤害</th>
                    <th className="num">秒伤</th>
                    <th className="num">射程</th>
                  </tr>
                </thead>
                <tbody>
                  {e.all.map(({ ammo, result }) => (
                    <tr
                      key={ammo.id}
                      className={ammo.id === e.best?.id ? 'calc-alt-me' : result.usable ? '' : 'calc-nopen'}
                    >
                      <td>
                        {ammo.name}
                        {!result.usable && <span className="dim"> · 不用于这类目标</span>}
                        {!result.inRange && <span className="lit-bad"> · 够不着</span>}
                      </td>
                      <td className="num dim">{ammo.qty || '—'}</td>
                      <td className="num">{pct(result.hit)}</td>
                      <td className="num">
                        {result.pen} / {result.armor}
                      </td>
                      <td className="num">{result.dmg > 0 ? result.dmg : '—'}</td>
                      <td className="num">{ammo.aoe > 0 ? result.splash : '—'}</td>
                      <td className="num">{result.expected}</td>
                      <td className="num">{result.dps || '—'}</td>
                      <td className="num">{toM(result.range)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Missiles({
  target,
  list,
  flares,
  stress
}: {
  target: UnitProfile
  list: Engagement[]
  flares: number
  stress: number
}): React.JSX.Element {
  const guided = list.map((e) => e.best).filter((a): a is AmmoProfile => !!a && isGuided(a))
  const sample = guided[0]
  const h = sample ? guidedHit(sample, target, { flares, stress }) : null
  const aps = sample ? apsAgainst(sample, target) : null
  const ab = target.abilities
  return (
    <div className="stack">
      {h ? (
        <div className="calc-formula">
          <span>
            基础 <b>{pct(h.accuracy)}</b>
          </span>
          <span>×</span>
          <span>
            ECM <b>{h.ecm === 1 ? '无' : h.ecm}</b>
          </span>
          <span>×</span>
          <span>
            干扰弹 <b>{h.cm === 1 ? '无' : Math.round(h.cm * 1000) / 1000}</b>
          </span>
          <span>×</span>
          <span>
            状态 <b>{pct(h.stress)}</b>
          </span>
          <span>=</span>
          <span className={h.total < 0.6 ? 'lit-bad' : 'lit-ok'}>
            <b>{pct(h.total)}</b>
          </span>
        </div>
      ) : (
        <div className="dim">这一组里没有制导弹药，命中率只看散布和目标大小。</div>
      )}

      <div className="kv">
        <div>
          <b>{ab.ecm === 1 ? '无' : '×' + ab.ecm}</b>
          <span>目标 ECM</span>
        </div>
        <div>
          <b>{ab.decoy ? ab.decoy.qty + ' 发' : '无'}</b>
          <span>干扰弹{ab.decoy ? '（每发 ×' + ab.decoy.mul + '，持续 ' + ab.decoy.duration + ' 秒）' : ''}</span>
        </div>
        <div>
          <b>{ab.aps ? ab.aps.qty + ' 发' : '无'}</b>
          <span>APS 拦截{ab.aps ? '（冷却 ' + ab.aps.cooldown + ' 秒）' : ''}</span>
        </div>
        <div>
          <b>{aps?.saturate ?? '—'}</b>
          <span>齐射几发能穿过 APS</span>
        </div>
      </div>

      <div className="dim calc-note">
        干扰弹按发数指数衰减：放 n 发就是 <code>((1 − 弹药抗干扰) × 干扰弹乘数)ⁿ</code>，所以连放两发比一发狠得多。 APS
        只拦得住标了「可被拦」的弹药（导弹、反坦克火箭之类），动能弹和炸弹拦不住； 拦截次数用完、或者还在 6
        秒冷却里，后面的就直接进来了。
      </div>
    </div>
  )
}
