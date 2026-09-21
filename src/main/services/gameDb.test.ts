// 真从游戏文件里读一遍：要本机装着游戏、而且给了密钥（BA_GAME_KEY）才跑，CI 上自动跳过。
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractTables, optionLabel } from './gameDb'

const GAME_DIR = process.env.BA_GAME_DIR || 'D:/SteamLibrary/steamapps/common/broken_arrow'
const KEY = process.env.BA_GAME_KEY || ''
const canExtract = KEY.length === 32 && existsSync(GAME_DIR + '/BrokenArrow_Data/data.unity3d')

describe.runIf(canExtract)('从游戏文件里读单位表', () => {
  if (!canExtract) return
  it('读得出单位和配装', () => {
    const t = extractTables(GAME_DIR, KEY)
    expect(t.units.length).toBeGreaterThan(300)
    expect(t.options.length).toBeGreaterThan(1000)
    // 每个选项都该挂在某个单位的槽位上
    const unitIds = new Set(t.units.map((u) => u.id))
    const orphan = t.options.filter((o) => o.unitId && !unitIds.has(o.unitId))
    expect(orphan.length).toBe(0)
    // 价钱不该有负数
    expect(t.units.every((u) => u.cost >= 0)).toBe(true)
  }, 60000)
})

describe.runIf(canExtract)('配装标签', () => {
  if (!canExtract) return
  it('本地化 key 的选项也能凑出人能看懂的标签', () => {
    const t = extractTables(GAME_DIR, KEY)
    const byUnit = new Map(t.units.map((u) => [u.id, u.name]))
    const keyed = t.options.filter((o) => /^Custom_/i.test(o.uiName || ''))
    expect(keyed.length).toBeGreaterThan(100)
    // 标签里不该再留着槽位词和单位型号，超过 3 个词的算没凑好
    const messy = keyed.filter((o) => optionLabel(o, byUnit.get(o.unitId) || '').split(/\s+/).length > 3)
    expect(messy.length / keyed.length).toBeLessThan(0.05)
  }, 60000)
})
