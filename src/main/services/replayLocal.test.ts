import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { localReplayTrim, matchLoggedStart, replayQualityOf, videoStartFromProbe, videoStartsFromLog } from './replayLocal'

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

describe('视频开录时间', () => {
  // 录制日志的真实格式（2026-11-18 那局 48 分钟的录像）
  const LOG = [
    '2026-11-17 23:40:13 对局开始，准备录制 fid=9791851 map=Narva',
    '2026-11-18 00:28:23 合成: 声音偏移 -0.110s（T0 1794976813808，第一帧采集于 T0+0.533s；声音起点 1794976814231）',
    '2026-11-18 00:28:23 合成: 麦克风偏移 0.033s（T0 1794976813808，第一帧采集于 T0+0.533s；麦克风起点 1794976814374）',
    '2026-11-18 00:28:59 save: 已保存 9791851________1794979739624__.mp4（2985024492B, 2889s, 含声音）',
    '2026-11-18 01:00:00 对局开始，准备录制 fid=9791900 map=Ruda',
    '2026-11-18 01:30:00 合成: 视频第 0 帧 1794983000123',
    '2026-11-18 01:30:05 save: 已保存 9791900________1794983005000__.mp4（1B, 1s, 纯画面）'
  ].join('\n')

  it('从日志里读出每个录像的第 0 帧时间', () => {
    const list = videoStartsFromLog(LOG)
    expect(list.map((x) => [x.fid, x.start])).toEqual([
      ['9791851', 1794976814341],
      ['9791900', 1794983000123]
    ])
  })
  it('文件名补全过也能按局号和保存时间认出来', () => {
    const list = videoStartsFromLog(LOG)
    const saved = list[0].savedAt
    expect(matchLoggedStart(list, '9791851__40710__1__7__1794979740000__415447.mp4', saved + 1000)).toBe(1794976814341)
    expect(matchLoggedStart(list, '9791851__40710__1__7__1794979740000__415447.mp4', saved + 3600000)).toBeNull()
    expect(matchLoggedStart(list, '1234________1__.mp4', saved)).toBeNull()
  })
  it('从 ffmpeg 输出里读写进 MP4 的开录时间', () => {
    expect(videoStartFromProbe('    comment         : ba_video_start=1794976814341\n')).toBe(1794976814341)
    expect(videoStartFromProbe('no tag')).toBeNull()
  })
})
