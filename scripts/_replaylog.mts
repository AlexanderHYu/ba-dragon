import { readFileSync } from 'node:fs'
import { LogParser } from '@shared/log/parser'
const f = process.argv[2]
const events: string[] = []
const p = new LogParser((t, d) => {
  if (['matchStart', 'matchEnd', 'lobbyReset', 'fid'].includes(t)) {
    const m = d as { map?: string; fid?: string } | undefined
    events.push(t + (m?.map ? '(' + m.map + ')' : '') + (typeof d === 'string' ? '(' + d + ')' : ''))
  }
})
p.feed(readFileSync(f, 'utf8').split('\n'))
console.log(f.split(/[\/]/).pop())
console.log('  事件:', events.join(' → ') || '(一个都没有)')
const s = p.snapshot()
console.log('  存档局数:', s.archivedCount, '｜当前对局:', s.current ? s.current.map : '无')
