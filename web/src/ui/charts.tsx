import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { compactMoney, money, shortDay, categoryMeta, type Category, type CurrencyCode, type DailyAmount } from '../core'
import { t } from '../i18n'
import { categoryLabel } from '../i18n/labels'

/**
 * Monotone cubic curve through the points (Fritsch–Carlson): smooth like a spline, but it never
 * overshoots between two days, so a quiet day can't dip below zero or above its neighbours.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const slope = pts.slice(0, -1).map((p, i) => (pts[i + 1].y - p.y) / (pts[i + 1].x - p.x))
  const t = pts.map((_, i) => (i === 0 ? slope[0] : i === n - 1 ? slope[n - 2]
    : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / slope[i], b = t[i + 1] / slope[i], h = a * a + b * b
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * slope[i]; t[i + 1] = k * b * slope[i] }
  }
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const dx = (pts[i + 1].x - pts[i].x) / 3
    d += ` C${pts[i].x + dx},${pts[i].y + t[i] * dx} ${pts[i + 1].x - dx},${pts[i + 1].y - t[i + 1] * dx} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

/** Width of an element, kept current as it resizes, so the chart draws at its real size (no stretched text). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth || fallback)
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width) || fallback))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, width] as const
}

/**
 * Spending as a smooth line over a soft area wash, one hollow dot per point. Days are summed into `bucket`-day
 * points (counted back from today) so the shape reads as a trend, not a row of needles; the tooltip names the exact
 * days and the hidden table keeps every single day. One series, so no legend: the section title names it.
 */
export function SpendingAreaChart({ series: days, currency, height = 220, bucket = 3 }: {
  series: DailyAmount[]; currency: CurrencyCode; height?: number; bucket?: number
}) {
  const series = useMemo(() => {
    const out: { start: Date; end: Date; amount: number }[] = []
    for (let end = days.length; end > 0; end -= bucket) {
      const chunk = days.slice(Math.max(0, end - bucket), end)
      out.unshift({ start: chunk[0].date, end: chunk[chunk.length - 1].date, amount: chunk.reduce((s, d) => s + d.amount, 0) })
    }
    return out
  }, [days, bucket])
  const span = (p: { start: Date; end: Date }) => (p.start.getTime() === p.end.getTime() ? shortDay(p.end) : `${shortDay(p.start)} – ${shortDay(p.end)}`)
  const [hover, setHover] = useState<number | null>(null)
  const [wrap, w] = useWidth<HTMLDivElement>(640)
  const id = useId()
  const padL = 4, padR = 62, padT = 14, padB = 26
  const innerW = Math.max(1, w - padL - padR), innerH = height - padT - padB
  const max = Math.max(1, ...series.map((d) => d.amount))
  // Nice tick step: 1/2/5 × 10^n
  const rough = max / 3
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const y = (v: number) => padT + innerH - (v / top) * innerH
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0
  const x = (i: number) => padL + i * stepX
  const pts = series.map((d, i) => ({ x: x(i), y: y(d.amount) }))
  const line = smoothPath(pts)
  const area = pts.length > 1 ? `${line} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  // A hollow dot on every point while they stay sparse; past that only the latest keeps one.
  const dots = series.length <= 16 ? series.map((_, i) => i) : [series.length - 1]
  // A date label about every 70px, always including the latest point.
  const every = Math.max(1, Math.ceil(70 / Math.max(stepX, 1)))
  const labelled = series.map((_, i) => i).filter((i) => (series.length - 1 - i) % every === 0)

  const pick = (clientX: number, el: Element) => {
    const r = el.getBoundingClientRect()
    const i = Math.round((clientX - r.left - padL) / Math.max(stepX, 1))
    setHover(Math.min(series.length - 1, Math.max(0, i)))
  }
  const hx = hover === null ? 0 : x(hover)
  const tipLeft = Math.min(Math.max(hx, 64), w - 64)

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg className="chart" width={w} height={height} viewBox={`0 0 ${w} ${height}`} role="img" aria-labelledby={`${id}-t`}
        tabIndex={0}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
        onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
        onBlur={() => setHover(null)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          setHover((h) => Math.min(series.length - 1, Math.max(0, (h ?? series.length) + (e.key === 'ArrowLeft' ? -1 : 1))))
        }}>
        <title id={`${id}-t`}>{t('Spending for the last {days} days, in {bucket}-day totals', { days: days.length, bucket })}</title>
        <defs>
          <linearGradient id={`${id}-wash`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="area-top" />
            <stop offset="100%" className="area-bottom" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={padL + innerW} y1={y(t)} y2={y(t)} />
            <text x={padL + innerW + 8} y={y(t) + 4}>{compactMoney(t, currency)}</text>
          </g>
        ))}
        {labelled.map((i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor={i === series.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{shortDay(series[i].end)}</text>
        ))}
        {area && <path d={area} fill={`url(#${id}-wash)`} />}
        <path className="line" d={line} />
        {hover !== null && <line className="crosshair" x1={hx} x2={hx} y1={padT} y2={y(0)} />}
        {dots.filter((i) => i !== hover).map((i) => <circle key={i} className="dot" cx={x(i)} cy={y(series[i].amount)} r={4.5} />)}
        {hover !== null && <circle className="dot dot-active" cx={hx} cy={y(series[hover].amount)} r={5.5} />}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: tipLeft, top: y(series[hover].amount), translate: '-50% calc(-100% - 12px)' }}>
          <strong className="num">{money(series[hover].amount, currency)}</strong>
          <span className="chart-tooltip-sub">{span(series[hover])}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{t('Daily spending')}</caption>
        <tbody>{days.map((d, i) => <tr key={i}><td>{shortDay(d.date)}</td><td>{money(d.amount, currency)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

/** Donut of the top categories with a hero number in the middle; identity carried by the legend rows beside it. */
export function Donut({ items, centerTitle, centerSub, size = 190 }: { items: { category: Category; amount: number }[]; centerTitle: string; centerSub: string; size?: number }) {
  const total = items.reduce((s, i) => s + i.amount, 0) || 1
  const r = size / 2 - 4
  const inner = r * 0.62
  const cx = size / 2, cy = size / 2
  let angle = -Math.PI / 2
  const gap = 0.025
  const arcs = items.map((item) => {
    const sweep = (item.amount / total) * Math.PI * 2
    const a0 = angle + gap / 2, a1 = angle + sweep - gap / 2
    angle += sweep
    if (a1 <= a0) return null
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (rad: number, a: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
    const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1), [x2, y2] = p(inner, a1), [x3, y3] = p(inner, a0)
    return { d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`, tint: categoryMeta[item.category].tint, title: categoryLabel(item.category) }
  })
  return (
    <div className="ring" style={{ width: size, height: size, marginInline: 'auto' }} role="img" aria-label={`${t('Spending by category')}, ${centerTitle} ${centerSub}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {arcs.map((a, i) => a && <path key={i} d={a.d} fill={`var(--tint-${a.tint})`}><title>{a.title}</title></path>)}
      </svg>
      <div className="ring-label" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', fontSize: 17 }}>
        <span>{centerTitle}</span>
        <span className="micro muted" style={{ fontWeight: 400 }}>{centerSub}</span>
      </div>
    </div>
  )
}
