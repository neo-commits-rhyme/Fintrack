import { describe, expect, it } from 'vitest'
import { compactMoney, dayLabel, money, monthName, parseAmount, plainNumber, rateString, shortDay } from './format'
import { CURRENCIES, currencyMeta } from './currency'

const NBSP = ' '
const MINUS = '−'

describe('money — symbol placement and grouping (FormattingTests.swift)', () => {
  it('prefix currencies use comma grouping and dot decimals', () => {
    expect(money(1_234.5, 'USD')).toBe('$1,234.50')
    expect(money(1_234_567, 'USD')).toBe('$1,234,567')
    expect(money(1_368.1, 'GBP')).toBe('£1,368.10')
    expect(money(999, 'EUR')).toBe('€999')
    expect(money(1_000_000, 'JPY')).toBe('¥1,000,000')
    expect(money(1_234.56, 'JPY')).toBe('¥1,235')
  })

  it('suffix currencies use U+00A0 grouping, comma decimals and U+00A0 before the symbol', () => {
    expect(money(125_400, 'UZS')).toBe(`125${NBSP}400${NBSP}soʻm`)
    expect(money(12_110, 'UZS')).toBe(`12${NBSP}110${NBSP}soʻm`)
    expect(money(23_380_412, 'UZS')).toBe(`23${NBSP}380${NBSP}412${NBSP}soʻm`)
    expect(money(1_234.5, 'RUB')).toBe(`1${NBSP}234,50${NBSP}₽`)
    expect(money(500, 'KZT')).toBe(`500${NBSP}₸`)
    expect(money(12_110, 'UZS')).not.toContain(' ')
    expect(money(1_234_567.89, 'RUB')).not.toContain(' ')
  })

  it('whole amounts have no decimals', () => {
    expect(money(350, 'USD')).toBe('$350')
    expect(money(350, 'RUB')).toBe(`350${NBSP}₽`)
    expect(money(0, 'USD')).toBe('$0')
    expect(money(0, 'UZS')).toBe(`0${NBSP}soʻm`)
    // Rounds to a whole number at 2dp → still no decimals.
    expect(money(0.999, 'USD')).toBe('$1')
    expect(money(1.996, 'USD')).toBe('$2')
  })

  it('fractional amounts always show two decimals ("$1,368.10", never "$1,368.1")', () => {
    expect(money(1_368.1, 'USD')).toBe('$1,368.10')
    expect(money(1_368.1, 'EUR')).toBe('€1,368.10')
    expect(money(1.5, 'USD')).toBe('$1.50')
    expect(money(0.01, 'USD')).toBe('$0.01')
    expect(money(2.99, 'USD')).toBe('$2.99')
    expect(money(1.994, 'USD')).toBe('$1.99')
    expect(money(1_368.1, 'USD')).not.toBe('$1,368.1')
  })

  it.each(['JPY', 'UZS', 'KZT'] as const)('%s never shows a fraction', (code) => {
    for (const amount of [0.4, 12.75, 1_234.56, 99.99, 2.5, 0.125]) {
      const s = money(amount, code)
      const decimalSeparator = currencyMeta[code].symbolLeading ? '.' : ','
      expect(s, `${amount} ${code} → ${s}`).not.toContain(decimalSeparator)
    }
    expect(money(12.75, 'JPY')).toBe('¥13')
    expect(money(12.75, 'KZT')).toBe(`13${NBSP}₸`)
  })

  it('RUB uses "," as decimal separator and U+00A0 grouping', () => {
    expect(money(1_234_567.89, 'RUB')).toBe(`1${NBSP}234${NBSP}567,89${NBSP}₽`)
    expect(money(0.5, 'RUB')).toBe(`0,50${NBSP}₽`)
  })

  it('is locale independent', () => {
    expect(money(1_234_567.89, 'USD')).toBe('$1,234,567.89')
  })

  it('negatives use U+2212 before the symbol (never ASCII "-")', () => {
    expect(money(-45_000, 'UZS')).toBe(`${MINUS}45${NBSP}000${NBSP}soʻm`)
    expect(money(-12.5, 'USD')).toBe(`${MINUS}$12.50`)
    expect(money(-1, 'USD')).not.toContain('-')
  })

  it('tiny negatives print without a minus', () => {
    expect(money(-0.001, 'UZS')).toBe(`0${NBSP}soʻm`)
    expect(money(-0.001, 'USD')).toBe('$0')
    expect(money(-0.004, 'USD')).toBe('$0')
    expect(money(-0.4, 'UZS')).toBe(`0${NBSP}soʻm`)
    expect(money(-0, 'USD')).toBe('$0')
  })

  it('a negative half cent never prints "−$0"', () => {
    const s = money(-0.005, 'USD')
    expect([`${MINUS}$0.01`, '$0']).toContain(s)
  })

  it('rounds half away from zero', () => {
    expect(money(2.5, 'UZS')).toBe(`3${NBSP}soʻm`)
    expect(money(-2.5, 'UZS')).toBe(`${MINUS}3${NBSP}soʻm`)
    expect(money(0.125, 'USD')).toBe('$0.13')
    expect(money(12_110.5, 'UZS')).toBe(`12${NBSP}111${NBSP}soʻm`)
  })

  // BUG: money() formats the UNROUNDED magnitude (`abs.toFixed`, format.ts:22) instead of the
  // value it rounded half-away-from-zero on line 20 (the Swift FTFormat.money formats
  // `roundedMagnitude`). Binary halves like 2.005 then print "$2.00" (a whole amount with
  // decimals) and 0.015 prints "$0.01" where the Mac app prints "$2.01" / "$0.02".
  it('rounds the magnitude once and formats that (parity with FTFormat.money)', () => {
    expect(money(2.005, 'USD')).toBe('$2.01')
    expect(money(2.005, 'USD')).not.toMatch(/\.00$/)
    expect(money(0.015, 'USD')).toBe('$0.02')
    expect(money(0.045, 'EUR')).toBe('€0.05')
  })

  it('does not throw on NaN / ±Infinity', () => {
    for (const code of CURRENCIES) {
      for (const v of [NaN, Infinity, -Infinity]) {
        expect(() => money(v, code)).not.toThrow()
        expect(() => compactMoney(v, code)).not.toThrow()
        expect(typeof money(v, code)).toBe('string')
      }
    }
    expect(() => compactMoney(1e30, 'USD')).not.toThrow()
  })

  // BUG: FTFormat.money / compactMoney return "—" for non-finite input
  // (AppStore.swift:725, :739); the web port prints "$NaN" / "$InfinityB".
  // Fix: `if (!Number.isFinite(amount)) return '—'` at the top of money() and compactMoney().
  it('prints "—" for non-finite amounts like the Mac app', () => {
    expect(money(NaN, 'USD')).toBe('—')
    expect(money(Infinity, 'UZS')).toBe('—')
    expect(compactMoney(Infinity, 'USD')).toBe('—')
    expect(compactMoney(-Infinity, 'USD')).toBe('—')
  })
})

describe('compactMoney', () => {
  it('below 10 000 it is the full money string', () => {
    expect(compactMoney(9_999, 'UZS')).toBe(money(9_999, 'UZS'))
    expect(compactMoney(9_999, 'UZS')).toBe(`9${NBSP}999${NBSP}soʻm`)
    expect(compactMoney(1_000, 'USD')).toBe('$1,000')
    expect(compactMoney(1_234.5, 'USD')).toBe('$1,234.50')
    expect(compactMoney(0, 'USD')).toBe('$0')
  })

  it('thresholds promote at x99.95', () => {
    expect(compactMoney(10_000, 'UZS')).toBe(`10K${NBSP}soʻm`)
    expect(compactMoney(12_400, 'USD')).toBe('$12.4K')
    expect(compactMoney(99_950, 'USD')).toBe('$100K')
    expect(compactMoney(999_949, 'USD')).toBe('$999.9K')
    expect(compactMoney(999_950, 'USD')).toBe('$1M')
    expect(compactMoney(999_950, 'UZS')).toBe(`1M${NBSP}soʻm`)
    expect(compactMoney(12_400_000, 'UZS')).toBe(`12.4M${NBSP}soʻm`)
    expect(compactMoney(999_949_999, 'USD')).toBe('$999.9M')
    expect(compactMoney(999_950_000, 'USD')).toBe('$1B')
    expect(compactMoney(999_950_000, 'UZS')).toBe(`1B${NBSP}soʻm`)
    expect(compactMoney(2_500_000_000, 'USD')).toBe('$2.5B')
    expect(compactMoney(1_000_000_000_000, 'USD')).toBe('$1T')
    expect(compactMoney(999_950_000_000, 'USD')).toBe('$1T')
  })

  it('negatives use U+2212 before the symbol', () => {
    expect(compactMoney(-10_000, 'UZS')).toBe(`${MINUS}10K${NBSP}soʻm`)
    expect(compactMoney(-12_000, 'USD')).toBe(`${MINUS}$12K`)
    expect(compactMoney(-1_200_000, 'USD')).toBe(`${MINUS}$1.2M`)
    expect(compactMoney(-2_500_000, 'USD')).toBe(`${MINUS}$2.5M`)
    expect(compactMoney(-9_999, 'USD')).toBe(`${MINUS}$9,999`)
    expect(compactMoney(-1_200, 'USD')).toBe(`${MINUS}$1,200`)
    expect(compactMoney(-0.001, 'USD')).toBe('$0')
  })
})

describe('rateString', () => {
  it('widens precision for tiny rates so they never collapse to zero', () => {
    // "1 UZS = $0.0000826" (ConverterView.swift doc comment).
    expect(rateString(1 / 12_110, 'USD')).toBe('$0.0000826')
    expect(rateString(0.5, 'USD')).toBe('$0.5')
    expect(rateString(0.012345, 'EUR')).toBe('€0.0123')
  })

  it('uses 2 decimals between 1 and 1000, trimming trailing zeros', () => {
    expect(rateString(14_150 / 12_110, 'USD')).toBe('$1.17')
    expect(rateString(155, 'RUB')).toBe(`155${NBSP}₽`)
    expect(rateString(23.5, 'KZT')).toBe(`23,5${NBSP}₸`)
  })

  it('non-positive or non-finite rates fall back to money(0)', () => {
    expect(rateString(0, 'USD')).toBe('$0')
    expect(rateString(-3, 'UZS')).toBe(`0${NBSP}soʻm`)
    expect(rateString(NaN, 'USD')).toBe('$0')
    expect(rateString(Infinity, 'USD')).toBe('$0')
  })

  // BUG: format.ts:77 strips trailing zeros with /\.?0+$/ even when there is no decimal
  // point (decimals === 0 for values ≥ 1000), so 12 110 becomes "1 211 soʻm" and 1 000
  // becomes "1". Fix: only trim when `fixed` contains '.', e.g.
  // `const fixed = decimals > 0 ? value.toFixed(decimals).replace(/\.?0+$/, '') : value.toFixed(0)`.
  it('keeps integer zeros for rates ≥ 1000 ("1 USD = 12 110 soʻm")', () => {
    expect(rateString(12_110, 'UZS')).toBe(`12${NBSP}110${NBSP}soʻm`)
    expect(rateString(1_000, 'USD')).toBe('$1,000')
    expect(rateString(14_150, 'UZS')).toBe(`14${NBSP}150${NBSP}soʻm`)
  })

  it('formats rates ≥ 1000 without decimals and with grouping', () => {
    expect(rateString(16_321, 'UZS')).toBe(`16${NBSP}321${NBSP}soʻm`)
    expect(rateString(12_111.4, 'UZS')).toBe(`12${NBSP}111${NBSP}soʻm`)
  })
})

describe('parseAmount', () => {
  it.each([
    ['1 234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['1.234,5', 1234.5],
    ['12 310', 12310],
    [`12${NBSP}310`, 12310],
    ["12'310", 12310],
    ['1,5', 1.5],
    ['1,50', 1.5],
    ['1,234', 1234],
    ['1,234,567', 1234567],
    ['  42  ', 42],
    ['0.01', 0.01],
    ['-5', -5],
  ])('%j → %d', (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected)
  })

  it.each(['abc', '', '   ', '1.2.3', 'Infinity', '12abc'])('%j → null', (raw) => {
    expect(parseAmount(raw)).toBeNull()
  })
})

describe('plainNumber', () => {
  it('no grouping, at most 2 decimals, locale independent', () => {
    expect(plainNumber(12_310)).toBe('12310')
    expect(plainNumber(1_234.5)).toBe('1234.5')
    expect(plainNumber(1_234.567)).toBe('1234.57')
    expect(plainNumber(0.1 + 0.2)).toBe('0.3')
    expect(plainNumber(0)).toBe('0')
    expect(plainNumber(-7.25)).toBe('-7.25')
  })

  it('empty for null, undefined and non-finite values', () => {
    expect(plainNumber(null)).toBe('')
    expect(plainNumber(undefined)).toBe('')
    expect(plainNumber(NaN)).toBe('')
    expect(plainNumber(Infinity)).toBe('')
  })

  it('round-trips through parseAmount', () => {
    for (const v of [0, 1, 12_110, 1_234.5, 0.07, 999_999.99]) expect(parseAmount(plainNumber(v))).toBe(v)
  })
})

describe('dayLabel / shortDay / monthName', () => {
  const now = new Date(2026, 10, 15, 14, 30) // 15 November 2026, local

  it('Today and Yesterday', () => {
    expect(dayLabel(now, now)).toBe('Today')
    expect(dayLabel(new Date(2026, 10, 15, 0, 0, 0), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 10, 15, 23, 59, 59), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 10, 14, 0, 0, 0), now)).toBe('Yesterday')
    expect(dayLabel(new Date(2026, 10, 14, 23, 59, 59), now)).toBe('Yesterday')
  })

  it('Yesterday across a month and year boundary', () => {
    expect(dayLabel(new Date(2025, 11, 31, 22, 0), new Date(2026, 0, 1, 1, 0))).toBe('Yesterday')
  })

  it('"d MMMM" for other days this year, "d MMMM yyyy" for other years', () => {
    expect(dayLabel(new Date(2026, 10, 13, 12), now)).toBe('13 November')
    expect(dayLabel(new Date(2026, 6, 12, 12), now)).toBe('12 July')
    expect(dayLabel(new Date(2024, 6, 12, 12), now)).toBe('12 July 2024')
    expect(dayLabel(new Date(2025, 10, 15, 12), now)).toBe('15 November 2025')
    expect(dayLabel(new Date(2027, 0, 2, 12), now)).toBe('2 January 2027')
  })

  it('shortDay and monthName', () => {
    expect(shortDay(new Date(2026, 6, 12))).toBe('12 Jul')
    expect(shortDay(new Date(2026, 8, 1))).toBe('1 Sep')
    expect(monthName(new Date(2026, 0, 31))).toBe('January')
    expect(monthName(new Date(2026, 11, 1))).toBe('December')
  })
})
