// 名单里的一行：龙区分 + 名字 + ELO / K/D / 胜率 / 样本数 / 常用单位。
// K/D 和胜率都取龙区分用的那 20 场排位局（非排位、没参考价值的局本来就不在里面），口径对得上分数。
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

export function PlayerRowHead(): React.JSX.Element {
  return (
    <div className="prow head">
      <div style={{ textAlign: 'center' }}>龙区分</div>
      <div>玩家</div>
      <div className="num">ELO</div>
      <div className="num" title="最近 20 场排位的总体 K/D（Σ摧毁分 ÷ Σ损失分）">
        K/D
      </div>
      <div className="num" title="最近 20 场排位的胜率">
        胜率
      </div>
      <div className="num" title="算分用了多少场">
        样本
      </div>
      <div>常用单位</div>
    </div>
  )
}

export default function PlayerRow({
  card,
  active,
  onOpen
}: {
  card: PlayerCard
  active?: boolean
  onOpen: () => void
}): React.JSX.Element {
  const d = card.dragon
  const score = d?.value ?? null
  const info = card.info
  const loading = card.infoState === 'loading' || card.dragonState === 'loading'
  const elo = info?.elo ?? card.staleElo ?? null
  const units = (info?.favUnits || []).slice(0, 2).map((u) => u.name).join('、')

  return (
    <div className={'prow' + (active ? ' active' : '')} onClick={onOpen} title="点开看详细">
      <div className="score" style={{ color: scoreColor(score) }}>
        {score != null ? score.toFixed(1) : card.dragonState === 'loading' ? <span className="spin" /> : '—'}
        <small className={markClass(d?.tier)}>
          {d ? TIER_TEXT[d.tier] || '' : card.dragonState === 'done' ? '无排位' : ''}
        </small>
      </div>
      <div className="name">
        {card.name || card.id}
        {loading && <span className="spin" style={{ marginLeft: 6 }} />}
        {card.infoState === 'error' && (
          <span className="dim" style={{ marginLeft: 6, fontWeight: 400 }}>
            {card.error || '查不到'}
          </span>
        )}
      </div>
      <div className="num" title={info?.elo == null && card.staleElo != null ? '这是 BATrace 档案里的旧值' : ''}>
        {elo != null ? Math.round(elo) : '—'}
      </div>
      <div className="num">{d?.summary.kdAgg != null ? d.summary.kdAgg.toFixed(2) : '—'}</div>
      <div className="num">{d ? Math.round(d.summary.winRate * 100) + '%' : info ? info.winRate + '%' : '—'}</div>
      <div className="num">{d ? d.matchCount : info?.matchCount ?? '—'}</div>
      <div className="units" title={units}>
        {units || '—'}
      </div>
    </div>
  )
}
