// 右键菜单（老版 .ctx-menu 那个）：点别处、按 Esc、滚动都会关掉。
import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export interface MenuState {
  x: number
  y: number
  items: MenuItem[]
  /** 菜单顶上的一行小标题，通常是玩家名 */
  title?: string
}

export default function ContextMenu({ menu, onClose }: { menu: MenuState | null; onClose: () => void }): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // 捕获阶段监听：菜单里的点击自己会 stopPropagation
    window.addEventListener('mousedown', close)
    window.addEventListener('wheel', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, onClose])

  if (!menu) return null
  // 贴边时往回收，别跑到窗口外面去
  const w = 190
  const h = 40 + menu.items.length * 30
  const x = Math.min(menu.x, window.innerWidth - w - 8)
  const y = Math.min(menu.y, window.innerHeight - h - 8)

  return (
    <div className="ctx-menu" ref={ref} style={{ left: x, top: y, width: w }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.title && <div className="ctx-title">{menu.title}</div>}
      {menu.items.map((it) => (
        <button
          key={it.label}
          className={'ctx-item' + (it.danger ? ' danger' : '')}
          onClick={() => {
            it.onClick()
            onClose()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
