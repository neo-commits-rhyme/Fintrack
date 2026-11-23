import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Icon } from './icons'
import {
  addDays, CURRENCIES, categoryMeta, fromDateInputValue, groupAmountInput, isSameDay, money, parseAmount, plainNumber, shortDay,
  startOfDay, toDateInputValue, type Category, type CurrencyCode, type Tint,
} from '../core'

// ---------- Layout ----------

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      {children}
    </div>
  )
}

export function Card({ children, className = '', tint }: { children: ReactNode; className?: string; tint?: 'expense' }) {
  return <section className={`card ${tint ? `tint-${tint}` : ''} ${className}`.trim()}>{children}</section>
}

export function SectionHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {subtitle && <span className="caption">{subtitle}</span>}
      {children && <span style={{ marginInlineStart: 'auto' }}>{children}</span>}
    </div>
  )
}

export function EmptyState({ icon, title, message, children }: { icon: string; title: string; message: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} strokeWidth={1.25} />
      <h3>{title}</h3>
      <p>{message}</p>
      {children}
    </div>
  )
}

export function StatTile({ title, value, icon, tone }: { title: string; value: string; icon: string; tone: 'income' | 'expense' | 'accent' }) {
  const color = tone === 'income' ? 'var(--income)' : tone === 'expense' ? 'var(--expense)' : 'var(--accent)'
  const bg = tone === 'income' ? 'var(--income-soft)' : tone === 'expense' ? 'var(--expense-soft)' : 'var(--accent-soft)'
  return (
    <Card>
      <div className="stack-tight">
        <div className="row" style={{ gap: 8 }}>
          <span className="icon-chip" style={{ color, background: bg }}><Icon name={icon} size={13} strokeWidth={2} /></span>
          <span className="caption">{title}</span>
        </div>
        <div className="stat-number truncate">{value}</div>
      </div>
    </Card>
  )
}

// ---------- Buttons ----------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'link'
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: string
  iconOnly?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'secondary', size = 'md', icon, iconOnly, className = '', children, type = 'button', ...rest }, ref) {
  const cls = ['btn', variant !== 'secondary' ? `btn-${variant}` : '', size === 'sm' ? 'btn-sm' : '', iconOnly ? 'btn-icon' : '', className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} strokeWidth={2} />}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </button>
  )
})

// ---------- Form fields ----------

interface FieldProps { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode; hideLabel?: boolean }

export function Field({ label, hint, error, children, hideLabel }: FieldProps) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'field-label'}>{label}</label>
      {children(id, describedBy)}
      {hint && <span id={hintId} className="field-hint">{hint}</span>}
      {error && <span id={errId} className="field-error" role="alert"><Icon name="alert-circle" size={14} />{error}</span>}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className ?? ''}`.trim()} />
}

/**
 * Numeric input that keeps its own text while typing (so "1," or "0.0" survive), reports a parsed number,
 * and re-renders from `value` only when it changes from the outside.
 */
export function AmountInput({ value, onChange, id, placeholder = '0', className = '', hero, ...rest }: {
  value: number | null; onChange: (v: number | null) => void; id?: string; placeholder?: string; className?: string; hero?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(groupAmountInput(plainNumber(value)))
  const lastParsed = useRef(value)
  const input = useRef<HTMLInputElement>(null)
  /** Where the caret belongs after regrouping: the count of non-comma characters before it. */
  const caret = useRef<number | null>(null)
  useEffect(() => {
    if (value !== lastParsed.current) {
      setText(groupAmountInput(plainNumber(value)))
      lastParsed.current = value
    }
  }, [value])
  useLayoutEffect(() => {
    const el = input.current
    if (caret.current === null || !el || document.activeElement !== el) return
    let seen = 0, pos = 0
    while (pos < text.length && seen < caret.current) { if (text[pos] !== ',') seen++; pos++ }
    caret.current = null
    el.setSelectionRange(pos, pos)
  }, [text])
  return (
    <input
      ref={input}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`input num ${hero ? 'input-hero' : ''} ${className}`.trim()}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        let raw = e.target.value
        const at = e.target.selectionStart ?? raw.length
        // Commas are the grouping mark here, so a typed comma (the decimal key on many keyboards) means a decimal point.
        if ((e.nativeEvent as InputEvent).data === ',' && at > 0 && raw[at - 1] === ',' && !raw.includes('.')) {
          raw = `${raw.slice(0, at - 1)}.${raw.slice(at)}`
        }
        const grouped = groupAmountInput(raw)
        caret.current = raw.slice(0, at).replace(/[,\s]/g, '').length
        setText(grouped)
        const parsed = parseAmount(grouped)
        lastParsed.current = parsed
        onChange(parsed)
      }}
      {...rest}
    />
  )
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`select ${props.className ?? ''}`.trim()} />
}

export function CurrencySelect({ value, onChange, id, inline, ariaLabel }: { value: CurrencyCode; onChange: (c: CurrencyCode) => void; id?: string; inline?: boolean; ariaLabel?: string }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as CurrencyCode)} className={inline ? 'select-inline' : ''} aria-label={ariaLabel}>
      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </Select>
  )
}

export function CategorySelect({ value, onChange, id, categories }: { value: Category; onChange: (c: Category) => void; id?: string; categories: Category[] }) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Category)}>
      {categories.map((c) => <option key={c} value={c}>{categoryMeta[c].title}</option>)}
    </Select>
  )
}

/**
 * Roving focus for a custom radiogroup (APG): one Tab stop on the checked radio, arrows/Home/End move and select.
 * `keys` are the radios in visual order; `current` is the checked key (or none).
 */
function rovingRadio(keys: string[], current: string | undefined, key: string, select: (key: string) => void) {
  const checked = current !== undefined && keys.includes(current) ? current : keys[0]
  return {
    'data-radio-key': key,
    tabIndex: key === checked ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const i = keys.indexOf(key)
      const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % keys.length
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + keys.length) % keys.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? keys.length - 1 : -1
      if (next < 0) return
      e.preventDefault()
      const group = e.currentTarget.closest('[role="radiogroup"]')
      select(keys[next])
      // After React re-renders: the checked radio may be a new node (the chips list can change).
      setTimeout(() => (group?.querySelector(`[data-radio-key="${keys[next]}"]`) as HTMLElement | null)?.focus())
    },
  }
}

export function Segmented<T extends string>({ options, value, onChange, label, block }: { options: { value: T; label: string; tone?: 'income' | 'expense' }[]; value: T; onChange: (v: T) => void; label: string; block?: boolean }) {
  return (
    <div className={`segmented ${block ? 'segmented-block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-tone={o.tone} onClick={() => onChange(o.value)}
          {...rovingRadio(options.map((x) => x.value), value, o.value, (k) => onChange(k as T))}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}

export function IconPicker({ icons, value, onChange, label }: { icons: readonly string[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label={label}>
      {icons.map((name) => (
        <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={name.replace(/-/g, ' ')} className="icon-pick" onClick={() => onChange(name)}
          {...rovingRadio([...icons], value, name, onChange)}>
          <Icon name={name} size={16} strokeWidth={2} />
        </button>
      ))}
    </div>
  )
}

// ---------- Balance split ----------

/**
 * A multi-currency balance: the display currency (or the largest holding) takes the hero line,
 * every other currency becomes a chip with its own amount, and what it is worth in the
 * display currency. Money stays in the currency it actually sits in.
 */
export function BalanceSplit({ items, display, convertTo, size = 'hero' }: {
  items: { currency: CurrencyCode; amount: number }[]
  display: CurrencyCode
  convertTo: (amount: number, from: CurrencyCode) => number
  size?: 'hero' | 'stat'
}) {
  const [primary, ...others] = items
  if (!primary) return null
  return (
    <div className="balance-split">
      <div className={size === 'hero' ? 'hero-number' : 'stat-number'} style={size === 'stat' ? { fontSize: '1.875rem' } : undefined}>
        {money(primary.amount, primary.currency)}
      </div>
      {others.length > 0 && (
        <ul className="balance-others" aria-label="Also held in">
          {others.map((s) => (
            <li key={s.currency} className="balance-chip">
              <span className="balance-chip-amount num">{money(s.amount, s.currency)}</span>
              <span className="balance-chip-approx num">≈ {money(convertTo(s.amount, s.currency), display)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Visuals ----------

export function CategoryBadge({ category, size = 38 }: { category: Category; size?: number }) {
  const meta = categoryMeta[category]
  return (
    <span className="badge" style={{ width: size, height: size, ['--tint' as string]: `var(--tint-${meta.tint})` }} title={meta.title}>
      <Icon name={meta.icon} size={Math.round(size * 0.44)} strokeWidth={2} />
    </span>
  )
}

export function ProgressBar({ fraction, tint, label }: { fraction: number; tint?: string; label: string }) {
  const clamped = Math.min(1, Math.max(0, fraction))
  return (
    <div className={`progress ${fraction > 1 ? 'over' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.min(fraction, 1) * 100)}>
      {/* Nothing spent reads as nothing, not as a dot of progress. */}
      <span style={{ width: `${clamped * 100}%`, minWidth: clamped > 0 ? undefined : 0, ['--bar' as string]: tint }} />
    </div>
  )
}

export function Ring({ fraction, size = 74, stroke = 9, color = 'var(--accent)', label }: { fraction: number; size?: number; stroke?: number; color?: string; label: string }) {
  const clamped = Math.min(1, Math.max(0, fraction))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // Floor, not round: 99.9% must not read "100%" before the goal is done.
  const pct = Math.floor(clamped * 100)
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${pct}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset var(--dur-base) var(--ease-out)' }} />
      </svg>
      <span className="ring-label" style={{ fontSize: size * 0.22 }}>{pct}%</span>
    </div>
  )
}

// ---------- Day picker ----------

/** Today / Yesterday / any other day from the calendar. `value` is a local midnight. */
export function DayPicker({ value, onChange, now, label }: { value: Date; onChange: (d: Date) => void; now: Date; label: string }) {
  const today = startOfDay(now)
  const yesterday = addDays(today, -1)
  const picker = useRef<HTMLInputElement>(null)
  const isToday = isSameDay(value, today)
  const isYesterday = isSameDay(value, yesterday)
  const custom = !isToday && !isYesterday
  const customLabel = value.getFullYear() === today.getFullYear() ? shortDay(value) : `${shortDay(value)} ${value.getFullYear()}`
  return (
    <div className="segmented segmented-block day-picker" role="group" aria-label={label}>
      <button type="button" aria-pressed={isToday} onClick={() => onChange(today)}>Today</button>
      <button type="button" aria-pressed={isYesterday} onClick={() => onChange(yesterday)}>Yesterday</button>
      <span className="day-calendar" data-on={custom || undefined}>
        <Icon name="calendar" size={15} strokeWidth={2} />
        <span className="truncate">{custom ? customLabel : 'Pick date'}</span>
        <input
          ref={picker}
          type="date"
          aria-label={custom ? `Pick date, ${customLabel} chosen` : 'Pick date'}
          value={toDateInputValue(value)}
          onClick={() => { try { picker.current?.showPicker() } catch { /* the native tap opens it */ } }}
          onChange={(e) => { const d = fromDateInputValue(e.target.value); if (d) onChange(d) }}
        />
      </span>
    </div>
  )
}

// ---------- Category chips ----------

/** The given `top` categories as chips (plus the current one if it isn't among them); the rest open behind "More". */
export function CategoryChips({ top, all, value, onChange, label, tone }: {
  top: Category[]; all: Category[]; value: Category; onChange: (c: Category) => void; label: string; tone?: 'income' | 'expense'
}) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? all : top.includes(value) || !all.includes(value) ? top : [...top, value]
  const hidden = all.length - shown.length
  return (
    <div className="cat-chip-grid" role="radiogroup" aria-label={label} data-tone={tone}>
      {shown.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} className="cat-chip"
          onClick={() => { onChange(c); setExpanded(false) }}
          {...rovingRadio(shown, value, c, (k) => onChange(k as Category))}>
          <CategoryBadge category={c} size={28} />
          {categoryMeta[c].title}
        </button>
      ))}
      {!expanded && hidden > 0 && (
        <button type="button" className="cat-chip cat-chip-more" aria-expanded={false} onClick={() => setExpanded(true)}>
          <Icon name="ellipsis" size={16} strokeWidth={2} />
          More
          <span className="sr-only">, {hidden} other categories</span>
        </button>
      )}
    </div>
  )
}

// ---------- Colour picker ----------

/** Round swatches from the categorical palette; "Auto" (undefined) keeps the default colour. */
export function ColorPicker({ colors, value, onChange, label, autoColor }: {
  colors: readonly Tint[]; value: Tint | undefined; onChange: (v: Tint | undefined) => void; label: string; autoColor: string
}) {
  const AUTO = 'auto'
  const swatchKeys = [AUTO, ...colors]
  const pick = (k: string) => onChange(k === AUTO ? undefined : (k as Tint))
  return (
    <div className="icon-picker swatch-row" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={value === undefined} aria-label="Automatic" title="Automatic"
        className="swatch swatch-auto" style={{ ['--swatch' as string]: autoColor }} onClick={() => onChange(undefined)}
        {...rovingRadio(swatchKeys, value ?? AUTO, AUTO, pick)} />
      {colors.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} title={c[0].toUpperCase() + c.slice(1)}
          className="swatch" style={{ ['--swatch' as string]: `var(--tint-${c})` }} onClick={() => onChange(c)}
          {...rovingRadio(swatchKeys, value ?? AUTO, c, pick)} />
      ))}
    </div>
  )
}
