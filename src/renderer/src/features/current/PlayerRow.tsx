// 名单里的一行：龙区分 + 名字 + 一句话档案。粗查和龙区分合并后，一行就把该看的都摆出来。
import type { PlayerCard } from '@shared/ipc'

/** 分档由模型给（tiers 是拟合出来的分位点），界面不自己定阈值 */
const TIER_TEXT: Record<string, string> = { dragon: '龙', solid: '强', average: '中', weak: '弱', qu: '区' }

export function markClass(tier?: string | null): string {
  return tier === 'dragon' ? 'mark-dragon' : tier === 'qu' ? 'mark-qu' : 'mark-min'
}

/** 1~10 分的颜色：高分偏金，低分偏红 */
export function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'var(--dim)'
  if (v >= 8) return 'var(--accent)'
  if (v >= 6.5) return 'var(--good)'
  if (v >= 4) return 'var(--text)'
  if (v >= 2.5) return 'var(--warn)'
  return 'var(--bad)'
}

export default function PlayerRow({ card, onOpen }: { card: PlayerCard; onOpen: () => void }): React.JSX.Element {
  const d = card.dragon
  const score = d?.value ?? null
  const info = card.info
  const loading = card.infoState === 'loading' || card.dragonState === 'loading'
  const sub: string[] = []
  if (info) {
    if (info.elo != null) sub.push('ELO ' + Math.round(info.elo))
    sub.push(info.winRate + '% 胜率')
    if (info.matchCount) sub.push(info.matchCount + ' 局')
  } else if (card.infoState === 'error') {
    sub.push(card.error || '查不到')
  } else if (card.infoState === 'loading') {
    sub.push('正在查…')
  }
  const last = card.lastSeen
  return (
    <div className="pcard" onClick={onOpen} title="点开看详细">
      <div className="score" style={{ color: scoreColor(score) }}>
        {score != null ? score.toFixed(1) : card.dragonState === 'loading' ? <span className="spin" /> : '—'}
        <small className={markClass(d?.tier)}>
          {d ? TIER_TEXT[d.tier] || '' : card.dragonState === 'done' ? '无排位' : ''}
        </small>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="name">
          {card.name || card.id}
          {loading && <span className="spin" style={{ marginLeft: 6 }} />}
        </div>
        <div className="sub">{sub.join(' · ')}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        {d?.range && (
          <div className="sub" title="可能范围（±1 个标准差）">
            {d.range[0].toFixed(1)}–{d.range[1].toFixed(1)}
          </div>
        )}
        {last && score != null && Math.abs(last.score - score) >= 0.3 && (
          <div className="sub" title={'上次见到是 ' + last.score.toFixed(1)}>
            上次 {last.score.toFixed(1)}
          </div>
        )}
      </div>
    </div>
  )
}
