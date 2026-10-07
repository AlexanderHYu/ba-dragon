// 卡组工具：左边「前线卡组」（游戏目录里的 .dek），右边「后勤仓库」（备份出来的 .zip）。
// 两边都是多选列表，选中后批量备份／部署／删除。删除有确认框。
import { useCallback, useEffect, useState } from 'react'
import type { BackupFile, DeckFile, DeckView } from '@shared/ipc'
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
  empty,
  onPeek
}: {
  rows: Row[]
  sel: string[]
  onChange: (next: string[]) => void
  empty: string
  /** 给了就在每行右边放个「看内容」的按钮 */
  onPeek?: (name: string) => void
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
              {onPeek && (
                <button
                  className="deck-peek"
                  title="查看卡组内容"
                  onClick={(e) => {
                    e.stopPropagation()
                    onPeek(r.name)
                  }}
                >
                  👁
                </button>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}

/** 一副卡组的内容：分类 → 每张卡（真名 + 挂载 + 单价 + 张数 + 运输车） */
function DeckContent({ view, onClose }: { view: DeckView; onClose: () => void }): React.JSX.Element {
  return (
    <div className="deck-view">
      <div className="deck-view-head">
        <b>{view.name}</b>
        <span className="dim">
          {[view.country, ...view.specs].filter(Boolean).join(' · ')}
          {' · '}
          {view.cards} 张卡
        </span>
        <span className="grow" />
        <button onClick={onClose}>✕</button>
      </div>
      {view.cats.map((c) => (
        <div key={c.key} className="deck-cat">
          <div className="deck-cat-head">
            {c.label}
            <span className="dim">{c.items.length} 种</span>
          </div>
          {c.items.map((it, i) => (
            <div key={c.key + i} className="deck-card">
              <span className="deck-card-name">
                {it.name}
                {it.count > 1 && <span className="dim"> ×{it.count}</span>}
                {!!it.loadout && <div className="dim deck-card-load">{it.loadout}</div>}
                {it.transport && (
                  <div className="dim deck-card-load">
                    🚚 {it.transport}
                    {it.transportCost ? '（' + it.transportCost + '）' : ''}
                  </div>
                )}
              </span>
              <span className="deck-card-cost">{it.cost}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function Decks(): React.JSX.Element {
  const [data, setData] = useState<DeckData | null>(null)
  const [front, setFront] = useState<string[]>([])
  const [back, setBack] = useState<string[]>([])
  const [msg, setMsg] = useState<Res | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在看内容的那副卡组 */
  const [view, setView] = useState<DeckView | null>(null)
  const [viewErr, setViewErr] = useState<string | null>(null)

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

  if (!data) {
    return (
      <>
        <div className="card">
          <h2>
            <span className="ico">🃏</span>
            卡组工具
          </h2>
          <div className="empty">正在读取卡组…</div>
        </div>
      </>
    )
  }

  if (!data.found) {
    return (
      <>
        <div className="card">
          <h2>
            <span className="ico">🃏</span>
            卡组工具
          </h2>
          <div className="deck-note">
            <p>未找到游戏卡组目录。</p>
            <p className="deck-path">{data.dir || '（路径为空）'}</p>
            <p className="dim">
              可能是游戏目录设置有误，或本机尚未运行过游戏（卡组目录在首次进入游戏后创建）。请在「设置」中检查游戏目录后刷新。
            </p>
            <p className="dim">备份包目录：{data.backupDir || '—'}</p>
          </div>
          <div className="deck-actions">
            <button disabled={busy} onClick={() => void reload()}>
              ↻ 刷新
            </button>
            <button disabled={busy} onClick={() => void window.BA.openDeckDir('backups')}>
              📂 打开备份目录
            </button>
          </div>
        </div>
      </>
    )
  }

  const frontRows: Row[] = data.decks.map((d: DeckFile) => ({
    name: d.name,
    sub: fmtSize(d.size) + ' · ' + fmtTime(d.mtime)
  }))
  const backRows: Row[] = data.backups.map((b: BackupFile) => ({
    name: b.name,
    sub: b.decks + ' 副 · ' + fmtSize(b.size) + ' · ' + fmtTime(b.mtime)
  }))

  return (
    <>
      <div className="card">
        <h2>
          <span className="ico">🃏</span>
          卡组工具
          <span className="grow" />
          {busy && <span className="spin" />}
          <button disabled={busy} onClick={() => void reload()}>
            ↻ 刷新
          </button>
        </h2>

        {msg && <div className={msg.ok ? 'deck-msg ok' : 'deck-msg bad'}>{msg.text}</div>}

        <div className="deck-grid">
          {/* 前线：游戏目录里正在用的卡组 */}
          <section className="deck-col">
            <div className="deck-col-head">
              <h3>
                游戏卡组 <span className="dim">(.dek)</span>
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

            <PickList
              rows={frontRows}
              sel={front}
              onChange={setFront}
              empty="游戏卡组目录为空"
              onPeek={async (name) => {
                setView(null)
                setViewErr(null)
                const r = await window.BA.readDeck(name)
                if ('error' in r) {
                  setViewErr(
                    r.error === 'noKey'
                      ? '卡组文件已加密，需在「设置 → 游戏数据」中填写密钥才能查看内容'
                      : r.error === 'noGameDb'
                        ? '游戏单位表未读取，请检查「设置 → 游戏数据」'
                        : r.error
                  )
                } else setView(r)
              }}
            />

            {viewErr && <div className="lit-bad deck-tip">{viewErr}</div>}
            {view && <DeckContent view={view} onClose={() => setView(null)} />}

            <div className="deck-actions">
              <button
                className="primary"
                disabled={busy || !front.length}
                onClick={() =>
                  void run(async () => {
                    const r = await window.BA.backupDecks(front)
                    return 'error' in r
                      ? { ok: false, text: '备份失败：' + r.error }
                      : { ok: true, text: `已备份：${r.decks} 副 → ${r.file}` }
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
                      : { ok: true, text: `已全部备份：${r.decks} 副 → ${r.file}` }
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
                    `删除 ${front.length} 副游戏卡组？\n\n` +
                    `${front.join('\n')}\n\n` +
                    '删除前会自动备份当前卡组。'
                  if (!window.confirm(ask)) return
                  void run(async () => {
                    const r = await window.BA.deleteDecks(front)
                    return r.error
                      ? { ok: false, text: '删除失败：' + r.error }
                      : { ok: true, text: `已删除 ${r.removed} 副卡组（已自动备份）` }
                  })
                }}
              >
                🗑 删除所选
              </button>
            </div>
            <div className="deck-tip dim">删除卡组前会自动备份，可从右侧备份包恢复。</div>
          </section>

          {/* 后勤：备份出来的 zip 包 */}
          <section className="deck-col">
            <div className="deck-col-head">
              <h3>
                备份包 <span className="dim">(.zip)</span>
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

            <PickList rows={backRows} sel={back} onChange={setBack} empty="暂无备份包" />

            <div className="deck-actions">
              <button
                className="primary"
                disabled={busy || back.length !== 1}
                title={back.length > 1 ? '一次只能恢复一个备份包' : undefined}
                onClick={() => {
                  const name = back[0]
                  if (!name) return
                  if (!window.confirm(`将「${name}」恢复到游戏卡组？\n\n同名卡组将被覆盖。`)) return
                  void run(async () => {
                    const r = await window.BA.restoreDecks(name, true)
                    if ('error' in r) return { ok: false, text: '恢复失败：' + r.error }
                    const skip = r.skipped.length ? `，跳过 ${r.skipped.length} 个（${r.skipped.join('、')}）` : ''
                    return { ok: true, text: `已恢复 ${r.restored} 副卡组${skip}` }
                  })
                }}
              >
                ⬇ 恢复到游戏
              </button>
              <button disabled={busy} onClick={() => void window.BA.openDeckDir('backups')}>
                📂 打开目录
              </button>
              <button
                className="danger"
                disabled={busy || !back.length}
                onClick={() => {
                  const ask =
                    `删除 ${back.length} 个备份包？\n\n` +
                    `${back.join('\n')}\n\n` +
                    '备份包删除后无法恢复。'
                  if (!window.confirm(ask)) return
                  void run(async () => {
                    const r = await window.BA.deleteBackups(back)
                    return r.error
                      ? { ok: false, text: '删除失败：' + r.error }
                      : { ok: true, text: `已删除 ${r.removed} 个备份包` }
                  })
                }}
              >
                🗑 删除所选
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
