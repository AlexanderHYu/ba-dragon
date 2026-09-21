// 计算器的算法测试。用手搓的小数据，不依赖游戏文件；
// 最后再拿软件自带的那份真数据做两个「别算出离谱结果」的检查。
import { describe, expect, it } from 'vitest'
import { COMBAT, type CombatData } from '../game/combat'
import {
  aoeCurve,
  armorAt,
  canTarget,
  cycleTime,
  hitChance,
  lethalRadius,
  penAt,
  profileOf,
  shotAt,
  type AmmoProfile
} from './model'

/** 一门坦克炮 + 一辆坦克 + 一个步兵班，够测了 */
const DATA: CombatData = {
  meta: { updatedAt: '2026-09-21', stamp: 'test' },
  units: {
    1: ['测试坦克', 200, 7, 3.4, 2.3, 1000, 1, 2, 0],
    2: ['测试步兵', 60, 4, 4, 2, 1000, 0.6, 1, 0],
    3: ['步兵·火箭筒版', 70, 4, 4, 2, 1000, 0.6, 1, 0]
  },
  armors: {
    10: [17, 800, 150, 100, 60, 1300, 500, 200, 100, 0], // 坦克
    11: [40, 0, 0, 0, 0, 0, 0, 0, 0, 6] // 步兵
  },
  unitArmor: { 1: 10, 2: 11, 3: 11 },
  turrets: {
    1: [
      [100, 0, 'MainTurret', 1],
      [101, 0, 'MainTurret', 0],
      [102, 1, 'CupolaTurret', 1]
    ]
  },
  turretWeapons: { 100: [200], 101: [201], 102: [202] },
  weapons: {
    // [名字, 弹匣, 装填min, max, 点射min, max, 点射内间隔, 点射间min, max, 瞄准min, max, 行进间, 稳定, 雷达, 跟踪]
    200: ['120mm 炮', 1, 6, 7, 1, 1, 0, 1, 1, 1.5, 2.5, 0, 1, 0, 1],
    201: ['130mm 炮', 1, 8, 8, 1, 1, 0, 1, 1, 2, 2, 0, 1, 0, 1],
    202: ['同轴机枪', 30, 6, 8, 4, 8, 0.4, 0.8, 0.8, 1, 1, 1, 1, 0, 1],
    203: ['步枪', 30, 4, 4, 1, 1, 0, 4, 4, 1, 1, 1, 1, 0, 1],
    204: ['火箭筒', 1, 5, 6, 1, 1, 0, 1, 1, 1.5, 1.5, 0, 1, 0, 1]
  },
  weaponAmmo: {
    '1:200': [[300, 16]],
    '1:201': [[301, 16]],
    '1:202': [[302, 900]],
    '2:203': [[303, 200]],
    '3:203': [[303, 200]],
    '3:204': [[304, 6]]
  },
  ammo: {
    // [名字, 伤害, 压制, 穿近, 穿远, 地面射程, 低空, 高空, 目标位图, 装甲类型, AOE, AOE压制, 超压, 顶攻, 可拦, 激光, 散布H, V, 最小射程, 暴击, 无视掩体]
    300: ['尾翼稳定脱壳穿甲弹', 10, 120, 800, 500, 700, 0, 0, 36, 1, 0, 0, 0, 0, 0, 0, 1.8, 1.5, 0, 1, 0],
    301: ['破甲弹', 11.5, 120, 400, 400, 700, 0, 0, 39, 2, 9, 9, 0, 0, 0, 0, 1.8, 1.5, 0, 1, 0],
    302: ['7.62 机枪弹', 0.75, 16, 20, 10, 300, 0, 0, 47, 1, 0, 0, 0, 0, 0, 0, 2, 2, 0, 1, 0],
    303: ['5.56 步枪弹', 1.2, 12, 15, 7, 250, 0, 0, 47, 1, 0, 0, 0, 0, 0, 0, 2, 2, 0, 1, 0],
    304: ['火箭弹', 8.5, 200, 500, 500, 250, 0, 0, 36, 2, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0],
    305: ['大炸弹', 175, 500, 300, 300, 0, 0, 0, 1, 2, 175, 175, 15, 0, 0, 0, 65, 65, 0, 1, 0]
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

  it('穿得动才有伤害，打死要几发按血量算', () => {
    const p = tank()!
    const w = p.weapons.find((w) => w.name === '120mm 炮')!
    const front = shotAt(w, ammo(300), p, 500, 'front')
    expect(front.through).toBe(false)
    expect(front.dmg).toBe(0)
    expect(front.shots).toBeNull()

    const side = shotAt(w, ammo(300), p, 500, 'side')
    expect(side.through).toBe(true)
    expect(side.dmg).toBe(10)
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
    // 穿甲弹的目标位图里没有步兵
    expect(canTarget(ammo(300), 'inf')).toBe(false)
    expect(canTarget(ammo(302), 'inf')).toBe(true)
    // 有 AOE 的落地就炸，不受位图限制
    expect(canTarget(ammo(305), 'armor')).toBe(true)
  })
})

describe('AOE', () => {
  it('中心满伤，到半径边缘归零', () => {
    const c = aoeCurve(ammo(305), 'linear')
    expect(c[0].dmg).toBe(175)
    expect(c[c.length - 1].dmg).toBe(0)
    // 超压半径里按满伤算
    expect(aoeCurve(ammo(305), 'linear').find((p) => p.d <= 15)?.dmg).toBe(175)
  })

  it('平方衰减掉得比线性快', () => {
    const half = (f: 'linear' | 'quadratic'): number => {
      const c = aoeCurve(ammo(305), f)
      return c[Math.floor(c.length / 2)].dmg
    }
    expect(half('quadratic')).toBeLessThan(half('linear'))
  })

  it('致死半径：多远之内能带走', () => {
    // 175 伤害打 17 血：线性模型下 (1 - 17/175) × 175 ≈ 158 米
    expect(lethalRadius(ammo(305), 17, 'linear')).toBeGreaterThan(150)
    // 平方模型下小得多
    expect(lethalRadius(ammo(305), 17, 'quadratic')!).toBeLessThan(
      lethalRadius(ammo(305), 17, 'linear')!
    )
    // 伤害本来就不够就不可能炸死
    expect(lethalRadius(ammo(304), 17, 'linear')).toBeNull()
  })
})

describe('导弹打得中吗', () => {
  it('ECM 和诱饵直接乘', () => {
    const t = profileOf(1, [], DATA)! // 自带 Shtora ×0.7
    expect(hitChance(ammo(304), t).total).toBeCloseTo(0.7, 3)
    const withDecoy = profileOf(1, [902], DATA)!
    withDecoy.abilities.decoy = { qty: 25, mul: 0.85, duration: 3, cooldown: 1 }
    expect(hitChance(ammo(304), withDecoy).total).toBeCloseTo(0.595, 3)
    // 不放诱饵就只剩 ECM
    expect(hitChance(ammo(304), withDecoy, false).total).toBeCloseTo(0.7, 3)
  })

  it('只有标了可拦截的弹药才受 APS 影响', () => {
    const t = profileOf(1, [902], DATA)!
    expect(hitChance(ammo(304), t).aps?.qty).toBe(4) // 火箭弹可拦
    expect(hitChance(ammo(300), t).aps).toBeNull() // 穿甲弹拦不住
  })
})

describe('拿软件自带的真数据兜一遍', () => {
  const ready = Object.keys(COMBAT.units || {}).length > 0
  it.runIf(ready)('主战坦克互打：正面打不穿、侧面两发死', () => {
    const abrams = profileOf(191, [], COMBAT) // M1A2 SEP v3
    const t90 = profileOf(238, [], COMBAT) // T-90M
    expect(abrams && t90).toBeTruthy()
    const gun = abrams!.weapons.find((w) => /120/.test(w.name))!
    const sabot = gun.ammo.find((a) => /APFSDS/i.test(a.name))!
    expect(shotAt(gun, sabot, t90!, 500, 'front').through).toBe(false)
    const side = shotAt(gun, sabot, t90!, 500, 'side')
    expect(side.through).toBe(true)
    expect(side.shots).toBe(2)
  })

  it.runIf(ready)('每个单位都能算出侧面，不会抛异常', () => {
    let ok = 0
    for (const id of Object.keys(COMBAT.units).slice(0, 200)) {
      const p = profileOf(Number(id), [], COMBAT)
      if (!p) continue
      for (const w of p.weapons) for (const a of w.ammo) shotAt(w, a, p, 300, 'side')
      ok++
    }
    expect(ok).toBeGreaterThan(100)
  })
})
