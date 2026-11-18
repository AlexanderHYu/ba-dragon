import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localReplayTrim, replayQualityOf } from './replayLocal'

describe('localReplayTrim', () => {
  let dir = ''
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  /** 建 n 个录像，第 i 个的修改时间是 i 小时前（0 最新） */
  const make = (n: number): string[] => {
    dir = mkdtempSync(join(tmpdir(), 'ba-trim-'))
    const names: string[] = []
    for (let i = 0; i < n; i++) {
      const name = `${9000000 + i}________${1794370000000 + i}__.mp4`
      const full = join(dir, name)
      writeFileSync(full, 'x')
      const t = (Date.now() - i * 3600 * 1000) / 1000
      utimesSync(full, t, t)
      names.push(name)
    }
    writeFileSync(join(dir, 'notes.txt'), '不是录像，不能删')
    return names
  }

  it('只留最新的 keep 个，其余删掉，别的文件不动', () => {
    const names = make(5)
    expect(localReplayTrim(dir, 2)).toBe(3)
    expect(readdirSync(dir).sort()).toEqual([...names.slice(0, 2), 'notes.txt'].sort())
  })

  it('keep 为 0 或不够数时什么都不删', () => {
    make(3)
    expect(localReplayTrim(dir, 0)).toBe(0)
    expect(localReplayTrim(dir, 5)).toBe(0)
    expect(readdirSync(dir).length).toBe(4)
  })
})

describe('replayQualityOf', () => {
  it('0 是原生分辨率，不能被当成没设置', () => {
    expect(replayQualityOf(0)).toBe(0)
    expect(replayQualityOf('0')).toBe(0)
  })
  it('正常档位原样返回，没设置或乱填按 1080p', () => {
    expect(replayQualityOf(1440)).toBe(1440)
    expect(replayQualityOf(undefined)).toBe(1080)
    expect(replayQualityOf('')).toBe(1080)
    expect(replayQualityOf('abc')).toBe(1080)
  })
})
