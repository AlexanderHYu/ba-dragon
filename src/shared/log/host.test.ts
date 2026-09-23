import { describe, expect, it } from 'vitest'
import { guessHost } from './host'

const P = (id: string, name: string): { id: string; name: string; team: string | null } => ({ id, name, team: null })

describe('反推房主', () => {
  const me = '我'
  it('名单里只剩一个人没在「后来加入」里，那就是房主', () => {
    const players = [P('1', '房主'), P('2', '后来的'), P('9', me)]
    const g = guessHost(players, { '2': '后来的' }, me, true)
    expect(g.known).toBe(true)
    expect(g.id).toBe('1')
    expect(g.me).toBe(false)
  })

  it('我进来时房里没别人 → 我就是房主', () => {
    const players = [P('9', me), P('2', '后来的'), P('3', '再后来的')]
    const g = guessHost(players, { '2': '后来的', '3': '再后来的' }, me, true)
    expect(g.me).toBe(true)
    expect(g.id).toBeNull()
  })

  it('进房之前就有好几个人 → 只能给候选，不点名', () => {
    const players = [P('1', 'A'), P('2', 'B'), P('3', '后来的'), P('9', me)]
    const g = guessHost(players, { '3': '后来的' }, me, true)
    expect(g.id).toBeNull()
    expect(g.candidates.map((c) => c.name)).toEqual(['A', 'B'])
  })

  it('没从头看到进厅那行就不推', () => {
    const players = [P('1', 'A'), P('9', me)]
    expect(guessHost(players, {}, me, false).known).toBe(false)
  })

  it('名单还没出来也不推', () => {
    expect(guessHost([], { '2': 'X' }, me, true).known).toBe(false)
  })
})
