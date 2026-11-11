// 图标：统一用 Tabler 线条图标（打包进软件，不走网络）。界面上不用 emoji。
// 用法：<Ico i={IconRefresh} />，默认 16px，跟着文字颜色走。
import type { Icon as TablerIcon } from '@tabler/icons-react'

export default function Ico({ i: C, size = 16, title }: { i: TablerIcon; size?: number; title?: string }): React.JSX.Element {
  return <C size={size} stroke={1.75} className="ico" aria-hidden={title ? undefined : true} title={title} />
}
