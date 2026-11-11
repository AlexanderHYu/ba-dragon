// 界面上不用 emoji：图标统一用 Tabler 线条图标（components/Icon.tsx）。
// 这个测试扫一遍界面代码，注释以外出现 emoji 就失败，免得以后又加回来。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 常见 emoji 区段 + 以前用来当图标的几个符号（⚙ ✕ ▶ ⬆ ⬇ ↻ ⛶ ⤢ ❚ ✓ ⚠ ℹ）
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{25B6}\u{21BB}\u{2934}-\u{2935}\u{2139}\u{FE0F}]/u

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(tsx?|css|html)$/.test(name) && !name.endsWith('.test.ts') ? [p] : []
  })
}

/** 去掉注释：// 行注释、/* 块注释 *\/、{/* JSX 注释 *\/} */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

describe('界面不用 emoji', () => {
  it('src/renderer 里注释以外没有 emoji', () => {
    const hits: string[] = []
    for (const f of files(join(__dirname))) {
      stripComments(readFileSync(f, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          const m = line.match(EMOJI)
          if (m) hits.push(`${f.replace(__dirname, 'renderer')}:${i + 1} ${m[0]}  ${line.trim().slice(0, 80)}`)
        })
    }
    expect(hits).toEqual([])
  })
})
