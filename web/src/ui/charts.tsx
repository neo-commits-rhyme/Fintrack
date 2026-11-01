import { useId, useState } from 'react'
import { compactMoney, money, shortDay, categoryMeta, type Category, type CurrencyCode, type DailyAmount } from '../core'

/**
 * Daily spending bars: thin marks, rounded tops anchored to the baseline, recessive grid,
 * one axis, per-bar hover tooltip. Pure SVG, no library.
 */
export function DailyBarChart({ series, currency, height = 220 }: { series: DailyAmount[]; currency: CurrencyCode; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const w = 720, padL = 8, padR = 64, padT = 12, padB = 26
  const innerW = w - padL - padR, innerH = height - padT - padB
  const max = Math.max(1, ...series.map((d) => d.amount))
  // Nice tick step: 1/2/5 × 10^n
  const rough = max / 3
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow
  const top = Math.ceil(max / step) * step
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const y = (v: number) => padT + innerH - (v / top) * innerH
  const slot = innerW / series.length
  const barW = Math.max(3, slot - 3)

  return (
    <div style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${w} ${height}`} role="img" aria-labelledby={`${id}-t`} preserveAspectRatio="none" style={{ height }}>
        <title id={`${id}-t`}>Daily spending for the last {series.length} days</title>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid-line" x1={padL} x2={padL + innerW} y1={y(t)} y2={y(t)} />
            <text x={padL + innerW + 8} y={y(t) + 4}>{compactMoney(t, currency)}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const h = Math.max(0, innerH * (d.amount / top))
          const x = padL + i * slot + (slot - barW) / 2
          const r = Math.min(4, barW / 2)
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={-1}>
              <rect x={padL + i * slot} y={padT} width={slot} height={innerH} fill="transparent" />
              {d.amount > 0 && (
                <path className="bar" d={`M${x},${y(0)} v${-(h - r)} a${r},${r} 0 0 1 ${r},${-r} h${barW - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${h - r} z`}
                  style={{ opacity: hover === null || hover === i ? 1 : 0.55 }} />
              )}
              {i % 7 === 0 && <text x={padL + i * slot + slot / 2} y={height - 8} textAnchor="middle">{shortDay(d.date)}</text>}
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div className="chart-tooltip" style={{ left: `${((padL + hover * slot + slot / 2) / w) * 100}%`, top: 0, translate: '-50% -110%' }}>
          {shortDay(series[hover].date)} · {money(series[hover].amount, currency)}
        </div>
      )}
      <table className="sr-only">
        <caption>Daily spending</caption>
        <tbody>{series.map((d, i) => <tr key={i}><td>{shortDay(d.date)}</td><td>{money(d.amount, currency)}</td></tr>)}</tbody>
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
    return { d: `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`, tint: categoryMeta[item.category].tint, title: categoryMeta[item.category].title }
  })
  return (
    <div className="ring" style={{ width: size, height: size, marginInline: 'auto' }} role="img" aria-label={`Spending by category, ${centerTitle} ${centerSub}`}>
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
