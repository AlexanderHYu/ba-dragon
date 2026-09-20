// 封禁监控：启动时查一次，其余时候点「刷新」。只看我遇到过的人。
import { useEffect, useState } from 'react'
import type { BanResult } from '@shared/ipc'

export default function Bans(): React.JSX.Element {
  const [data, setData] = useState<BanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    void window.BA.getBans().then(setData)
  }, [])

  return (
    <div className="card">
      <h2>
        <span className="ico">🛡</span>
        封禁监控
        <span className="grow" />
        {data && <span className="dim">{new Date(data.checkedAt).toLocaleString('zh-CN')} 查的</span>}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setErr(null)
            const r = await window.BA.checkBans()
            if ('error' in r) setErr(r.error)
            else setData(r)
            setBusy(false)
          }}
        >
          {busy ? '查询中…' : '↻ 刷新'}
        </button>
      </h2>
      {err && <div style={{ color: 'var(--bad)' }}>{err}</div>}
      {!data ? (
        <div className="empty">启动后会自动查一次。</div>
      ) : !data.met.length ? (
        <div className="empty">你遇到过的人里，名单上一个都没有。名单共 {data.total} 人。</div>
      ) : (
        <table className="t">
          <thead>
            <tr>
              <th>玩家</th>
              <th>发现时间</th>
            </tr>
          </thead>
          <tbody>
            {data.met.map((p) => (
              <tr key={p.pid}>
                <td>{p.name}</td>
                <td>{p.at ? new Date(p.at).toLocaleString('zh-CN') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
