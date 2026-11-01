import { currencyMeta, type CurrencyCode } from './currency'
import { isSameDay, isSameMonth, addDays } from './dates'

const NBSP = ' '
const MINUS = '−'

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep)
}

/**
 * Full money string with grouping and the currency's symbol placement.
 * "125 400 soʻm", "$1,234.50", "−45 000 soʻm". Mirrors FTFormat.money.
 */
export function money(amount: number, currency: CurrencyCode): string {
  if (!Number.isFinite(amount)) return '—'
  const meta = currencyMeta[currency]
  const abs = Math.abs(amount)
  const digits = meta.fractionDigits
  // Round ONCE, half away from zero, to the currency's precision and format that value,
  // so the sign and the digits always agree ("$0.02" for 0.015, never "$2.00" for 2.005).
  const scale = 10 ** digits
  const rounded = Math.round(abs * scale) / scale
  // Whole amounts stay clean ("$350"); fractional ones get full precision ("$1,368.10").
  const hasFraction = digits > 0 && rounded % 1 !== 0
  const fixed = rounded.toFixed(hasFraction ? digits : 0)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = group(intPart, meta.symbolLeading ? ',' : NBSP)
  const magnitude = fracPart ? `${grouped}${meta.symbolLeading ? '.' : ','}${fracPart}` : grouped
  // Sign follows the ROUNDED magnitude so -0.001 soʻm never prints "−0 soʻm".
  const sign = amount < 0 && rounded > 0 ? MINUS : ''
  return meta.symbolLeading ? `${sign}${meta.symbol}${magnitude}` : `${sign}${magnitude}${NBSP}${meta.symbol}`
}

function trimmed(value: number): string {
  const r = Math.round(value * 10) / 10
  return r === Math.round(r) ? String(Math.round(r)) : r.toFixed(1)
}

/** Compact money for chart axes and tight tiles: "12.4M soʻm", "$1.2K". */
export function compactMoney(amount: number, currency: CurrencyCode): string {
  if (!Number.isFinite(amount)) return '—'
  const meta = currencyMeta[currency]
  const sign = amount < 0 ? MINUS : ''
  const value = Math.abs(amount)
  let magnitude: string
  // Thresholds sit at x99.95 so rounding promotes to the next unit.
  if (value >= 999_950_000_000) magnitude = trimmed(value / 1_000_000_000_000) + 'T'
  else if (value >= 999_950_000) magnitude = trimmed(value / 1_000_000_000) + 'B'
  else if (value >= 999_950) magnitude = trimmed(value / 1_000_000) + 'M'
  else if (value >= 10_000) magnitude = trimmed(value / 1_000) + 'K'
  else return money(amount, currency)
  return meta.symbolLeading ? `${sign}${meta.symbol}${magnitude}` : `${sign}${magnitude}${NBSP}${meta.symbol}`
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function monthName(d: Date): string {
  return monthNames[d.getMonth()]
}

/** "Today", "Yesterday", or "12 July" (with the year when it differs). */
export function dayLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return 'Today'
  if (isSameDay(date, addDays(now, -1))) return 'Yesterday'
  const sameYear = isSameMonth(date, now) || date.getFullYear() === now.getFullYear()
  return sameYear ? `${date.getDate()} ${monthName(date)}` : `${date.getDate()} ${monthName(date)} ${date.getFullYear()}`
}

/** "12 Jul" for chart axes. */
export function shortDay(date: Date): string {
  return `${date.getDate()} ${monthName(date).slice(0, 3)}`
}

/** A unit rate, widening precision for tiny values so they never collapse to zero. */
export function rateString(value: number, currency: CurrencyCode): string {
  if (!Number.isFinite(value) || value <= 0) return money(0, currency)
  const meta = currencyMeta[currency]
  let decimals: number
  if (value >= 1000) decimals = 0
  else if (value >= 1) decimals = 2
  else decimals = Math.min(8, -Math.floor(Math.log10(value)) + 2)
  // Strip trailing zeros only when there is a decimal part ("12 110", not "1 211").
  const fixed = decimals > 0 ? value.toFixed(decimals).replace(/\.?0+$/, '') : value.toFixed(0)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = group(intPart, meta.symbolLeading ? ',' : NBSP)
  const magnitude = fracPart ? `${grouped}${meta.symbolLeading ? '.' : ','}${fracPart}` : grouped
  return meta.symbolLeading ? `${meta.symbol}${magnitude}` : `${magnitude}${NBSP}${meta.symbol}`
}

/** Plain number for input fields: no grouping, up to 2 decimals, locale-independent. */
export function plainNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  const r = Math.round(value * 100) / 100
  return String(r)
}

/** Lenient numeric parse: accepts "1 234,5", "1,234.5", "12 310". */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(/[\s ']/g, '')
  if (!s) return null
  let normalized = s
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the later one is the decimal separator.
    normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // Only commas: a single comma followed by 1–2 digits is decimal, otherwise grouping.
    const parts = s.split(',')
    normalized = parts.length === 2 && parts[1].length <= 2 && parts[1].length > 0 ? `${parts[0]}.${parts[1]}` : s.replace(/,/g, '')
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}
