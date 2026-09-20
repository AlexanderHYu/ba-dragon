// 卡组工具：左边「前线卡组」（游戏目录里的 .dek），右边「后勤仓库」（备份出来的 .zip）。
// 两边都是多选列表，选中后批量备份／部署／删除。删除有确认框。
import { useCallback, useEffect, useState } from 'react'
import type { BackupFile, DeckFile } from '@shared/ipc'
import './decks.css'

interface DeckData {
  found: boolean
  dir: string
  backupDir: string
  decks: DeckFile[]
  backups: BackupFile[]
}

/** 操作结果：成功/失败 + 一行文案 */
interface Res {
  ok: boolean
  text: string
}

function fmtSize(n: number): string {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

function fmtTime(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

interface Row {
  name: string
  sub: string
  badge?: string
}

/** 多选列表：点一行切换选中，按住不放也不会误触发操作，操作都在下面的按钮上 */
function PickList({
  rows,
  sel,
  onChange,
  empty
}: {
  rows: Row[]
  sel: string[]
  onChange: (next: string[]) => void
  empty: string
}): React.JSX.Element {
  return (
    <div className="deck-list" role="listbox" aria-multiselectable="true">
      {rows.length === 0 ? (
        <div className="deck-list-empty">{empty}</div>
      ) : (
        rows.map((r) => {
          const on = sel.includes(r.name)
          return (
            <div
              key={r.name}
              className={on ? 'deck-item on' : 'deck-item'}
              role="option"
              aria-selected={on}
              title={r.name}
              onClick={() => onChange(on ? sel.filter((n) => n !== r.name) : [...sel, r.name])}
            >
              <span className="deck-check" aria-hidden="true">
                {on ? '✓' : ''}
              </span>
              <span className="deck-name">{r.name}</span>
              {r.badge && <span className="deck-badge">{r.badge}</span>}
              <span className="deck-sub">{r.sub}</span>
            </div>
          )
        })
      )}
    </div>
  )
}

export default function Decks(): React.JSX.Element {
  const [data, setData] = useState<DeckData | null>(null)
  const [front, setFront] = useState<string[]>([])
  const [back, setBack] = useState<string[]>([])
  const [msg, setMsg] = useState<Res | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const d = await window.BA.listDecks()
    setData(d)
    // 列表变了之后，把已经不存在的选中项摘掉
    setFront((s) => s.filter((n) => d.decks.some((x) => x.name === n)))
    setBack((s) => s.filter((n) => d.backups.some((x) => x.name === n)))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (fn: () => Promise<Res>): Promise<void> => {
    setBusy(true)
    try {
      setMsg(await fn())
    } catch (e) {
      setMsg({ ok: false, text: '操作失败：' + String((e as Error)?.message ?? e) })
    } finally {
      setBusy(false)
      await reload()
    }
  }

  const teammates = (
    <div className="card">
      <h2>队友卡组</h2>
      <div className="deck-note">
        <p>看不到，也做不出来。</p>
        <p>
          游戏日志里只有本机玩家自己的 <code>Deck set to:</code> 这一行，队友（和对手）换了什么卡组，日志里根本没写；
          BATrace 的公开接口也只给战绩和单位使用情况，不给对局里每个人的卡组。
        </p>
        <p className="dim">所以这一块不会有数据。这里不放假数据，也不留空列表占位。</p>
      </div>
    </div>
  )

  if (!data) {
    return (
      <>
        <div className="card">
          <h2>卡组工具</h2>
          <div className="empty">读卡组中…</div>
        </div>
        {teammates}
      </>
    )
  }

  if (!data.found) {
    return (
      <>
        <div className="card">
          <h2>卡组工具</h2>
          <div className="deck-note">
            <p>没找到游戏的卡组目录，前线这边就没法操作了。</p>
            <p className="deck-path">{data.dir || '（路径为空）'}</p>
            <p className="dim">
              一般是游戏目录没设对，或者这台机器还没进过游戏（卡组目录要玩过一次才会建出来）。去「设置」里重新指一下游戏目录，再回来刷新。
            </p>
            <p className="dim">备份包目录：{data.backupDir || '—'}</p>
          </div>
          <div className="deck-actions">
            <button disabled={busy} onClick={() => void reload()}>
              刷新
            </button>
            <button disabled={busy} onClick={() => void window.BA.openDeckDir('backups')}>
              📂 打开备份目录
            </button>
          </div>
        </div>
        {teammates}
      </>
    )
  }

  const frontRows: Row[] = data.decks.map((d: DeckFile) => ({
    name: d.name,
    sub: fmtSize(d.size) + ' · ' + fmtTime(d.mtime)
  }))
  const backRows: Row[] = data.backups.map((b: BackupFile) => ({
    name: b.name,
    sub: b.decks + ' 副 · ' + fmtSize(b.size) + ' · ' + fmtTime(b.mtime),
    badge: b.auto ? '上一局' : undefined
  }))

  return (
    <>
      <div className="card">
        <h2>
          卡组工具
          <span className="grow" />
          {busy && <span className="spin" />}
          <button disabled={busy} onClick={() => void reload()}>
            刷新
          </button>
        </h2>

        {msg && <div className={msg.ok ? 'deck-msg ok' : 'deck-msg bad'}>{msg.text}</div>}

        <div className="deck-grid">
          {/* 前线：游戏目录里正在用的卡组 */}
          <section className="deck-col">
            <div className="deck-col-head">
              <h3>
                前线卡组 <span className="dim">(.dek)</span>
              </h3>
              <span className="grow" />
              <span className="dim">
                {front.length ? front.length + '/' : ''}
                {data.decks.length} 副
              </span>
              <button
                className="deck-mini"
                disabled={!data.decks.length}
                onClick={() => setFront(front.length === data.decks.length ? [] : data.decks.map((d) => d.name))}
              >
                {front.length === data.decks.length && data.decks.length ? '清空' : '全选'}
              </button>
            </div>

            <PickList rows={frontRows} sel={front} onChange={setFront} empty="前线目录里没有卡组" />

            <div className="deck-actions">
              <button
                className="primary"
                disabled={busy || !front.length}
                onClick={() =>
                  void run(async () => {
                    const r = await window.BA.backupDecks(front)
                    return 'error' in r
                      ? { ok: false, text: '备份失败：' + r.error }
                      : { ok: true, text: `备份好了：${r.decks} 副 → ${r.file}` }
                  })
                }
              >
                ⬆ 备份选中
              </button>
              <button
                className="primary"
                disabled={busy || !data.decks.length}
                onClick={() =>
                  void run(async () => {
                    const r = await window.BA.backupDecks()
                    return 'error' in r
                      ? { ok: false, text: '备份失败：' + r.error }
                      : { ok: true, text: `全部备份好了：${r.decks} 副 → ${r.file}` }
                  })
                }
              >
                ⬆ 备份全部
              </button>
              <button disabled={busy} onClick={() => void window.BA.openDeckDir('decks')}>
                📂 打开目录
              </button>
              <button
                className="danger"
                disabled={busy || !front.length}
                onClick={() => {
                  const ask =
                    `要删除前线的 ${front.length} 副卡组吗？\n\n` +
                    `${front.join('\n')}\n\n` +
                    '删之前会先自动备份一份当前卡组。'
                  if (!window.confirm(ask)) return
                  void run(async () => {
                    const r = await window.BA.deleteDecks(front)
                    return r.error
                      ? { ok: false, text: '删除失败：' + r.error }
                      : { ok: true, text: `删掉了 ${r.removed} 副卡组（删前已自动备份）` }
                  })
                }}
              >
                🗑 删除所选
              </button>
            </div>
            <div className="deck-tip dim">删卡组之前会自动备份一份当前卡组，删错了能从右边捞回来。</div>
          </section>

          {/* 后勤：备份出来的 zip 包 */}
          <section className="deck-col">
            <div className="deck-col-head">
              <h3>
                后勤仓库 <span className="dim">(.zip)</span>
              </h3>
              <span className="grow" />
              <span className="dim">
                {back.length ? back.length + '/' : ''}
                {data.backups.length} 个
              </span>
              <button
                className="deck-mini"
                disabled={!data.backups.length}
                onClick={() => setBack(back.length === data.backups.length ? [] : data.backups.map((b) => b.name))}
              >
                {back.length === data.backups.length && data.backups.length ? '清空' : '全选'}
              </button>
            </div>

            <PickList rows={backRows} sel={back} onChange={setBack} empty="还没有备份包" />

            <div className="deck-actions">
              <button
                className="primary"
                disabled={busy || back.length !== 1}
                title={back.length > 1 ? '一次只能部署一个包' : undefined}
                onClick={() => {
                  const name = back[0]
                  if (!name) return
                  if (!window.confirm(`把「${name}」部署到前线？\n\n同名卡组会被这个包里的覆盖掉。`)) return
                  void run(async () => {
                    const r = await window.BA.restoreDecks(name, true)
                    if ('error' in r) return { ok: false, text: '部署失败：' + r.error }
                    const skip = r.skipped.length ? `，跳过 ${r.skipped.length} 个（${r.skipped.join('、')}）` : ''
                    return { ok: true, text: `部署了 ${r.restored} 副卡组到前线${skip}` }
                  })
                }}
              >
                ⬇ 部署到前线
              </button>
              <button disabled={busy} onClick={() => void window.BA.openDeckDir('backups')}>
                📂 打开目录
              </button>
              <button
                className="danger"
                disabled={busy || !back.length}
                onClick={() => {
                  const ask =
                    `要删除 ${back.length} 个备份包吗？\n\n` +
                    `${back.join('\n')}\n\n` +
                    '备份包删掉就没了，这一步不会再另存一份。'
                  if (!window.confirm(ask)) return
                  void run(async () => {
                    const r = await window.BA.deleteBackups(back)
                    return r.error
                      ? { ok: false, text: '删除失败：' + r.error }
                      : { ok: true, text: `删掉了 ${r.removed} 个备份包` }
                  })
                }}
              >
                🗑 删除所选
              </button>
            </div>
            <div className="deck-tip dim">
              标「上一局」的包是每局开始自动覆盖的，不用手动管它——下一局一开就会被新的盖掉，别把它当长期存档。
            </div>
          </section>
        </div>
      </div>

      {teammates}
    </>
  )
}
