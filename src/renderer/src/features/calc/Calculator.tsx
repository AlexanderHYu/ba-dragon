// 配装计算器：选攻击单位、目标、距离，剩下的自己算——
// 哪件武器会用哪种弹、打不打得中、穿不穿得动、几发几秒打死、溅射能盖多远。
import { useEffect, useMemo, useState } from 'react'
import { COMBAT, type CombatData } from '@shared/game/combat'
import {
  CLASS_NAME,
  FACE_NAME,
  aoeCurve,
  armorAt,
  damageMul,
  penAt,
  canTarget,
  rangeFor,
  apsAgainst,
  engage,
  guidedHit,
  ignoresCountermeasures,
  isGuided,
  lethalRadius,
  defaultOpts,
  buildingFactor,
  infantryFactor,
  profileOf,
  fuseFactor,
  RADIOFUSE,
  simulate,
  toM,
  usesRadioFuse,
  stressPenalty,
  STRESS_NAME,
  totalDps,
  type AmmoProfile,
  type Engagement,
  type Facing,
  type Situation,
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
  /** 目标躲的那栋楼里一共几个人（0 = 在平地上） */
  const [inBuilding, setInBuilding] = useState(false)
  const [stress, setStress] = useState(1)
  /** 近炸起爆距离比例 p（MIN ~ 1）；null = 按随机分布取平均 */
  const [fuseP, setFuseP] = useState<number | null>(null)
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
  // 楼里的人数就按目标这一个班算（一个班占一栋楼）
  const occupants = inBuilding ? T?.squad.length || 0 : 0
  const opts = useMemo(
    () => ({ flares, stress, building: occupants, ...(fuseP != null ? { fuse: fuseP } : {}) }),
    [flares, stress, occupants, fuseP]
  )
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
  // 溅射也要过装甲：穿深按这个距离算，装甲按打哪面取，再带上减伤（步兵/楼里/近炸）
  const aoeCtx = useMemo(
    () =>
      aoe && T
        ? // 溅射曲线自己就是「离爆心多远打多少」，不能再乘近炸的平均系数（以前乘了，爆心只剩 36%）
          { pen: penAt(aoe, dist), armor: armorAt(T, aoe, facing), mul: damageMul(T, aoe, { ...opts, fuse: 'none' }) }
        : { pen: 0, armor: 0 },
    [aoe, T, dist, facing, opts]
  )
  const anyGuided = list.some((e) => e.best && isGuided(e.best))
  // 带近炸引信的第一种弹：滑条旁边按它显示起爆距离和系数
  const fuseAmmo = list.map((e) => e.best).find((a): a is AmmoProfile => !!a && usesRadioFuse(a))
  /** 只算开关打开的那些武器 */
  const onList = useMemo(() => list.filter((e, i) => !off.has(keyOf(e, i))), [list, off])
  const total = useMemo(() => totalDps(onList), [onList])

  return (
    <div className="calc">
      <div className="card">
        <h2>
          <span className="ico">🧮</span>
          配装计算器
          <span className="dim">基于游戏本体算法{data.meta?.updatedAt ? ' · 数据 ' + data.meta.updatedAt : ''}</span>
        </h2>

        <div className="calc-pickers">
          <UnitPicker title="攻击方" data={data} value={attacker} onChange={setAttacker} profile={A}>
            {anyGuided && (
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
                <span className="dim">受压制时导弹命中率下降</span>
              </label>
            )}
            {fuseAmmo && (
              <label className="calc-range">
                近炸{' '}
                <b>
                  {fuseP == null
                    ? '平均 ×' + fuseFactor(fuseAmmo)
                    : '距外壳 ' + toM(fuseP * fuseAmmo.radioFuse) + ' m 起爆 ×' + fuseFactor(fuseAmmo, fuseP)}
                </b>
                <input
                  type="range"
                  min={RADIOFUSE.pMin}
                  max={1}
                  step={0.02}
                  value={fuseP ?? RADIOFUSE.pMin + (1 - RADIOFUSE.pMin) / 2}
                  onChange={(e) => setFuseP(Number(e.target.value))}
                  title="起爆距离（距目标外壳）：越靠左越近，伤害越高；最左为游戏中可能出现的最近距离（引信半径的 60%），最右为引信半径边缘"
                />
                {fuseP == null ? (
                  <span className="dim">起爆距离随机，拖动可固定</span>
                ) : (
                  <button className="calc-mini" onClick={() => setFuseP(null)}>
                    恢复平均
                  </button>
                )}
              </label>
            )}
          </UnitPicker>
          <UnitPicker title="目标" data={data} value={target} onChange={setTarget} profile={T}>
            {anyGuided && (
              <label className="calc-range">
                干扰弹 <b>{flares}</b> 发
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={flares}
                  onChange={(e) => setFlares(Number(e.target.value))}
                />
              </label>
            )}
            {T?.klass === 'inf' && T.squad.length > 0 && (
              <label className="calc-check">
                <input type="checkbox" checked={inBuilding} onChange={(e) => setInBuilding(e.target.checked)} />
                驻守建筑
                <span className="dim">按本班 {T.squad.length} 人计算</span>
              </label>
            )}
          </UnitPicker>
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
            <span className="dim">最大 {toM(maxRange)} m</span>
          </label>
          <div className="calc-faces">
            受击面
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
                title={'设为 ' + r.name + ' 的最大射程'}
                onClick={() => setDist(r.range)}
              >
                {r.name} {toM(r.range)}
                {r.n > 1 && <span className="dim"> ×{r.n}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {A && T && (
        <>
          <div className="card">
            <h2>
              {A.name} 对 {T.name}
              <span className="dim">
                {CLASS_NAME[T.klass]} · HP {T.hp} ·{' '}
                {!T.directional
                  ? '装甲 ' + T.armorValue + '（全向）'
                  : FACE_NAME[facing] +
                    ' 动能 ' +
                    T.kin[FACES.indexOf(facing)] +
                    ' / 破甲 ' +
                    T.heat[FACES.indexOf(facing)]}
                {T.klass === 'inf' && T.squad.length > 0 && (
                  <>
                    {' · '}
                    <b title="步兵伤害系数：clamp01(0.36 + 0.02 × 存活人数)；崩溃（红）状态下为 0.1 + 0.1 × 人数">
                      伤害系数 ×{infantryFactor(T.squad.length, 0).toFixed(2)}
                    </b>
                    <span className="dim">（满编 {T.squad.length} 人）</span>
                    {occupants > 0 && (
                      <>
                        {' · '}
                        <b title="建筑内伤害系数：clamp01(0.18 + 0.02 × 建筑内总人数)，仅对单发伤害小于 5 的弹药生效">
                          建筑内 ×{buildingFactor(occupants).toFixed(2)}
                        </b>
                      </>
                    )}
                  </>
                )}
              </span>
            </h2>

            <div className="calc-scroll">
              <table className="t calc-table">
                <thead>
                  <tr>
                    <th className="calc-onoff" title="取消勾选后不计入「同时开火总输出」和曲线">
                      计入
                    </th>
                    <th>武器</th>
                    <th>弹种</th>
                    <th className="num" title="非制导：按散布和目标投影面积计算；制导：基础命中 × ECM × 干扰弹 × 状态">
                      命中率
                    </th>
                    <th className="num" title="当前距离的穿深 / 目标受击面装甲">
                      穿深/装甲
                    </th>
                    <th
                      className="num"
                      title="破甲弹：伤害 × 穿深² ÷ (穿深² + 装甲²)；动能弹：击穿时满伤，未击穿时 × (1 + (穿深−装甲)/穿深)，下限 10%"
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
                    <th className="num" title="期望伤害 ÷ 每发耗时，班组武器乘以人数">
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
                      target={T}
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
                      fuse={fuseP ?? undefined}
                      onToggle={() => setOpen(open === i ? null : i)}
                    />
                  ))}
                  {!list.length && (
                    <tr>
                      <td colSpan={11} className="dim">
                        该单位无武器
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {total.byChannel.length > 0 && (
              <div className="calc-total">
                <b>同时开火总输出 {total.dps}/秒</b>
                <span className="dim">
                   · 通道 0 的武器各自独立开火；同一非零通道上的武器互斥，只计秒伤最高的一件：
                  {total.byChannel
                    .map((c) => (c.channel ? ' 通道' + c.channel + ' ' : ' ') + c.weapon + '(' + c.dps + ')')
                    .join('，')}
                </span>
              </div>
            )}
            <div className="dim calc-note">
              每件武器自动选用可攻击该类目标、在射程内且期望伤害最高的弹种；点击一行查看该武器的全部弹种。
              命中率、选弹、伤害、溅射、目标类型判定均按游戏本体机器码实现，系数读自游戏文件。
              穿甲不是二值判定：破甲弹伤害 = 伤害×穿深²÷(穿深²+装甲²)，穿深等于装甲时为一半；
              动能弹击穿时满伤，未击穿时 × (1 + (穿深−装甲)/穿深)，装甲达到穿深两倍时归零，此前最低 10%。
              目标外壳半径为估算值（游戏使用碰撞体，数据中只有长宽高）。
            </div>
          </div>

          <div className="card">
            <h2>伤害与压制曲线</h2>
            <StressPanel target={T} list={onList} sit={opts} />
          </div>

          <div className="cols">
            <div className="card">
              <h2>干扰与拦截</h2>
              <Missiles target={T} list={list} flares={flares} stress={stress} />
            </div>

            <div className="card">
              <h2>
                溅射伤害 · 距离
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
                  <AoeChart
                    curve={aoeCurve(aoe, T, aoeCtx)}
                    hp={T.hp}
                    bounds={T.bounds}
                    radius={aoe.aoe}
                    fuse={aoe.radioFuse}
                  />
                  <div className="calc-aoe-info">
                    <span>
                      爆心 <b>{aoe.dmg}</b> 伤害 · 半径 <b>{toM(aoe.aoe)} m</b>
                      {aoe.noFalloff && <>（无衰减，半径内均为满伤）</>}
                    </span>
                    <span>
                      一发击杀范围：落点距 {T.name} 中心{' '}
                      <b>
                        {lethalRadius(aoe, T, aoeCtx) == null ? '—' : toM(lethalRadius(aoe, T, aoeCtx) as number)} m
                      </b>{' '}
                      以内（{T.hp} HP）
                    </span>
                    <span className="dim">
                      距离从目标外壳起算（{T.name} 外壳半径 {toM(T.bounds)} m），目标越大越容易受到溅射；
                      超出溅射半径无伤害。
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty">当前武器无溅射弹药</div>
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
function StressPanel({
  target,
  list,
  sit
}: {
  target: UnitProfile
  list: Engagement[]
  sit: Situation
}): React.JSX.Element {
  const sim = useMemo(() => simulate(list, target, { limit: 90, sit }), [list, target, sit])
  // 近炸引信是全游戏唯一一处单发伤害自带随机的地方：贴脸炸最疼、擦边炸最不疼。
  // 有近炸弹参战就把最好和最坏两条血线也算出来，画成一条带子。
  const hasFuse = sim.firing.some((f) => usesRadioFuse(f.ammo))
  const best = useMemo(
    () => (hasFuse ? simulate(list, target, { limit: 90, sit: { ...sit, fuse: 'best' } }) : null),
    [hasFuse, list, target, sit]
  )
  const worst = useMemo(
    () => (hasFuse ? simulate(list, target, { limit: 90, sit: { ...sit, fuse: 'worst' } }) : null),
    [hasFuse, list, target, sit]
  )
  const deaths = sim.events.filter((e) => e.kind === 'soldier').map((e) => e.t)
  const tiers = useMemo(() => {
    const by = new Map<number, string[]>()
    for (const m of target.squad) by.set(m.death, [...(by.get(m.death) || []), m.name])
    return [...by.entries()].sort((a, b) => b[0] - a[0])
  }, [target])

  if (!sim.firing.length) {
    return <div className="empty">当前距离没有武器能攻击该目标</div>
  }

  return (
    <>
      <div className="calc-stress-top">
        <span className={sim.shockedAt == null ? 'dim' : 'lit-warn'}>
          变黄 <b>{sim.shockedAt == null ? '未达到' : sim.shockedAt + 's'}</b>
        </span>
        <span className={sim.panickedAt == null ? 'dim' : 'lit-bad'}>
          变红 <b>{sim.panickedAt == null ? '未达到' : sim.panickedAt + 's'}</b>
        </span>
        <span>
          击杀 <b>{sim.deadAt == null ? '无法击杀' : sim.deadAt + 's'}</b>
        </span>
        {hasFuse && best && worst && (
          <span className="dim" title="近炸引信起爆距离随机：在最近处起爆伤害最高，在引信半径边缘起爆伤害最低">
            近炸范围 <b className="lit-ok">最好 {best.deadAt == null ? '无法击杀' : best.deadAt + 's'}</b> ~{' '}
            <b className="lit-bad">最坏 {worst.deadAt == null ? '无法击杀' : worst.deadAt + 's'}</b>
          </span>
        )}
        {sim.intercepted > 0 && (
          <span className="dim" title="APS 每 6 秒拦截一发，拦截弹耗尽后失效">
            APS 拦截 <b>{sim.intercepted}</b> 发（剩余 {sim.apsLeft}）
          </span>
        )}
        <span className="grow" />
        <span className="dim">
          压制速率 {sim.stressPerSec}/秒 · 上限 {target.maxStress} · 黄线 {sim.shocked} / 红线 {sim.panicked}
        </span>
      </div>

      <StressChart
        samples={sim.samples}
        best={best?.samples}
        worst={worst?.samples}
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
              {f.dry != null && <b className="lit-bad"> · {f.dry}s 弹药耗尽</b>}
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
            {!sim.events.length && <li className="dim">无状态变化</li>}
          </ul>
        </div>

        <div>
          <div className="calc-sub">
            {target.squad.length ? '阵亡顺序（DeathPriority 高者先阵亡，同级随机）' : '各压制状态下的属性修正'}
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
        压制每 1 秒结算一次：受到攻击时，伤害折算为压制值累加（弹药自带的 StressDamage + 上限 × 掉血比例）；
        未受攻击时压制值下降，停火第 1 秒降 {sim.recoveryFirst} 点，之后每秒多降 1 点，因此间断射击难以维持压制。
        变红后，压制值降到红线以下才会降级。
        {target.squad.length > 0 && (
          <>
            {' '}
            步兵按血量阵亡：{target.squad.length} 人共 {target.hp} 血，每人 {sim.hpPerSoldier}，
            血量每减少一格阵亡 1 人，阵亡顺序按 SquadMembers 表中的 DeathPriority。
          </>
        )}{' '}
        未计入：弹丸飞行时间、导弹中途丢失、溅射对周边单位的压制。
      </div>
    </>
  )
}

function Row({
  e,
  target,
  on,
  onSwitch,
  open,
  onToggle,
  fuse
}: {
  e: Engagement
  target: UnitProfile
  on: boolean
  onSwitch: () => void
  open: boolean
  onToggle: () => void
  /** 近炸按哪一档：不给 = 平均，数字 = 滑条固定的起爆距离比例 */
  fuse?: number
}): React.JSX.Element {
  const r = e.result
  const a = e.best
  return (
    <>
      <tr
        className={'calc-row' + (open ? ' open' : '') + (on ? '' : ' calc-row-off')}
        onClick={onToggle}
        title="点击查看该武器的全部弹种"
      >
        <td className="calc-onoff" onClick={(ev) => ev.stopPropagation()}>
          <input
            type="checkbox"
            checked={on}
            disabled={!r}
            onChange={onSwitch}
            title="是否计入「同时开火总输出」和曲线"
          />
        </td>
        <td>
          {e.weapon.name}
          {e.weapon.count > 1 && <span className="dim"> ×{e.weapon.count}</span>}
          {/* 双联 TOW 那种「先急后慢」的节奏：弹匣打完要长装填，前几发间隔短 */}
          {e.weapon.mag > 1 && e.weapon.reload > 0 && (
            <span
              className="dim calc-mag"
              title={
                '弹匣 ' +
                e.weapon.mag +
                ' 发，打空后装填 ' +
                e.weapon.reload +
                ' 秒。前 ' +
                e.weapon.mag +
                ' 发连续发射，第 ' +
                (e.weapon.mag + 1) +
                ' 发需等待装填。「击杀时间」按此节奏逐发计算，不按平均射速估算'
              }
            >
              {' '}
              {e.weapon.mag} 发 / 装填 {e.weapon.reload}s
            </span>
          )}
          {e.weapon.pylons > 1 && (
            <span className="dim" title="同型挂架合并齐射，发射间隔按总弹量均摊">
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
                {usesRadioFuse(a) && (
                  <i
                    className="tag warn"
                    title={
                      '近炸引信：起爆距离 = random(' +
                      RADIOFUSE.pMin +
                      '~' +
                      RADIOFUSE.pMax +
                      ') × ' +
                      toM(a.radioFuse) +
                      ' m，在引信半径内起爆，无直击伤害。' +
                      '按溅射衰减积分的平均伤害为 ' +
                      Math.round(fuseFactor(a) * 100) +
                      '%（游戏内预估常量为 33%）' +
                      (fuse != null ? '。当前按滑条固定在距外壳 ' + toM(fuse * a.radioFuse) + ' m 起爆' : '')
                    }
                  >
                    近炸 {toM(a.radioFuse)}m · ×{fuseFactor(a, fuse ?? 'avg')}
                  </i>
                )}
                {a.intercept && <i className="tag warn">可被拦</i>}
              </span>
            </>
          ) : (
            <span className="dim">无法攻击（超出射程，或不用于此类目标）</span>
          )}
        </td>
        <td className="num">{r ? pct(r.hit) : '—'}</td>
        <td className="num">{r ? r.pen + ' / ' + r.armor : '—'}</td>
        <td className="num">
          {r ? (
            <span
              className={r.dmg <= 0 ? 'lit-bad' : r.through ? 'lit-ok' : ''}
              title={r.through ? '击穿，满伤' : '未击穿，按公式衰减'}
            >
              {r.dmg <= 0 ? '无伤害' : r.dmg}
            </span>
          ) : (
            '—'
          )}
          {r && r.mul < 1 && (
            <span className="dim" title="基础伤害先乘以减伤系数（步兵 / 建筑内），再代入装甲公式">
              {' '}
              ×{r.mul}
            </span>
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
              <div className="calc-alt-head">{e.weapon.name} 全部弹种</div>
              <table className="t">
                <thead>
                  <tr>
                    <th>弹药</th>
                    <th className="num">备弹</th>
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
                        {!result.usable && <span className="dim"> · 不用于此类目标</span>}
                        {!result.inRange && <span className="lit-bad"> · 超出射程</span>}
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
          <span title={ignoresCountermeasures(sample) ? '反辐射 / 激光导引头不参与干扰弹计算' : undefined}>
            干扰弹 <b>{ignoresCountermeasures(sample) ? '免疫' : h.cm === 1 ? '无' : Math.round(h.cm * 1000) / 1000}</b>
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
        <div className="dim">无制导弹药，命中率仅由散布和目标大小决定。</div>
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
          <span>突破 APS 所需齐射数</span>
        </div>
      </div>

      <div className="dim calc-note">
        干扰弹效果按发数指数叠加：n 发为 <code>((1 − 弹药抗干扰) × 干扰弹乘数)ⁿ</code>。APS
        只拦截标有「可被拦」的弹药（导弹、反坦克火箭等），无法拦截动能弹和炸弹；拦截次数耗尽或处于 6
        秒冷却期间，后续弹药不会被拦截。
      </div>
    </div>
  )
}
