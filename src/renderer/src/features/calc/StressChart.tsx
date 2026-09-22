import type { SimSample } from '@shared/combat/model'

/**
 * 压制 + 血量随时间的曲线。
 *
 * 血量走实线（右边自己的刻度，0 到满血），压制值走虚线加浅填充（左边的刻度，0 到上限），
 * 黄线红线是两条横虚线，掉人的时刻在底下点一排红竖线。左上角有图例。
 */
export default function StressChart({
  samples,
  best,
  worst,
  shocked,
  panicked,
  maxStress,
  hp,
  deaths
}: {
  samples: SimSample[]
  /** 近炸引信贴脸炸（最疼）时的血线 */
  best?: SimSample[]
  /** 近炸引信擦边炸（最不疼）时的血线 */
  worst?: SimSample[]
  shocked: number
  panicked: number
  maxStress: number
  hp: number
  /** 掉人的时刻（秒） */
  deaths: number[]
}): React.JSX.Element {
  // 宽一点：这张卡是整行的，viewBox 按高度等比缩放，太窄会挤在中间
  const W = 1000
  const H = 190
  const pad = { l: 46, r: 56, t: 26, b: 24 }
  if (samples.length < 2) return <div className="empty">没人开火，或者一发就打死了</div>
  const span = samples[samples.length - 1].t || 1
  const x = (t: number): number => pad.l + (t / span) * (W - pad.l - pad.r)
  const ys = (v: number): number => H - pad.b - (v / (maxStress || 1)) * (H - pad.t - pad.b)
  const yh = (v: number): number => H - pad.b - (v / (hp || 1)) * (H - pad.t - pad.b)

  const line = (f: (s: SimSample) => number): string =>
    samples.map((s, i) => (i ? 'L' : 'M') + x(s.t).toFixed(1) + ',' + f(s).toFixed(1)).join(' ')
  const sPath = line((s) => ys(s.stress))
  const area = sPath + ' L' + x(span) + ',' + ys(0) + ' L' + x(samples[0].t) + ',' + ys(0) + ' Z'
  // 刻度：短的打一两秒就结束，取整会挤成一堆重复的，所以按跨度决定要不要小数，再去重
  const fmt = (v: number): string => (span < 5 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)))
  const ticks: { v: number; label: string }[] = []
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const v = span * f
    const label = fmt(v)
    if (!ticks.some((x) => x.label === label)) ticks.push({ v, label })
  }

  return (
    <svg className="aoe-chart" viewBox={'0 0 ' + W + ' ' + H} width="100%" height={H}>
      {/* 图例 */}
      <g>
        <line x1={pad.l} y1={10} x2={pad.l + 20} y2={10} stroke="var(--good)" strokeWidth="2" />
        <text x={pad.l + 25} y={13} fontSize="10.5" fill="var(--good)">
          血量（右轴，满血 {hp}）{best && worst ? '｜浅带 = 近炸最好~最坏' : ''}
        </text>
        <line
          x1={pad.l + 150}
          y1={10}
          x2={pad.l + 170}
          y2={10}
          stroke="var(--accent)"
          strokeWidth="2"
          strokeDasharray="5 3"
        />
        <text x={pad.l + 175} y={13} fontSize="10.5" fill="var(--accent)">
          压制值（左轴，上限 {maxStress}）
        </text>
        {deaths.length > 0 && (
          <>
            <line x1={pad.l + 330} y1={6} x2={pad.l + 330} y2={14} stroke="var(--bad)" strokeWidth="2" />
            <text x={pad.l + 338} y={13} fontSize="10.5" fill="var(--bad)">
              倒下一个人
            </text>
          </>
        )}
      </g>

      <line x1={pad.l} y1={ys(panicked)} x2={W - pad.r} y2={ys(panicked)} stroke="var(--bad)" strokeDasharray="3 5" />
      <text x={W - pad.r} y={ys(panicked) - 3} textAnchor="end" fontSize="10" fill="var(--bad)">
        红线 {panicked}
      </text>
      <line x1={pad.l} y1={ys(shocked)} x2={W - pad.r} y2={ys(shocked)} stroke="var(--warn)" strokeDasharray="3 5" />
      <text x={W - pad.r} y={ys(shocked) - 3} textAnchor="end" fontSize="10" fill="var(--warn)">
        黄线 {shocked}
      </text>

      {/* 近炸的浮动范围：最好和最坏两条血线之间填一条带子 */}
      {best && worst && best.length > 1 && worst.length > 1 && (
        <>
          <path
            d={
              best.map((s, i) => (i ? 'L' : 'M') + x(s.t).toFixed(1) + ',' + yh(s.hp).toFixed(1)).join(' ') +
              ' ' +
              worst
                .slice()
                .reverse()
                .map((s) => 'L' + x(s.t).toFixed(1) + ',' + yh(s.hp).toFixed(1))
                .join(' ') +
              ' Z'
            }
            fill="var(--good)"
            opacity="0.14"
          />
          <path
            d={worst.map((s, i) => (i ? 'L' : 'M') + x(s.t).toFixed(1) + ',' + yh(s.hp).toFixed(1)).join(' ')}
            fill="none"
            stroke="var(--good)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.7"
          />
        </>
      )}
      <path d={area} fill="var(--accent)" opacity="0.12" />
      <path d={sPath} fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 3" />
      <path d={line((s) => yh(s.hp))} fill="none" stroke="var(--good)" strokeWidth="2" />

      {deaths.map((t, i) => (
        <line key={i} x1={x(t)} y1={H - pad.b} x2={x(t)} y2={H - pad.b - 9} stroke="var(--bad)" strokeWidth="2" />
      ))}

      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--line-hi)" />
      {ticks.map((t, i) => (
        <text
          key={t.label}
          x={x(t.v)}
          y={H - 8}
          textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
          fontSize="10"
          fill="var(--dim)"
        >
          {t.label}s
        </text>
      ))}
      {[0, maxStress / 2, maxStress].map((v, i) => (
        <text key={i} x={pad.l - 6} y={ys(v) + 3} textAnchor="end" fontSize="10" fill="var(--accent)" opacity="0.75">
          {Math.round(v)}
        </text>
      ))}
      {[0, hp].map((v, i) => (
        <text key={i} x={W - pad.r + 5} y={yh(v) + 3} fontSize="10" fill="var(--good)" opacity="0.85">
          {Math.round(v)}
        </text>
      ))}
    </svg>
  )
}
