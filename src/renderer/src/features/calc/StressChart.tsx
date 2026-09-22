import type { SimSample } from '@shared/combat/model'

/**
 * 压制 + 血量随时间的曲线。压制值用填充区（黄线红线画成横虚线），
 * 血量用一条单独的线（右边自己的刻度），掉人的时刻在底下点一排小竖线。
 */
export default function StressChart({
  samples,
  shocked,
  panicked,
  maxStress,
  hp,
  deaths
}: {
  samples: SimSample[]
  shocked: number
  panicked: number
  maxStress: number
  hp: number
  /** 掉人的时刻（秒） */
  deaths: number[]
}): React.JSX.Element {
  // 宽一点：这张卡是整行的，viewBox 按高度等比缩放，太窄会挤在中间
  const W = 1000
  const H = 170
  const pad = { l: 44, r: 54, t: 12, b: 24 }
  if (samples.length < 2) return <div className="empty">没人开火，或者一发就打死了</div>
  const span = samples[samples.length - 1].t || 1
  const x = (t: number): number => pad.l + (t / span) * (W - pad.l - pad.r)
  const ys = (v: number): number => H - pad.b - (v / (maxStress || 1)) * (H - pad.t - pad.b)
  const yh = (v: number): number => H - pad.b - (v / (hp || 1)) * (H - pad.t - pad.b)

  const line = (pts: SimSample[], f: (s: SimSample) => number): string =>
    pts.map((s, i) => (i ? 'L' : 'M') + x(s.t).toFixed(1) + ',' + f(s).toFixed(1)).join(' ')
  const sPath = line(samples, (s) => ys(s.stress))
  const area = sPath + ' L' + x(span) + ',' + ys(0) + ' L' + x(samples[0].t) + ',' + ys(0) + ' Z'
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(span * f))

  return (
    <svg className="aoe-chart" viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H}>
      <line x1={pad.l} y1={ys(panicked)} x2={W - pad.r} y2={ys(panicked)} stroke="var(--bad)" strokeDasharray="4 4" />
      <text x={W - pad.r} y={ys(panicked) - 3} textAnchor="end" fontSize="10" fill="var(--bad)">
        红 {panicked}
      </text>
      <line x1={pad.l} y1={ys(shocked)} x2={W - pad.r} y2={ys(shocked)} stroke="var(--warn)" strokeDasharray="4 4" />
      <text x={W - pad.r} y={ys(shocked) - 3} textAnchor="end" fontSize="10" fill="var(--warn)">
        黄 {shocked}
      </text>

      <path d={area} fill="var(--accent)" opacity="0.16" />
      <path d={sPath} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path
        d={line(samples, (s) => yh(s.hp))}
        fill="none"
        stroke="var(--good)"
        strokeWidth="1.5"
        strokeDasharray="5 3"
      />

      {deaths.map((t, i) => (
        <line key={i} x1={x(t)} y1={H - pad.b} x2={x(t)} y2={H - pad.b - 8} stroke="var(--bad)" strokeWidth="2" />
      ))}

      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--line-hi)" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--dim)">
          {t}s
        </text>
      ))}
      {[0, maxStress / 2, maxStress].map((v, i) => (
        <text key={i} x={pad.l - 6} y={ys(v) + 3} textAnchor="end" fontSize="10" fill="var(--dim)">
          {Math.round(v)}
        </text>
      ))}
      <text x={W - pad.r + 4} y={yh(hp) + 3} fontSize="10" fill="var(--good)">
        {hp} HP
      </text>
    </svg>
  )
}
