// 每页顶上那一条：标题 + 元信息 + 右边的按钮。下面的内容放进 <div className="page">。
import { IconChevronLeft } from '@tabler/icons-react'
import Ico from './Icon'

export default function PageBar({
  title,
  onBack,
  backLabel,
  children
}: {
  title: React.ReactNode
  onBack?: () => void
  backLabel?: string
  /** 标题右边的东西：<span className="m">…</span>、<span className="grow" />、按钮 */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="pagebar">
      {onBack && (
        <button className="ghost back" onClick={onBack} title="返回上一页">
          <Ico i={IconChevronLeft} />
          {backLabel || '返回'}
        </button>
      )}
      <div className="h">{title}</div>
      {children}
    </div>
  )
}
