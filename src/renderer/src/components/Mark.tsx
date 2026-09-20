// 龙区徽章：4.0.x 里那个方块「龙 / 强 / 中 / 弱 / 区」。
// 分档由模型给（tiers 是拟合出来的分位点），界面不自己定阈值，也不自己排序。
// 没有分档（没排位、还没算完）就什么都不渲染，交给调用方自己写占位文案。

/** tier -> 徽章上的那个字 */
const TIER_TEXT: Record<string, string> = {
  dragon: '龙',
  solid: '强',
  average: '中',
  weak: '弱',
  qu: '区'
}

/** tier -> 配色。龙是金色带光晕，区是红底白字，其余走灰/蓝两档 */
const TIER_CLASS: Record<string, string> = {
  dragon: 'dragon',
  solid: 'solid',
  average: 'min',
  weak: 'min',
  qu: 'qu'
}

export function tierText(tier?: string | null): string {
  return (tier && TIER_TEXT[tier]) || ''
}

export default function Mark({ tier, big }: { tier?: string | null; big?: boolean }): React.JSX.Element | null {
  const text = tierText(tier)
  if (!text) return null
  const cls = 'dg-mark ' + (TIER_CLASS[tier as string] || 'min') + (big ? ' big' : '')
  return (
    <span className={cls} title={'龙区分档：' + text}>
      {text}
    </span>
  )
}
