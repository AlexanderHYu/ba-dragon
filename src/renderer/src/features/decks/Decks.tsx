// 卡组：备份当前卡组、还原某个备份。每局开始会自动覆盖「上一局卡组包」。
import { useEffect, useState } from 'react'
import type { BackupFile, DeckFile } from '@shared/ipc'

export default function Decks(): React.JSX.Element {
  const [data, setData] = useState<{ found: boolean; dir: string; decks: DeckFile[]; backups: BackupFile[] } | null>(
    null
  )
  const [msg, setMsg] = useState<string | null>(null)
  const reload = (): void => {
    void window.BA.listDecks().then(setData)
  }
  useEffect(reload, [])

  if (!data) {
    return (
      <div className="card">
        <div className="empty">读卡组中…</div>
      </div>
    )
  }
  if (!data.found) {
    return (
      <div className="card">
        <h2>卡组</h2>
        <div className="empty">没找到游戏的卡组目录：{data.dir}</div>
      </div>
    )
  }
  return (
    <div className="card">
      <h2>
        卡组
        <span className="dim">{data.decks.length} 副</span>
        <span className="grow" />
        <button
          className="primary"
          onClick={async () => {
            const r = await window.BA.backupDecks()
            setMsg('error' in r ? r.error : '备份好了，' + r.decks + ' 副卡组')
            reload()
          }}
        >
          立即备份
        </button>
      </h2>
      {msg && (
        <div className="dim" style={{ marginBottom: 8 }}>
          {msg}
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
        每局开始会自动把当前卡组覆盖进「上一局卡组包」。还原之前会先自动备份一份现在的。
      </div>
      <table className="t">
        <thead>
          <tr>
            <th>备份</th>
            <th>卡组数</th>
            <th>时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.backups.map((b) => (
            <tr key={b.name}>
              <td>
                {b.name}
                {b.auto && <span className="dim">（自动）</span>}
              </td>
              <td>{b.decks}</td>
              <td>{new Date(b.mtime).toLocaleString('zh-CN')}</td>
              <td>
                <button
                  onClick={async () => {
                    const r = await window.BA.restoreDecks(b.name, true)
                    setMsg('error' in r ? r.error : '还原了 ' + r.restored + ' 副卡组')
                    reload()
                  }}
                >
                  还原
                </button>
              </td>
            </tr>
          ))}
          {!data.backups.length && (
            <tr>
              <td colSpan={4} className="dim">
                还没有备份
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
