import { describe, expect, it } from 'vitest'
import { QUICK_LIFE, clock, findMoments, notableRecon, topMoments, type Sortie } from './moments'

let seq = 0
/** 造一次出场：默认 A 队玩家 p1 的一辆 100 分坦克，第 0 秒出、活到最后 */
const S = (o: Partial<Sortie> = {}): Sortie => ({
  pid: 'p1',
  name: '甲',
  team: 0,
  unitId: ++seq,
  unitName: 'T-72B',
  role: 'armor',
  cost: 100,
  lossCost: 100,
  spawn: 0,
  death: null,
  kills: 0,
  dmg: 0,
  refunded: false,
  ...o
})
const DUR = 1200

describe('高光：短时间内大量击杀', () => {
  it('出动 30 秒杀 6 个算高光，并列出同时段对方的阵亡', () => {
    const heli = S({ unitName: 'Ka-52', role: 'heli', cost: 135, spawn: 300, death: 330, kills: 6 })
    const victims = [S({ team: 1, pid: 'p2', name: '乙', death: 310 }), S({ team: 1, pid: 'p2', name: '乙', role: 'inf', death: 320 })]
    const m = findMoments([heli, ...victims], DUR).filter((x) => x.kind === 'highlight')
    expect(m).toHaveLength(1)
    expect(m[0].t0).toBe(300)
    expect(m[0].t1).toBe(330)
    expect(m[0].text).toContain('出动 30 秒击杀 6 个')
    expect(m[0].detail).toContain('同时段 B 队阵亡')
    expect(m[0].detail).toContain('装甲 1')
    expect(m[0].detail).toContain('步兵 1')
  })

  it('活太久的单位杀得再多也不标时间（击杀时间定不下来）', () => {
    const tank = S({ spawn: 0, death: 900, kills: 12 })
    expect(findMoments([tank], DUR).filter((x) => x.kind === 'highlight')).toHaveLength(0)
  })

  it('击杀不够多不算', () => {
    const heli = S({ role: 'heli', spawn: 300, death: 330, kills: 2 })
    expect(findMoments([heli], DUR).filter((x) => x.kind === 'highlight')).toHaveLength(0)
  })
})

describe('犯罪：秒送', () => {
  it('贵的坦克出兵后很快阵亡、没打出伤害，算秒送', () => {
    const t = S({ unitName: 'M1A2 SEPv3', cost: 280, spawn: 100, death: 100 + QUICK_LIFE.armor - 10 })
    const m = findMoments([t], DUR).filter((x) => x.sub === 'quickDeath')
    expect(m).toHaveLength(1)
    expect(m[0].text).toContain('M1A2 SEPv3（280）')
  })

  it('固定翼按固定翼自己的寿命算：活了 30 秒是正常架次，不算秒送', () => {
    const jet = S({ unitName: 'F-22 Raptor', role: 'jet', cost: 300, spawn: 100, death: 130 })
    expect(findMoments([jet], DUR).filter((x) => x.sub === 'quickDeath')).toHaveLength(0)
  })

  it('打出过伤害、杀过人、或者被回收的都不算', () => {
    const base = { cost: 280, spawn: 100, death: 120 }
    const list = [S({ ...base, dmg: 5 }), S({ ...base, kills: 1 }), S({ ...base, refunded: true })]
    expect(findMoments(list, DUR).filter((x) => x.sub === 'quickDeath')).toHaveLength(0)
  })

  it('便宜的单位不算', () => {
    expect(findMoments([S({ cost: 60, spawn: 100, death: 110 })], DUR).filter((x) => x.sub === 'quickDeath')).toHaveLength(0)
  })
})

describe('犯罪：连续损失', () => {
  it('一个人一分钟内丢了 6 个、价值 1200 以上', () => {
    const dead = Array.from({ length: 6 }, (_, i) => S({ cost: 210, lossCost: 210, spawn: 0, death: 600 + i * 8 }))
    const m = findMoments(dead, DUR).filter((x) => x.sub === 'burst')
    expect(m).toHaveLength(1)
    expect(m[0].text).toContain('连续损失 6 个单位')
    expect(m[0].t0).toBe(600)
    expect(m[0].t1).toBe(640)
  })

  it('同样 6 个但分散在十分钟里不算', () => {
    const dead = Array.from({ length: 6 }, (_, i) => S({ cost: 210, lossCost: 210, death: 100 + i * 120 }))
    expect(findMoments(dead, DUR).filter((x) => x.sub === 'burst')).toHaveLength(0)
  })
})

describe('大量阵亡', () => {
  it('一队一分钟内损失远超平时，标出兵种和主要是谁的', () => {
    const wave = [
      ...Array.from({ length: 5 }, (_, i) => S({ pid: 'p1', name: '甲', lossCost: 300, death: 500 + i * 5 })),
      ...Array.from({ length: 3 }, (_, i) => S({ pid: 'p3', name: '丙', role: 'inf', lossCost: 150, death: 520 + i * 5 }))
    ]
    const m = findMoments(wave, DUR).filter((x) => x.kind === 'wipe')
    expect(m).toHaveLength(1)
    expect(m[0].team).toBe(0)
    expect(m[0].pid).toBeNull()
    expect(m[0].detail).toContain('装甲 5')
    expect(m[0].detail).toContain('主要是 甲')
  })

  it('全场匀速掉血不算', () => {
    const even = Array.from({ length: 20 }, (_, i) => S({ lossCost: 300, death: i * 60 }))
    expect(findMoments(even, DUR).filter((x) => x.kind === 'wipe')).toHaveLength(0)
  })
})

describe('侦察', () => {
  it('只有无人机和狙击手算值得标的侦察单位', () => {
    expect(notableRecon({ role: 'recon', unitName: 'RQ-170 Sentinel' })).toBe(true)
    expect(notableRecon({ role: 'recon', unitName: 'Army Snipers' })).toBe(true)
    expect(notableRecon({ role: 'recon', unitName: 'FSB Snaipery' })).toBe(true)
    expect(notableRecon({ role: 'recon', unitName: 'Humvee GMV' })).toBe(false)
    expect(notableRecon({ role: 'armor', unitName: 'MQ-9 Reaper' })).toBe(false)
  })

  it('出了无人机、自己炮兵在场、之后对方损失明显偏多：连起来写', () => {
    const drone = S({ unitName: 'RQ-170 Sentinel', role: 'recon', spawn: 400, death: null })
    const arty = S({ pid: 'p4', name: '丁', role: 'arty', spawn: 0 })
    const enemy = Array.from({ length: 6 }, (_, i) => S({ team: 1, pid: 'p2', name: '乙', lossCost: 200, death: 450 + i * 10 }))
    const m = findMoments([drone, arty, ...enemy], DUR).filter((x) => x.kind === 'recon')
    expect(m).toHaveLength(1)
    expect(m[0].sub).toBe('reconStrike')
    expect(m[0].minor).toBe(false)
    expect(m[0].text).toContain('6:40 出了 RQ-170 Sentinel')
    expect(m[0].detail).toContain('A 队炮兵当时在场')
  })

  it('自己没有炮兵在场：只在时间线上标一下出兵，不进要点', () => {
    const drone = S({ unitName: 'RQ-170 Sentinel', role: 'recon', spawn: 400 })
    const enemy = Array.from({ length: 6 }, (_, i) => S({ team: 1, pid: 'p2', lossCost: 200, death: 450 + i * 10 }))
    const m = findMoments([drone, ...enemy], DUR).filter((x) => x.kind === 'recon')
    expect(m).toHaveLength(1)
    expect(m[0].sub).toBe('reconSpawn')
    expect(m[0].minor).toBe(true)
  })
})

describe('挑进本局要点', () => {
  it('每类有上限，每个人每类最多一条，次要的不进', () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      S({ pid: 'p' + i, name: 'x' + i, role: 'heli', spawn: 100 * i, death: 100 * i + 30, kills: 6 + i })
    )
    const same = S({ pid: 'p4', name: 'x4', role: 'heli', spawn: 700, death: 720, kills: 9 })
    const drone = S({ unitName: 'MQ-9 Reaper', role: 'recon', spawn: 50 })
    const top = topMoments(findMoments([...many, same, drone], DUR))
    const hl = top.filter((m) => m.kind === 'highlight')
    expect(hl).toHaveLength(3)
    expect(new Set(hl.map((m) => m.pid)).size).toBe(3)
    expect(top.some((m) => m.minor)).toBe(false)
  })

  it('什么都没发生的一局一条都没有', () => {
    expect(topMoments(findMoments([S(), S({ team: 1, pid: 'p2' })], DUR))).toEqual([])
  })
})

describe('时间格式', () => {
  it('秒数转成 分:秒', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(65)).toBe('1:05')
    expect(clock(-3)).toBe('0:00')
  })
})
