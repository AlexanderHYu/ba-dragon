// 录像内置播放器：<video> 走 replay:// 协议（支持 Range，拖进度条不会整文件加载），
// 控制条自己画，因为要在进度条背景上铺一张这一局的兵力曲线。
//
// 对齐方式：录像是「进对局开录、打完停录」，和 BATrace 记的对局时长不一定分毫不差
// （开录有一两秒延迟、结算画面也录进去了），所以曲线只能按**比例**铺满整条进度条，
// 不做绝对时间对齐。界面上用小字说明这件事。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReplayItem } from '@shared/ipc'
import type { MatchReport } from '@shared/match'
import './replay.css'

const RATES = [0.5, 1, 2, 4]

const clock = (s: number): string => {
  const t = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0
  const p = (n: number): string => String(n).padStart(2, '0')
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  return (h ? h + ':' + p(m) : String(m)) + ':' + p(t % 60)
}

type Timeline = MatchReport['timeline']

export default function Player({ item, onClose }: { item: ReplayItem; onClose: () => void }): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [dur, setDur] = useState(0)
  const [vol, setVol] = useState(1)
  const [rate, setRate] = useState(1)
  const [tl, setTl] = useState<Timeline | null>(null)
  const [hover, setHover] = useState<{ pct: number; i: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [broken, setBroken] = useState(false)

  const src = 'replay://local/' + encodeURIComponent(item.id)

  // 兵力曲线：拿不到就当没有（自定义局、BATrace 还没同步、没网都可能），不报错也不重试
  useEffect(() => {
    const onChange = (): void => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    let alive = true
    setTl(null)
    if (item.fid) {
      void window.BA.getMatchReport(item.fid).then(
        (r) => {
          if (alive && r && !('error' in r)) setTl(r.timeline)
        },
        () => {
          /* 静默：没有曲线就是普通进度条 */
        }
      )
    }
    return () => {
      alive = false
    }
  }, [item.fid])

  useEffect(() => {
    if (video.current) video.current.volume = vol
  }, [vol])
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate
  }, [rate])

  // 键盘：空格播放/暂停、左右 ±5 秒（焦点在输入框里时不抢）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || t?.isContentEditable) return
      const v = video.current
      if (!v) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (v.paused) void v.play().catch(() => undefined)
        else v.pause()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        v.currentTime = Math.max(0, v.currentTime - 5)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        const d = Number.isFinite(v.duration) ? v.duration : v.currentTime + 5
        v.currentTime = Math.min(d, v.currentTime + 5)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 曲线：两队每分钟的场上兵力，归一到 0-100 的 viewBox；事件是竖线
  const curve = useMemo(() => {
    const n = tl?.minutes || 0
    const field = tl?.field || []
    if (!tl || n < 2 || field.length < 1) return null
    const rows = field.slice(0, 2).map((row) => row.slice(0, n))
    let max = 0
    for (const row of rows) for (const v of row) if (Number.isFinite(v) && v > max) max = v
    if (max <= 0) return null
    const x = (i: number): number => (i / (n - 1)) * 100
    const y = (v: number): number => 98 - (Math.max(0, Number.isFinite(v) ? v : 0) / max) * 94
    const path = (row: number[]): string =>
      row.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(2) + ' ' + y(v).toFixed(2)).join(' ')
    const area = (row: number[]): string =>
      row.length ? path(row) + ' L100 100 L0 100 Z' : ''
    return { n, max, rows, x, paths: rows.map(path), areas: rows.map(area), events: tl.events || [] }
  }, [tl])

  const ratioAt = (clientX: number): number => {
    const el = bar.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    if (r.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const seek = (clientX: number): void => {
    const v = video.current
    if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return
    v.currentTime = ratioAt(clientX) * v.duration
  }

  // 全屏：整个播放器一起进全屏，控制条和兵力曲线都还在
  const toggleFull = (): void => {
    const el = boxRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen().catch(() => undefined)
  }

  const played = dur > 0 ? Math.min(1, cur / dur) * 100 : 0
  const hoverVals = curve && hover ? curve.rows.map((row) => row[hover.i] ?? 0) : null

  return (
    <div className={'bplayer' + (full ? ' full' : '')} ref={boxRef}>
      <div className="bplayer-head">
        <b>{item.map || '录像'}</b>
        <span className="dim">{new Date(item.createdAt).toLocaleString('zh-CN')}</span>
        <span className="grow" />
        <button onClick={() => void window.BA.openReplayFolder(item.id)}>定位文件</button>
        <button onClick={toggleFull} title="全屏（Esc 或再点一次退出）">
          {full ? '⤢ 退出全屏' : '⛶ 全屏'}
        </button>
        <button onClick={onClose}>✕</button>
      </div>

      {broken ? (
        <div className="empty">这个录像打不开了，文件可能被删了或者还没合成完。</div>
      ) : (
        <video
          ref={video}
          src={src}
          controls={false}
          preload="metadata"
          playsInline
          onClick={() => {
            const v = video.current
            if (!v) return
            if (v.paused) void v.play().catch(() => undefined)
            else v.pause()
          }}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget
            v.volume = vol
            v.playbackRate = rate
            setDur(Number.isFinite(v.duration) ? v.duration : 0)
          }}
          onDurationChange={(e) => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setBroken(true)}
        />
      )}

      <div
        ref={bar}
        className={'bplayer-bar' + (curve ? ' has-curve' : '')}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
          seek(e.clientX)
        }}
        onPointerMove={(e) => {
          const r = ratioAt(e.clientX)
          if (curve) setHover({ pct: r * 100, i: Math.min(curve.n - 1, Math.max(0, Math.round(r * (curve.n - 1)))) })
          if (dragging) seek(e.clientX)
        }}
        onPointerUp={(e) => {
          if (dragging) {
            setDragging(false)
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        }}
        onPointerLeave={() => setHover(null)}
      >
        {curve && (
          <svg className="bplayer-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {curve.areas.map((d, t) =>
              d ? <path key={'a' + t} d={d} className={'fill t' + t} /> : null
            )}
            {curve.events.map((ev, k) => (
              <line
                key={'e' + k}
                x1={curve.x(Math.min(curve.n - 1, Math.max(0, ev.min)))}
                x2={curve.x(Math.min(curve.n - 1, Math.max(0, ev.min)))}
                y1="0"
                y2="100"
                className={'ev ' + ev.type}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {curve.paths.map((d, t) => (
              <path key={'p' + t} d={d} className={'line t' + t} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        <i className="bplayer-played" style={{ width: played + '%' }} />
        <i className="bplayer-head-mark" style={{ left: played + '%' }} />
        {hover && hoverVals && (
          <div className="bplayer-tip" style={{ left: hover.pct + '%' }}>
            <b>第 {hover.i + 1} 分钟</b>
            <span className="t0">A {Math.round(hoverVals[0] ?? 0)}</span>
            <span className="t1">B {Math.round(hoverVals[1] ?? 0)}</span>
            {curve?.events
              .filter((ev) => ev.min === hover.i)
              .map((ev, k) => (
                <span key={k} className={ev.type === 'leave' ? 'bad' : 'warn'}>
                  {ev.text}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="bplayer-ctrl">
        <button
          className="play"
          onClick={() => {
            const v = video.current
            if (!v) return
            if (v.paused) void v.play().catch(() => undefined)
            else v.pause()
          }}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="bplayer-time">
          {clock(cur)} / {clock(dur)}
        </span>
        <span className="bplayer-rate">
          {RATES.map((r) => (
            <button key={r} className={rate === r ? 'active' : ''} onClick={() => setRate(r)}>
              {r}×
            </button>
          ))}
        </span>
        <span className="grow" />
        <button className="bplayer-full" onClick={toggleFull} title="全屏（Esc 退出）">
          {full ? '⤢' : '⛶'}
        </button>
        <span className="bplayer-vol">
          <button onClick={() => setVol(vol > 0 ? 0 : 1)}>{vol > 0 ? '🔊' : '🔇'}</button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            onChange={(e) => setVol(Number(e.target.value))}
          />
        </span>
      </div>

      <div className="bplayer-note dim">
        {curve ? '兵力曲线按比例对齐，可能有几秒误差' : '这一局没有对局数据，只有普通进度条'} · 空格播放/暂停，←
        → ±5 秒
      </div>
    </div>
  )
}
