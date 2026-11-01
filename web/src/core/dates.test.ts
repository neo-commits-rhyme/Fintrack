import { afterEach, describe, expect, it } from 'vitest'
import {
  addDays, addMonths, daysBetween, fromDateInputValue, fromDateTimeInputValue, isSameDay, isSameMonth,
  monthsBetween, parseISO, startOfDay, startOfMonth, toDateInputValue, toDateTimeInputValue, toISO,
} from './dates'

const originalTZ = process.env.TZ
/** Run `fn` in a timezone with DST. Node re-reads TZ when process.env.TZ is assigned. */
function inTZ<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz
  try { return fn() } finally { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ }
}
afterEach(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ })

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()]

describe('startOfDay / startOfMonth / isSameDay / isSameMonth (FormattingTests.swift)', () => {
  it('startOfMonth of 29 Feb 2024 23:59:59 is 1 Feb 00:00:00 and idempotent', () => {
    const s = startOfMonth(new Date(2024, 1, 29, 23, 59, 59))
    expect([...ymd(s), s.getHours(), s.getMinutes(), s.getSeconds()]).toEqual([2024, 2, 1, 0, 0, 0])
    expect(startOfMonth(s).getTime()).toBe(s.getTime())
  })

  it('startOfDay is local midnight of the same day', () => {
    const d = new Date(2026, 10, 1, 17, 45, 12, 999)
    const s = startOfDay(d)
    expect(s.getTime()).toBeLessThanOrEqual(d.getTime())
    expect(isSameDay(s, d)).toBe(true)
    expect([s.getHours(), s.getMinutes(), s.getSeconds(), s.getMilliseconds()]).toEqual([0, 0, 0, 0])
  })

  it('isSameMonth across years', () => {
    expect(isSameMonth(new Date(2025, 10, 15), new Date(2026, 10, 15))).toBe(false)
    expect(isSameMonth(new Date(2026, 10, 15), new Date(2026, 10, 30, 23))).toBe(true)
    expect(isSameMonth(new Date(2025, 11, 31, 23, 59), new Date(2026, 0, 1))).toBe(false)
  })

  it('isSameDay at the day edges', () => {
    const a = new Date(2026, 2, 1, 0, 0, 0)
    const b = new Date(2026, 2, 1, 23, 59, 59)
    expect(isSameDay(a, b)).toBe(true)
    expect(isSameDay(a, new Date(a.getTime() - 1000))).toBe(false)
  })
})

describe('addDays / addMonths', () => {
  it('addDays does not mutate and crosses month/year boundaries', () => {
    const d = new Date(2026, 11, 31, 10)
    const r = addDays(d, 1)
    expect(ymd(r)).toEqual([2027, 1, 1])
    expect(r.getHours()).toBe(10)
    expect(ymd(d)).toEqual([2026, 12, 31])
    expect(ymd(addDays(new Date(2026, 2, 1), -1))).toEqual([2026, 2, 28])
  })

  it('addMonths clamps to the last day of the target month', () => {
    expect(ymd(addMonths(new Date(2026, 0, 31), 1))).toEqual([2026, 2, 28])
    expect(ymd(addMonths(new Date(2024, 0, 31), 1))).toEqual([2024, 2, 29])
    expect(ymd(addMonths(new Date(2026, 2, 31), 1))).toEqual([2026, 4, 30])
    expect(ymd(addMonths(new Date(2026, 4, 31), 6))).toEqual([2026, 11, 30])
    expect(ymd(addMonths(new Date(2026, 0, 15), 1))).toEqual([2026, 2, 15])
  })

  it('addMonths across years, negative offsets, and keeps the time of day', () => {
    expect(ymd(addMonths(new Date(2026, 10, 30), 3))).toEqual([2027, 2, 28])
    expect(ymd(addMonths(new Date(2026, 2, 31), -1))).toEqual([2026, 2, 28])
    expect(ymd(addMonths(new Date(2026, 0, 31), -2))).toEqual([2025, 11, 30])
    const d = new Date(2026, 0, 31, 9, 15)
    const r = addMonths(d, 1)
    expect([r.getHours(), r.getMinutes()]).toEqual([9, 15])
    expect(ymd(d)).toEqual([2026, 1, 31]) // not mutated
  })
})

describe('monthsBetween (Calendar.dateComponents semantics)', () => {
  it('counts whole calendar months', () => {
    expect(monthsBetween(new Date(2026, 0, 31), new Date(2026, 1, 28))).toBe(0)
    expect(monthsBetween(new Date(2026, 0, 1), new Date(2026, 1, 1))).toBe(1)
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 14))).toBe(0)
    expect(monthsBetween(new Date(2026, 0, 15), new Date(2026, 1, 15))).toBe(1)
    expect(monthsBetween(new Date(2026, 10, 1), new Date(2027, 4, 1))).toBe(6)
    expect(monthsBetween(new Date(2026, 10, 1), new Date(2026, 10, 30))).toBe(0)
  })

  it('ignores the time of day', () => {
    expect(monthsBetween(new Date(2026, 0, 1, 23, 59), new Date(2026, 1, 1, 0, 1))).toBe(1)
  })
})

describe('daysBetween', () => {
  it('whole calendar days, time of day ignored', () => {
    expect(daysBetween(new Date(2026, 10, 1, 23, 59), new Date(2026, 10, 2, 0, 1))).toBe(1)
    expect(daysBetween(new Date(2026, 10, 2), new Date(2026, 10, 1))).toBe(-1)
    expect(daysBetween(new Date(2026, 0, 1), new Date(2027, 0, 1))).toBe(365)
    expect(daysBetween(new Date(2026, 10, 1, 8), new Date(2026, 10, 1, 20))).toBe(0)
  })

  it('is exact across DST changes (America/New_York, spring forward and fall back)', () => {
    inTZ('America/New_York', () => {
      // Sanity: the zone really has DST here, otherwise the test proves nothing.
      expect(new Date(2026, 2, 7).getTimezoneOffset()).not.toBe(new Date(2026, 2, 9).getTimezoneOffset())
      // 8 March 2026: a 23-hour day.
      expect(daysBetween(new Date(2026, 2, 7, 12), new Date(2026, 2, 9, 12))).toBe(2)
      expect(daysBetween(new Date(2026, 2, 8, 0), new Date(2026, 2, 9, 0))).toBe(1)
      // 1 November 2026: a 25-hour day.
      expect(daysBetween(new Date(2026, 9, 31, 23, 30), new Date(2026, 10, 2, 0, 30))).toBe(2)
      expect(daysBetween(new Date(2026, 10, 1, 0), new Date(2026, 10, 2, 0))).toBe(1)
      expect(daysBetween(new Date(2026, 0, 1), new Date(2026, 11, 31))).toBe(364)
      // addDays steps calendar days, not 24h blocks.
      const r = addDays(new Date(2026, 2, 7, 12), 1)
      expect([...ymd(r), r.getHours()]).toEqual([2026, 3, 8, 12])
    })
  })
})

describe('ISO strings', () => {
  it('toISO strips milliseconds and writes UTC with Z', () => {
    expect(toISO(new Date(Date.UTC(2026, 10, 1, 9, 0, 0, 123)))).toBe('2026-11-01T09:00:00Z')
    expect(toISO(new Date(Date.UTC(2026, 8, 21, 14, 13, 20)))).toBe('2026-09-21T14:13:20Z')
    expect(toISO(new Date(1_790_000_000_000))).toBe('2026-09-21T14:13:20Z')
    expect(toISO(new Date(Date.UTC(2026, 10, 1, 9, 0, 0, 999)))).toBe('2026-11-01T09:00:00Z')
  })

  it('parseISO reads what toISO writes', () => {
    const d = new Date(2026, 10, 1, 9, 30, 15)
    expect(parseISO(toISO(d)).getTime()).toBe(d.getTime())
  })
})

describe('input values', () => {
  it('toDateInputValue / fromDateInputValue', () => {
    expect(toDateInputValue(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    const d = fromDateInputValue('2026-11-01')!
    expect([...ymd(d), d.getHours()]).toEqual([2026, 11, 1, 0])
    expect(fromDateInputValue('2026-1-1')).toBeNull()
    expect(fromDateInputValue('')).toBeNull()
  })

  it('toDateTimeInputValue / fromDateTimeInputValue round trip (local, minute precision)', () => {
    const d = new Date(2026, 10, 1, 9, 30)
    expect(toDateTimeInputValue(d)).toBe('2026-11-01T09:30')
    expect(fromDateTimeInputValue('2026-11-01T09:30')!.getTime()).toBe(d.getTime())
    for (const x of [new Date(2026, 0, 1, 0, 0), new Date(2024, 1, 29, 23, 59), new Date(2026, 11, 31, 12, 5)]) {
      expect(fromDateTimeInputValue(toDateTimeInputValue(x))!.getTime()).toBe(x.getTime())
    }
    // Seconds are dropped.
    expect(fromDateTimeInputValue(toDateTimeInputValue(new Date(2026, 10, 1, 9, 30, 45)))!.getTime()).toBe(d.getTime())
    // Browsers may append seconds.
    expect(fromDateTimeInputValue('2026-11-01T09:30:00')!.getTime()).toBe(d.getTime())
    expect(fromDateTimeInputValue('2026-11-01')).toBeNull()
    expect(fromDateTimeInputValue('garbage')).toBeNull()
  })
})
