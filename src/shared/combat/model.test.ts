// 计算器的算法测试。用手搓的小数据，不依赖游戏文件；
// 最后再拿软件自带的那份真数据做两个「别算出离谱结果」的检查。
import { describe, expect, it } from 'vitest'
import { COMBAT, type CombatData } from '../game/combat'
import {
  aoeCurve,
  aoeFactor,
  apsAgainst,
  armorAt,
  canTarget,
  cycleTime,
  engage,
  guidedHit,
  isGuided,
  lethalRadius,
  damageOf,
  penAt,
  profileOf,
  totalDps,
  buildingFactor,
  bypassCover,
  fuseFactor,
  RADIOFUSE,
  usesRadioFuse,
  infantryFactor,
  shotAt,
  simulate,
  STRESS,
  stressLevels,
  stressPenalty,
  unguidedHit,
  type AmmoProfile
} from './model'

/** 一门坦克炮 + 一辆坦克 + 一个步兵班，够测了 */
const DATA: CombatData = {
  meta: { updatedAt: '2026-09-21', stamp: 'test' },
  units: {
    // 倒数第二位是目标类型位（4 = 车辆，2 = 步兵），最后一位是在不在军械库里
    1: ['测试坦克', 200, 7, 3.4, 2.3, 1000, 1, 2, 0, 2, 4, 1],
    2: ['测试步兵', 60, 4, 4, 2, 1000, 0.6, 1, 0, 1, 2, 1],
    3: ['步兵·火箭筒版', 70, 4, 4, 2, 1000, 0.6, 1, 0, 1, 2, 1],
    4: ['测试飞机', 150, 15, 10, 4, 1000, 1, 6, 0, 2, 16, 1]
  },
  armors: {
    10: [17, 800, 150, 100, 60, 1300, 500, 200, 100, 0], // 坦克
    11: [40, 0, 0, 0, 0, 0, 0, 0, 0, 6] // 步兵
  },
  unitArmor: { 1: 10, 2: 11, 3: 11, 4: 11 },
  turrets: {
    1: [
      [100, 0, 'MainTurret', 1, 0],
      [101, 0, 'MainTurret', 0, 0],
      // 同轴机枪是主炮塔的子炮塔：换主炮就跟着换
      [102, 1, 'CupolaTurret', 1, 100],
      [105, 1, 'CupolaTurret', 0, 101]
    ],
    // 两个一模一样的挂架，各带 2 发
    4: [
      [103, 0, 'Pylon', 1, 0],
      [104, 1, 'Pylon', 1, 0]
    ]
  },
  // [武器id, 发射通道]
  turretWeapons: {
    100: [[200, 0]],
    101: [[201, 0]],
    102: [[202, 1]],
    105: [[202, 1]],
    103: [[205, 0]],
    104: [[205, 1]]
  },
  weapons: {
    // [名字, 弹匣, 装填min, max, 点射min, max, 点射内间隔, 点射间min, max, 瞄准min, max, 行进间, 稳定, 雷达, 跟踪, 可合并]
    200: ['120mm 炮', 1, 6, 7, 1, 1, 0, 1, 1, 1.5, 2.5, 0, 1, 0, 1, 0],
    201: ['130mm 炮', 1, 8, 8, 1, 1, 0, 1, 1, 2, 2, 0, 1, 0, 1, 0],
    202: ['同轴机枪', 30, 6, 8, 4, 8, 0.4, 0.8, 0.8, 1, 1, 1, 1, 0, 1, 0],
    203: ['步枪', 30, 4, 4, 1, 1, 0, 4, 4, 1, 1, 1, 1, 0, 1, 0],
    204: ['火箭筒', 1, 5, 6, 1, 1, 0, 1, 1, 1.5, 1.5, 0, 1, 0, 1, 0],
    205: ['挂架导弹', 1, 99, 99, 1, 1, 0, 4, 4, 1, 1, 0, 1, 0, 1, 1]
  },
  weaponAmmo: {
    '1:200': [[300, 16]],
    '1:201': [[301, 16]],
    '1:202': [[302, 900]],
    '2:203': [[303, 200]],
    '3:203': [[303, 200]],
    '3:204': [[304, 6]],
    '4:205': [[304, 2]]
  },
  ammo: {
    // [名字, 伤害, 压制, 穿近, 穿远, 地面射程, 低空, 高空, 目标位图, 装甲类型, AOE, AOE压制, 超压,
    //  顶攻, 可拦, 激光, 散布H, V, 最小射程, 暴击, 无视掩体, 伤害不衰减, 导引头, 最小散布, 抛射角, 抛射高度, 近炸距离]
    300: [
      '尾翼稳定脱壳穿甲弹',
      10,
      120,
      800,
      500,
      700,
      0,
      0,
      36,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      1.8,
      1.5,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0
    ],
    301: ['破甲弹', 11.5, 120, 400, 400, 700, 0, 0, 39, 2, 9, 9, 0, 0, 0, 0, 1.8, 1.5, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    302: ['7.62 机枪弹', 0.75, 16, 20, 10, 300, 0, 0, 47, 1, 0, 0, 0, 0, 0, 0, 2, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    303: ['5.56 步枪弹', 1.2, 12, 15, 7, 250, 0, 0, 47, 1, 0, 0, 0, 0, 0, 0, 2, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    // 制导：散布两个字段是「基础命中 / 抗干扰」
    304: ['反坦克导弹', 8.5, 200, 500, 500, 250, 0, 0, 36, 2, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 100, 0, 0, 0, 0],
    305: ['大炸弹', 175, 500, 300, 300, 0, 0, 0, 1, 2, 175, 175, 15, 0, 0, 0, 65, 65, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    // 防空弹：制导 + 溅射 + 近炸引信，打飞机走近炸
    306: [
      '防空导弹',
      20,
      300,
      250,
      250,
      0,
      900,
      900,
      16,
      2,
      40,
      40,
      0,
      0,
      1,
      0,
      0.68,
      0.8,
      0,
      1,
      0,
      0,
      100,
      0,
      0,
      0,
      // 近炸距离照真实数据取溅射半径的 0.8 倍
      32
    ]
  },
  abilities: {
    // [名字, APS, 拦截数, 冷却, 覆盖, ECM, 诱饵, 诱饵数, 诱饵乘数, 持续, 冷却, 烟雾, 激光, 雷达]
    50: ['Trophy', 1, 4, 6, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    51: ['Shtora', 0, 0, 0, 0, 0.7, 0, 0, 0, 0, 0, 0, 0, 0],
    52: ['热焰弹', 0, 0, 0, 0, 0, 1, 25, 0.85, 3, 1, 0, 0, 0]
  },
  unitAbilities: { 1: [51] },
  options: {
    900: { t: { 0: 101 } }, // 换主炮
    901: { a: 11 }, // 换一身纸装甲
    902: { b: [50] }, // 加 APS
    903: { u: 3 } // 步兵换成火箭筒版
  },
  squad: {
    2: [
      [203, 0, 1],
      [203, 0, 2],
      [203, 0, 3]
    ],
    3: [
      [203, 204, 1],
      [203, 0, 2],
      [203, 0, 3]
    ]
  },
  unitOptions: {},
  unitSpecs: {},
  specs: {},
  countries: { 1: '俄罗斯', 2: '美国' },
  sensors: {},
  mobility: {}
}

const tank = (): ReturnType<typeof profileOf> => profileOf(1, [], DATA)
const inf = (): ReturnType<typeof profileOf> => profileOf(2, [], DATA)
const ammo = (id: number, over: Partial<AmmoProfile> = {}): AmmoProfile => {
  const p = profileOf(1, [], DATA)!
  const all = p.weapons.flatMap((w) => w.ammo)
  const found = all.find((a) => a.id === id)
  if (found) return { ...found, ...over }
  const a = DATA.ammo[id]
  return {
    id,
    name: a[0],
    qty: 1,
    dmg: a[1],
    stress: a[2],
    penMin: a[3],
    penFar: a[4],
    range: a[5],
    lowAlt: a[6],
    highAlt: a[7],
    targetMask: a[8],
    armorType: a[9],
    aoe: a[10],
    aoeStress: a[11],
    overpressure: a[12],
    topAttack: !!a[13],
    intercept: !!a[14],
    laser: !!a[15],
    dispH: a[16],
    dispV: a[17],
    minRange: a[18],
    noFalloff: !!a[21],
    seeker: a[22],
    ignoreCover: a[20] || 0,
    radioFuse: a[26] || 0,
    dispMin: a[23],
    loftAngle: a[24],
    loftHeight: a[25],
    ...over
  }
}

describe('看一个单位的配装', () => {
  it('默认拿默认炮塔，不会把变体也算进去', () => {
    const p = tank()!
    expect(p.weapons.map((w) => w.name).sort()).toEqual(['120mm 炮', '同轴机枪'])
    expect(p.hp).toBe(17)
    expect(p.kin).toEqual([800, 150, 100, 60])
    expect(p.klass).toBe('armor')
  })

  it('配装换炮塔：同一个槽位换成另一门炮', () => {
    const p = profileOf(1, [900], DATA)!
    expect(p.weapons.map((w) => w.name).sort()).toEqual(['130mm 炮', '同轴机枪'])
  })

  it('配装换装甲、加能力', () => {
    const p = profileOf(1, [901, 902], DATA)!
    expect(p.hp).toBe(40)
    expect(p.abilities.aps?.qty).toBe(4)
    expect(p.abilities.ecm).toBe(0.7) // 自带的 Shtora 还在
  })

  it('步兵按班组算武器，几个人拿就是几把', () => {
    const p = inf()!
    expect(p.klass).toBe('inf')
    const rifle = p.weapons.find((w) => w.name === '步枪')!
    expect(rifle.count).toBe(3)
  })

  it('有的配装是整个换一个单位（步兵的班组变体）', () => {
    const p = profileOf(2, [903], DATA)!
    expect(p.unitId).toBe(3)
    expect(p.weapons.map((w) => w.name).sort()).toEqual(['步枪', '火箭筒'])
  })
})

describe('穿深和伤害', () => {
  it('穿深按距离线性掉', () => {
    const a = ammo(300)
    expect(penAt(a, 0)).toBe(800)
    expect(penAt(a, 700)).toBe(500)
    expect(penAt(a, 350)).toBe(650)
    // 近远一样的（导弹）不掉
    expect(penAt(ammo(304), 200)).toBe(500)
  })

  it('动能弹看动能装甲，破甲弹看破甲装甲', () => {
    const t = tank()!
    expect(armorAt(t, ammo(300), 'front')).toBe(800)
    expect(armorAt(t, ammo(301), 'front')).toBe(1300)
    expect(armorAt(t, ammo(300), 'side')).toBe(150)
    // 顶攻直接算顶部
    expect(armorAt(t, ammo(300, { topAttack: true }), 'front')).toBe(60)
    // 步兵只有一个护甲值
    expect(armorAt(inf()!, ammo(300), 'front')).toBe(6)
  })

  it('穿得动满伤，穿不动按公式打折（不是直接归零）', () => {
    const p = tank()!
    const w = p.weapons.find((w) => w.name === '120mm 炮')!
    // 500 米上穿深 586，正面装甲 800：穿不动，但动能公式还剩 10 × (1 + (586-800)/586)
    const front = shotAt(w, ammo(300), p, 500, 'front')
    expect(front.through).toBe(false)
    expect(front.dmg).toBeCloseTo(6.35, 1)
    expect(front.shots).toBe(3)

    const side = shotAt(w, ammo(300), p, 500, 'side')
    expect(side.through).toBe(true)
    expect(side.dmg).toBe(10) // 侧面 150，穿得动就是满伤
    expect(side.shots).toBe(2) // 17 血 ÷ 10
    expect(side.seconds).toBeGreaterThan(8) // 得等一次装填
  })

  it('打一发平均要多久：弹匣 + 装填 + 瞄准', () => {
    const p = tank()!
    const gun = p.weapons.find((w) => w.name === '120mm 炮')!
    // 弹匣 1 发：装填 6.5 + 瞄准 2 = 8.5
    expect(cycleTime(gun)).toBeCloseTo(8.5, 1)
    const mg = p.weapons.find((w) => w.name === '同轴机枪')!
    // 30 发的弹匣打完再装填，平均每发远小于 1 秒
    expect(cycleTime(mg)).toBeLessThan(1)
  })

  it('够不着 / 不对这类目标用', () => {
    const p = tank()!
    const w = p.weapons.find((x) => x.name === '同轴机枪')!
    expect(shotAt(w, ammo(302), p, 500, 'side').inRange).toBe(false) // 机枪 300 米
    // 目标位图：穿甲弹 36 = 车辆(4) + 船(32)，没有步兵位(2)
    expect(canTarget(ammo(300), 'inf')).toBe(false)
    expect(canTarget(ammo(300), 'armor')).toBe(true)
    // 机枪 47 = 1+2+4+8+32，步兵、车辆、直升机都在里面，飞机(16)不在
    expect(canTarget(ammo(302), 'inf')).toBe(true)
    expect(canTarget(ammo(302), 'heli')).toBe(true)
    expect(canTarget(ammo(302), 'plane')).toBe(false)
  })
})

describe('命中率 · 非制导（游戏的 CalculateWeaponHitChance）', () => {
  it('距离 0 时散布为 0，必中', () => {
    expect(unguidedHit(ammo(300), tank()!, 0)).toBe(1)
  })

  it('距离越远散布越大，命中率越低', () => {
    const t = inf()! // 4×4×2
    // 散布大到超过目标尺寸才看得出差别
    const spread = ammo(302, { dispH: 20, dispV: 10, range: 500 })
    const near = unguidedHit(spread, t, 100)
    const far = unguidedHit(spread, t, 300)
    expect(near).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
    expect(far).toBeLessThan(1)
  })

  it('目标越大越好打', () => {
    const small = { ...inf()!, size: { len: 1, wid: 1, hei: 1 } }
    const big = inf()!
    expect(unguidedHit(ammo(302), big, 300)).toBeGreaterThan(unguidedHit(ammo(302), small, 300))
  })

  it('目标比散布还大就是必中', () => {
    // 坦克炮散布 1.8×1.5 米，坦克 7×3.4×2.3 米：min(H,宽)=H、min(V,高)=V → 1
    expect(unguidedHit(ammo(300), tank()!, 700)).toBe(1)
  })
})

describe('命中率 · 制导（游戏的 CalculateMissileHitChance）', () => {
  it('导引头 > 0 才算制导，散布两个字段改成命中率和抗干扰', () => {
    expect(isGuided(ammo(304))).toBe(true)
    expect(isGuided(ammo(300))).toBe(false)
    const h = guidedHit(ammo(304), profileOf(2, [], DATA)!, { flares: 0 })
    expect(h.accuracy).toBe(1)
    expect(h.resist).toBe(0)
    expect(h.total).toBe(1)
  })

  it('ECM 直接乘', () => {
    const t = profileOf(1, [], DATA)! // 自带 Shtora ×0.7
    expect(guidedHit(ammo(304), t, { flares: 0 }).total).toBeCloseTo(0.7, 3)
  })

  it('干扰弹按发数指数衰减：((1-抗干扰) × 乘数)^n', () => {
    const t = profileOf(2, [], DATA)!
    t.abilities.decoy = { qty: 25, mul: 0.85, duration: 3, cooldown: 1 }
    expect(guidedHit(ammo(304), t, { flares: 1 }).total).toBeCloseTo(0.85, 3)
    expect(guidedHit(ammo(304), t, { flares: 2 }).total).toBeCloseTo(0.7225, 3)
    expect(guidedHit(ammo(304), t, { flares: 0 }).total).toBe(1)
    // 抗干扰 0.5 的导弹只被削一半
    const hard = ammo(304, { dispV: 0.5 })
    expect(guidedHit(hard, t, { flares: 1 }).total).toBeCloseTo(0.425, 3)
  })

  it('射手被压制也是直接乘', () => {
    const t = profileOf(2, [], DATA)!
    expect(guidedHit(ammo(304), t, { flares: 0, stress: 0.6 }).total).toBeCloseTo(0.6, 3)
  })
})

describe('AOE（游戏的 DealAOEDamage）', () => {
  it('距离从目标外壳算起，不是中心', () => {
    const t = tank()! // 外壳半径 ≈ 3.9
    // 落在外壳上 = 满伤
    expect(aoeFactor(ammo(305), t.bounds, t.bounds)).toBe(1)
    // 中心到爆点 = 外壳 + 半径 → 刚好出圈
    expect(aoeFactor(ammo(305), t.bounds + 175, t.bounds)).toBe(0)
  })

  it('线性衰减：一半半径处剩一半伤害', () => {
    const t = tank()!
    expect(aoeFactor(ammo(305), t.bounds + 87.5, t.bounds)).toBeCloseTo(0.5, 2)
  })

  it('标了「伤害不衰减」的在半径内一律满伤', () => {
    const t = tank()!
    const flat = ammo(305, { noFalloff: true })
    expect(aoeFactor(flat, t.bounds + 100, t.bounds)).toBe(1)
  })

  it('距离超过 100 米一律没伤害（游戏里夹到 100）', () => {
    const t = tank()!
    expect(aoeFactor(ammo(305), t.bounds + 120, t.bounds)).toBe(0)
  })

  it('曲线从满伤降到 0，致死半径算得出来', () => {
    const t = tank()!
    const c = aoeCurve(ammo(305), t)
    expect(c[0].dmg).toBe(175)
    expect(c[c.length - 1].dmg).toBe(0)
    // 175 伤害打 17 血：d = 175 × (1 − 17/175) ≈ 158，但游戏夹到 100
    expect(lethalRadius(ammo(305), t)).toBeCloseTo(100 + t.bounds, 1)
    // 伤害不够就炸不死
    expect(lethalRadius(ammo(301), t)).toBeNull()
  })
})

describe('发射通道', () => {
  it('同一个通道上的武器不能同时开火，总输出只算最强的那件', () => {
    const p = tank()!
    const gun = p.weapons.find((w) => w.name === '120mm 炮')!
    const mg = p.weapons.find((w) => w.name === '同轴机枪')!
    expect(gun.channel).toBe(0)
    expect(mg.channel).toBe(1) // 不同通道，能一起打
    // 打坦克侧面：主炮和同轴机枪都够得着、都能锁这类目标，分属两个通道
    const list = engage(p, p, 300, 'side')
    const { dps, byChannel } = totalDps(list)
    expect(byChannel.length).toBe(2)
    expect(dps).toBeCloseTo(byChannel[0].dps + byChannel[1].dps, 2)
  })
})

describe('伤害公式（从 GameAssembly.dll 读出来的）', () => {
  it('破甲弹是条曲线：穿深等于装甲时正好一半', () => {
    // 伤害 × 穿深² ÷ (穿深² + 装甲²)
    expect(damageOf(10, 500, 500, 2)).toBeCloseTo(5, 2)
    expect(damageOf(10, 1000, 500, 2)).toBeCloseTo(8, 2) // 1000²/(1000²+500²) = 0.8
    expect(damageOf(10, 250, 500, 2)).toBeCloseTo(2, 2) // 0.2
    // 打不穿也不是零
    expect(damageOf(10, 100, 1300, 2)).toBeGreaterThan(0)
  })

  it('动能弹：穿得动满伤，穿不动线性掉到 0（装甲 ≥ 2 倍穿深）', () => {
    expect(damageOf(10, 800, 800, 1)).toBe(10)
    expect(damageOf(10, 900, 800, 1)).toBe(10)
    // 穿 800 打装甲 1200：10 × (1 + (800-1200)/800) = 5
    expect(damageOf(10, 800, 1200, 1)).toBeCloseTo(5, 2)
    // 装甲正好两倍穿深 → 0
    expect(damageOf(10, 800, 1600, 1)).toBe(0)
    expect(damageOf(10, 800, 2000, 1)).toBe(0)
  })

  it('动能弹有个 10% 的下限，但归零之后就没有了', () => {
    // 10 × (1 + (800-1550)/800) = 0.625 < 1（基础的 10%）→ 抬到 1
    expect(damageOf(10, 800, 1550, 1)).toBe(1)
    expect(damageOf(10, 800, 1599, 1)).toBe(1)
    expect(damageOf(10, 800, 1601, 1)).toBe(0)
  })
})

describe('合并挂架', () => {
  it('两个同型挂架并成一个，间隔按总弹量摊', () => {
    const p = profileOf(4, [], DATA)!
    const w = p.weapons.filter((x) => x.name === '挂架导弹')
    expect(w.length).toBe(1) // 并成一个了
    expect(w[0].pylons).toBe(2)
    expect(w[0].mag).toBe(4) // 2 个挂架 × 2 发
    // 平均间隔 4 秒 ÷ 总弹量 4 ^ 1 = 1 秒
    expect(w[0].dtBurst).toBeCloseTo(1, 2)
  })
})

describe('APS', () => {
  it('只有标了可拦截的弹药才受影响，拦截次数 +1 发就能穿过去', () => {
    const t = profileOf(1, [902], DATA)!
    expect(apsAgainst(ammo(304), t).saturate).toBe(5) // Trophy 拦 4 发
    expect(apsAgainst(ammo(300), t).aps).toBeNull() // 穿甲弹拦不住
  })
})

describe('自动选弹种（照游戏的 SelectBestShellForTarget）', () => {
  it('位图不让打的弹药选不出来', () => {
    const tankP = tank()!
    const infP = inf()!
    const vsInf = engage(tankP, infP, 200, 'front')
    const gun = vsInf.find((e) => e.weapon.name === '120mm 炮')!
    // 穿甲弹的位图里没有步兵位，打步兵时轮不到它
    expect(gun.best?.name).not.toBe('尾翼稳定脱壳穿甲弹')
  })

  it('按「命中率 × 实际伤害」挑，所以会自己避开打不动的弹种', () => {
    const tankP = tank()!
    const gun = engage(tankP, tankP, 300, 'front').find((e) => e.weapon.name === '120mm 炮')!
    expect(gun.best?.name).toBe('尾翼稳定脱壳穿甲弹')
    // 同一门炮打步兵时，穿甲弹的位图不让打，只能换别的
    const vsInf = engage(tankP, inf()!, 200, 'front').find((e) => e.weapon.name === '120mm 炮')!
    expect(vsInf.best?.name).not.toBe('尾翼稳定脱壳穿甲弹')
  })

  it('够不着的武器选不出弹药', () => {
    const tankP = tank()!
    const far = engage(tankP, tankP, 900, 'side')
    expect(far.every((e) => e.best === null)).toBe(true)
  })
})

describe('拿软件自带的真数据兜一遍', () => {
  const ready = Object.keys(COMBAT.units || {}).length > 0
  it.runIf(ready)('主战坦克互打：正面打不穿、侧面两发死', () => {
    const abrams = profileOf(191, [], COMBAT)
    const t90 = profileOf(238, [], COMBAT)
    expect(abrams && t90).toBeTruthy()
    const gun = abrams!.weapons.find((w) => /120/.test(w.name))!
    const sabot = gun.ammo.find((a) => /APFSDS/i.test(a.name))!
    expect(shotAt(gun, sabot, t90!, 500, 'front').through).toBe(false)
    const side = shotAt(gun, sabot, t90!, 500, 'side')
    expect(side.through).toBe(true)
    expect(side.shots).toBe(2)
  })

  it.runIf(ready)('每个单位都能算出来，不会抛异常也不会出 NaN', () => {
    let ok = 0
    for (const id of Object.keys(COMBAT.units).slice(0, 200)) {
      const p = profileOf(Number(id), [], COMBAT)
      if (!p) continue
      for (const e of engage(p, p, 300, 'side')) {
        for (const x of e.all) {
          expect(Number.isFinite(x.result.hit)).toBe(true)
          expect(Number.isFinite(x.result.dps)).toBe(true)
        }
      }
      ok++
    }
    expect(ok).toBeGreaterThan(100)
  })
})

describe('压制与掉人', () => {
  it('黄线红线按 MaxStress 折算，步兵的黄线更低', () => {
    expect(stressLevels(tank()!)).toEqual({ shocked: 500, panicked: 800 })
    expect(stressLevels(inf()!)).toEqual({ shocked: 400, panicked: 800 })
  })

  it('挨打先变黄再变红，红的时刻不早于黄', () => {
    const t = tank()!
    const victim = profileOf(1, [901], DATA)! // 纸装甲的坦克，打得动
    const sim = simulate(engage(t, victim, 300, 'side'), victim, { limit: 60 })
    expect(sim.shockedAt).not.toBeNull()
    if (sim.shockedAt != null && sim.panickedAt != null) expect(sim.panickedAt).toBeGreaterThanOrEqual(sim.shockedAt)
    const kinds = sim.events.map((e) => e.kind)
    expect(kinds.indexOf('shocked')).toBeLessThan(kinds.indexOf('panicked') < 0 ? 99 : kinds.indexOf('panicked'))
  })

  it('同一个发射通道只出一件武器', () => {
    const t = tank()!
    const victim = profileOf(1, [901], DATA)!
    const sim = simulate(engage(t, victim, 300, 'side'), victim, { limit: 30 })
    const channels = sim.firing.map((f) => f.weapon.channel)
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('步兵按 DeathPriority 掉人：数字大的先死，火箭筒手最后走', () => {
    const t = tank()!
    const squad = profileOf(3, [], DATA)!
    expect(squad.squad.map((m) => m.death)).toEqual([1, 2, 3])
    const sim = simulate(engage(t, squad, 200, 'front'), squad, { limit: 400 })
    const fallen = sim.events.filter((e) => e.kind === 'soldier')
    expect(fallen.length).toBe(3)
    expect(fallen[0].text).toContain('步枪')
    expect(fallen[2].text).toContain('火箭筒')
    // 每死一个人，血量正好跨过一格
    expect(sim.hpPerSoldier).toBeCloseTo(squad.hp / 3, 2)
  })

  it('停火之后恢复是加速的：第一秒 2 点，之后每秒多 1 点', () => {
    expect(STRESS.recovery).toBe(1)
    const sim = simulate([], inf()!, { limit: 5 })
    expect(sim.recoveryFirst).toBe(2)
    // 没人开火就一直是 0，也不会掉到负数
    expect(sim.samples.every((s) => s.stress === 0)).toBe(true)
  })

  it('压制惩罚按兵种取：步兵红了瞄准要 3 倍时间', () => {
    expect(stressPenalty(inf()!, 2).aim).toBe(3)
    expect(stressPenalty(tank()!, 2).aim).toBe(2)
    expect(stressPenalty(tank()!, 0).reload).toBe(1)
  })
})

describe('发射通道', () => {
  it('通道 0 = 不占通道，每件武器各算各的', () => {
    // CanUseFiringChannel 一进门就是 test esi,esi / je 返回 true
    const squad = profileOf(3, [], DATA)!
    expect(squad.weapons.every((w) => w.channel === 0)).toBe(true)
    const t = profileOf(1, [901], DATA)!
    // 步枪 + 火箭筒都要算进总输出，不是只算最能打的那件
    const total = totalDps(engage(squad, t, 200, 'front'))
    expect(total.byChannel.length).toBe(2)
  })

  it('同一个非零通道上的武器只算最能打的那件', () => {
    const t = tank()!
    // 主炮和同轴都在通道 0，各算各的；炮塔顶那挺在通道 1
    const victim = profileOf(1, [901], DATA)!
    const total = totalDps(engage(t, victim, 300, 'side'))
    const one = total.byChannel.filter((c) => c.channel === 1)
    expect(one.length).toBeLessThanOrEqual(1)
    expect(total.dps).toBeCloseTo(
      total.byChannel.reduce((s, c) => s + c.dps, 0),
      2
    )
  })
})

describe('子炮塔跟着父炮塔换', () => {
  it('换主炮，挂在它下面的同轴也跟着换', () => {
    const base = profileOf(1, [], DATA)!
    expect(base.weapons.map((w) => w.id).sort()).toEqual([200, 202])
    // 900 = 换主炮（101），它的子炮塔是 105
    const swapped = profileOf(1, [900], DATA)!
    expect(swapped.weapons.map((w) => w.id).sort()).toEqual([201, 202])
    expect(swapped.weapons.length).toBe(2)
  })
})

describe('步兵减伤和楼房', () => {
  it('步兵抗打击：clamp01(floor + 每人 × 存活人数)，压到红就不扛打了', () => {
    // 冷静/黄：0.36 + 0.02×人数；红：0.1 + 0.1×人数
    expect(infantryFactor(10, 0)).toBeCloseTo(0.56, 6)
    expect(infantryFactor(10, 1)).toBeCloseTo(0.56, 6)
    expect(infantryFactor(10, 2)).toBeCloseTo(1, 6)
    // 人越死越少，剩下的反而越扛打
    expect(infantryFactor(3, 0)).toBeCloseTo(0.42, 6)
    // 封顶 1，不会放大伤害
    expect(infantryFactor(50, 0)).toBe(1)
  })

  it('楼里：0.18 + 0.02 × 楼里总人数', () => {
    expect(buildingFactor(10)).toBeCloseTo(0.38, 6)
    expect(buildingFactor(0)).toBeCloseTo(0.18, 6)
    expect(buildingFactor(100)).toBe(1)
  })

  it('无视掩体按比例抵消减伤', () => {
    expect(bypassCover(0.5, 0)).toBeCloseTo(0.5, 6)
    expect(bypassCover(0.5, 1)).toBeCloseTo(1, 6)
    expect(bypassCover(0.5, 0.5)).toBeCloseTo(0.75, 6)
  })

  it('朋友那个例子：10 人班组独占一栋楼、IgnoreCover 0 → 21.28%', () => {
    expect(infantryFactor(10, 0) * buildingFactor(10)).toBeCloseTo(0.2128, 4)
  })

  it('平地上的车辆不吃这套减伤', () => {
    const t = tank()!
    const r = shotAt(t.weapons[0], ammo(300), profileOf(1, [901], DATA)!, 300, 'side')
    expect(r.mul).toBe(1)
  })

  it('伤害够大就不吃楼房减伤（BuildingDamageThreshold = 5）', () => {
    const t = tank()!
    const squad = inf()!
    // 120mm 单发 10 > 5：楼房那条不生效，只剩步兵自己的
    const big = shotAt(t.weapons[0], ammo(300, { ignoreCover: 0 }), squad, 200, 'front', { building: 10 })
    expect(big.mul).toBeCloseTo(infantryFactor(3, 0), 3)
    // 机枪单发 0.75 < 5：两条都吃
    const small = shotAt(t.weapons[0], ammo(302, { ignoreCover: 0 }), squad, 200, 'front', { building: 10 })
    expect(small.mul).toBeCloseTo(infantryFactor(3, 0) * buildingFactor(10), 3)
  })
})

describe('近炸引信', () => {
  it('擦身距离按 p × 近炸距离，取 p ≤ 1 那一支积分', () => {
    const sam = ammo(306) // 近炸 12、溅射 40… 用 fixture 里那发防空弹
    expect(usesRadioFuse(sam)).toBe(true)
    // 近炸 32 / 溅射 40：平均 = 1 − 0.8 × avg(p)，p 在 [0.6, 1] 上均匀 → 0.36
    expect(fuseFactor(sam)).toBeCloseTo(0.36, 2)
    // 和游戏自己写死的预估常量对得上（0.33），说明这个读法没错
    expect(Math.abs(fuseFactor(sam) - RADIOFUSE.avgDamage)).toBeLessThan(0.05)
  })

  it('非制导的不算近炸：步枪弹也带这个字段，那是命中检测半径', () => {
    expect(usesRadioFuse(ammo(303, { radioFuse: 5 }))).toBe(false)
    expect(fuseFactor(ammo(303, { radioFuse: 5 }))).toBe(1)
  })

  it('近炸会把伤害打到三分之一上下，不再一发秒飞机', () => {
    const plane = profileOf(4, [], DATA)!
    const sam = ammo(306)
    const full = damageOf(sam.dmg, 250, 0, sam.armorType)
    const withFuse = damageOf(sam.dmg * fuseFactor(sam), 250, 0, sam.armorType)
    expect(withFuse).toBeLessThan(full * 0.5)
  })
})
