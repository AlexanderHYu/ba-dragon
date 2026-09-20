// 配装分组：同一个单位的不同挂载要分开统计，名字带「配装 A / B」
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMatchReport } from './report'
import type { MatchInfo } from '../types/batrace'

const CACHE = join(process.env.APPDATA || '', 'broken-arrow-log-assistant', 'batrace-cache.json')

describe.runIf(existsSync(CACHE))('配装分组', () => {
  if (!existsSync(CACHE)) return
  const cache = JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, { value?: { matchInfo?: MatchInfo } }>
  const entry = Object.entries(cache).find(([k, v]) => k.startsWith('match:') && v?.value?.matchInfo?.Data)
  const fid = entry ? entry[0].slice(6) : ''
  const mi = entry?.[1].value?.matchInfo as MatchInfo

  it('分组后每个单位的出兵总数不变', () => {
    const on = buildMatchReport(mi, { fid })
    const off = buildMatchReport(mi, { fid, groupByLoadout: false })
    const sum = (list: { id: number; team: number; deployed: number }[]): Record<string, number> => {
      const m: Record<string, number> = {}
      for (const u of list) m[u.team + ':' + u.id] = (m[u.team + ':' + u.id] || 0) + u.deployed
      return m
    }
    expect(sum(on.units)).toEqual(sum(off.units))
  })

  it('有多种配装的单位才加「配装 X」后缀', () => {
    const on = buildMatchReport(mi, { fid })
    const byUnit = new Map<string, typeof on.units>()
    for (const u of on.units) {
      const k = u.team + ':' + u.id
      byUnit.set(k, [...(byUnit.get(k) || []), u])
    }
    for (const list of byUnit.values()) {
      if (list.length > 1) for (const u of list) expect(u.name).toMatch(/（配装 [A-Z]）$/)
      else expect(list[0].name).not.toMatch(/（配装 [A-Z]）$/)
    }
  })
})
