// 起一次软件，确认窗口渲染出来、IPC 通了（详细断言在 src/main/smoke.ts）。
import { spawnSync } from 'node:child_process'
import electron from 'electron'

const r = spawnSync(electron, ['.'], {
  env: { ...process.env, BA_SMOKE: '1' },
  encoding: 'utf8',
  timeout: 150000
})
const line = (r.stdout || '').split('\n').find((l) => l.startsWith('SMOKE '))
if (!line) {
  console.error(r.stdout, r.stderr)
  console.error('冒烟失败：软件没起来')
  process.exit(1)
}
console.log(line)
process.exit(JSON.parse(line.slice(6)).ok ? 0 : 1)
