// 名单里的一行：龙区分 + 名字 + ELO / K/D / 胜率 / 样本数 / 常用单位。
// K/D 和胜率都取龙区分用的那 20 场排位局（非排位、没参考价值的局本来就不在里面），口径对得上分数。
import type { PlayerCard } from '@shared/ipc'
import Mark from '../../components/Mark'
import { IconCopy, IconExternalLink, IconUserSearch } from '@tabler/icons-react'
import { goodBad, scoreColor } from '../../components/scoreColor'
import type { MenuState } from '../../components/ContextMenu'

// K/D 和胜率只做「明显好 / 明显差」两档提示，中间一律留白，不然一行全是颜色
const kdCls = (v: number | null | undefined): string => goodBad(v, 1.2, 0.8)
const winCls = (v: number | null | undefined): string => goodBad(v, 60, 40)

export function PlayerRowHead(): React.JSX.Element {
  return (
    <div className="prow head">
      <div>龙区分</div>
      <div>玩家</div>
      <div className="num">ELO</div>
      <div className="num" title="最近 20 场排位的总体 K/D（Σ摧毁分 ÷ Σ损失分）">
        K/D
      </div>
      <div className="num" title="最近 20 场排位的胜率">
        胜率
      </div>
      <div className="num" title="计算龙区分所用的场数">
        样本
      </div>
      <div>常用单位</div>
    </div>
  )
}

export default function PlayerRow({
  card,
  active,
  me,
  onOpen,
  onMenu
}: {
  card: PlayerCard
  active?: boolean
  /** 这一行是不是本机账号 */
  me?: boolean
  onOpen: () => void
  /** 右键：调查羁绊 / 复制 ID / 去 BATrace */
  onMenu?: (m: MenuState) => void
}): React.JSX.Element {
  const d = card.dragon
  const score = d?.value ?? null
  const info = card.info
  const loading = card.infoState === 'loading' || card.dragonState === 'loading'
  const elo = info?.elo ?? card.staleElo ?? null
  const win = d ? Math.round(d.summary.winRate * 100) : info ? info.winRate : null
  const units = (info?.favUnits || []).slice(0, 2).map((u) => u.name).join('、')

  return (
    <div
      className={'prow' + (active ? ' active' : '') + (me ? ' me' : '')}
      onClick={onOpen}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              onMenu({
                x: e.clientX,
                y: e.clientY,
                title: card.name || card.id,
                items: [
                  { label: '调查羁绊', icon: IconUserSearch, onClick: onOpen },
                  { label: '复制 ID', icon: IconCopy, onClick: () => void navigator.clipboard.writeText(card.id) },
                  {
                    label: '在 BATrace 打开',
                    icon: IconExternalLink,
                    onClick: () => window.BA.openExternal('https://dash.batrace.top/player/' + card.id)
                  }
                ]
              })
            }
          : undefined
      }
      title="单击查看详情，右键查看更多操作"
    >
      <div className="score" style={{ color: scoreColor(score, d?.tier) }}>
        {d && <Mark tier={d.tier} />}
        {score != null ? score.toFixed(1) : card.dragonState === 'loading' ? <span className="spin" /> : '—'}
        {!d && card.dragonState === 'done' && <small>无排位</small>}
      </div>
      <div className="name">
        {card.name || card.id}
        {card.level != null && (
          <span className="prow-lv" title="账号等级">
            Lv.{card.level}
          </span>
        )}
        {me && <span className="prow-me">你</span>}
        {loading && <span className="spin" style={{ marginLeft: 6 }} />}
        {card.infoState === 'error' && (
          <span className="dim" style={{ marginLeft: 6, fontWeight: 400 }}>
            {card.error || '未找到'}
          </span>
        )}
      </div>
      <div className="num" title={info?.elo == null && card.staleElo != null ? 'BATrace 档案中的旧值' : ''}>
        {elo != null ? Math.round(elo) : '—'}
      </div>
      <div className={'num ' + kdCls(d?.summary.kdAgg)}>
        {d?.summary.kdAgg != null ? d.summary.kdAgg.toFixed(2) : '—'}
      </div>
      <div className={'num ' + winCls(win)}>{win != null ? win + '%' : '—'}</div>
      <div className="num soft">{d ? d.matchCount : info?.matchCount ?? '—'}</div>
      <div className="units" title={units}>
        {units || '—'}
      </div>
    </div>
  )
}
