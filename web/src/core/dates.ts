/** Local-time calendar helpers (the Mac app uses Calendar.current). */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + days)
  return r
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d)
  const day = r.getDate()
  r.setDate(1)
  r.setMonth(r.getMonth() + months)
  // Clamp to the last day of the target month (31 Jan + 1 month → 28/29 Feb).
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate()
  r.setDate(Math.min(day, last))
  return r
}

/** Whole calendar days from `from` to `to` (both at local midnight). */
export function daysBetween(from: Date, to: Date): number {
  const a = startOfDay(from), b = startOfDay(to)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

/** Whole calendar months between two dates, the way Calendar.dateComponents counts them. */
export function monthsBetween(from: Date, to: Date): number {
  const a = startOfDay(from), b = startOfDay(to)
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months -= 1
  return months
}

/** ISO-8601 without fractional seconds, which is what Swift's .iso8601 strategy writes and reads. */
export function toISO(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function parseISO(s: string): Date {
  return new Date(s)
}

/** "2026-11-01" in local time, for <input type="date">. */
export function toDateInputValue(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "2026-11-01T09:30" in local time, for <input type="datetime-local">. */
export function toDateTimeInputValue(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${toDateInputValue(d)}T${h}:${min}`
}

export function fromDateInputValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function fromDateTimeInputValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
}
