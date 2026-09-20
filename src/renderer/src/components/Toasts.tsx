// 提示条：主进程推过来的消息（比如「你遇到过的人被封了」），几秒后自己消失。
import { useEffect, useState } from 'react'
import type { EventMap } from '@shared/ipc'

type Toast = EventMap['toast'] & { id: number }

export default function Toasts(): React.JSX.Element | null {
  const [list, setList] = useState<Toast[]>([])

  useEffect(() => {
    return window.BA.on('toast', (t) => {
      const item = { ...t, id: Date.now() + Math.random() }
      setList((l) => [...l, item])
      setTimeout(() => setList((l) => l.filter((x) => x.id !== item.id)), 8000)
    })
  }, [])

  if (!list.length) return null
  return (
    <div className="toasts">
      {list.map((t) => (
        <div key={t.id} className={'toast ' + t.kind} onClick={() => setList((l) => l.filter((x) => x.id !== t.id))}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
