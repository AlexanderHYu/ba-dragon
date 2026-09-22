// AOE 伤害随距离的曲线。横轴是离爆心多远（米，已经按游戏的显示倍率换算），纵轴是伤害；
// 画一条目标血量的横线，线以上就是能一发带走的范围。
import { toM } from '@shared/combat/model'

export default function AoeChart({
  curve,
  hp,
  radius,
  bounds
}: {
  curve: { d: number; dmg: number }[]
  hp: number
  radius: number
  /** 目标外壳半径：这一段里是满伤 */
  bounds: number
}): React.JSX.Element {
  const W = 520
  const H = 170
  const pad = { l: 42, r: 10, t: 10, b: 24 }
  if (!curve.length) return <div className="empty">没有 AOE</div>
  const maxD = Math.max(...curve.map((p) => p.dmg), hp) * 1.1
  const span = curve[curve.length - 1].d || radius
  const x = (d: number): number => pad.l + (d / span) * (W - pad.l - pad.r)
  const y = (v: number): number => H - pad.b - (v / maxD) * (H - pad.t - pad.b)
  const path = curve.map((p, i) => (i ? 'L' : 'M') + x(p.d).toFixed(1) + ',' + y(p.dmg).toFixed(1)).join(' ')
  const area = path + ' L' + x(span) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z'
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(span * f))

  return (
    <svg className="aoe-chart" viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H}>
      {/* 血量线：这条线以上 = 一发能带走 */}
      <line x1={pad.l} y1={y(hp)} x2={W - pad.r} y2={y(hp)} stroke="var(--bad)" strokeDasharray="4 4" />
      <text x={W - pad.r} y={y(hp) - 4} textAnchor="end" fontSize="10" fill="var(--bad)">
        目标血量 {hp}
      </text>

      {bounds > 0 && (
        <rect
          x={pad.l}
          y={pad.t}
          width={Math.max(0, x(bounds) - pad.l)}
          height={H - pad.t - pad.b}
          fill="var(--good)"
          opacity="0.1"
        />
      )}

      <path d={area} fill="var(--accent)" opacity="0.16" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" />

      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--line-hi)" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--dim)">
          {toM(t)}m
        </text>
      ))}
      {[0, maxD / 2, maxD].map((v, i) => (
        <text key={i} x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="10" fill="var(--dim)">
          {Math.round(v)}
        </text>
      ))}
    </svg>
  )
}
