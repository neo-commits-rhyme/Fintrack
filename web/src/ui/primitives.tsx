import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Icon } from './icons'
import { CURRENCIES, currencyMeta, categoryMeta, parseAmount, plainNumber, type Category, type CurrencyCode } from '../core'

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
          <span className="icon-chip" style={{ color, background: bg }}><Icon name={icon} size={13} strokeWidth={2.5} /></span>
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
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} strokeWidth={variant === 'primary' ? 2.25 : 2} />}
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
  const [text, setText] = useState(plainNumber(value))
  const lastParsed = useRef(value)
  useEffect(() => {
    if (value !== lastParsed.current) {
      setText(plainNumber(value))
      lastParsed.current = value
    }
  }, [value])
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`input num ${hero ? 'input-hero' : ''} ${className}`.trim()}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const parsed = parseAmount(e.target.value)
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
      {CURRENCIES.map((c) => <option key={c} value={c}>{currencyMeta[c].flag} {c}</option>)}
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

export function Segmented<T extends string>({ options, value, onChange, label, block }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string; block?: boolean }) {
  return (
    <div className={`segmented ${block ? 'segmented-block' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const i = options.findIndex((x) => x.value === value)
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onChange(options[(i + 1) % options.length].value) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onChange(options[(i - 1 + options.length) % options.length].value) }
          }}
          tabIndex={o.value === value ? 0 : -1}>
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
        <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={name.replace(/-/g, ' ')} className="icon-pick" onClick={() => onChange(name)}>
          <Icon name={name} size={16} strokeWidth={2} />
        </button>
      ))}
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
