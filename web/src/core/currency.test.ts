import { describe, expect, it } from 'vitest'
import { CURRENCIES, convert, currencyMeta, defaultRates, isCurrencyCode, type Rates } from './currency'
import { CATEGORIES, categoryMeta, expenseCategories, incomeCategories, isCategory } from './category'

const approx = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)))

describe('currency metadata (ConversionTests.currencyMetadata)', () => {
  it('has the seven currencies with Mac-app placement and precision', () => {
    expect(CURRENCIES).toHaveLength(7)
    expect(currencyMeta.USD.symbolLeading && currencyMeta.JPY.symbolLeading).toBe(true)
    expect(currencyMeta.UZS.symbolLeading || currencyMeta.RUB.symbolLeading || currencyMeta.KZT.symbolLeading).toBe(false)
    expect([currencyMeta.JPY, currencyMeta.UZS, currencyMeta.KZT].map((m) => m.fractionDigits)).toEqual([0, 0, 0])
    expect([currencyMeta.USD, currencyMeta.RUB, currencyMeta.GBP, currencyMeta.EUR].map((m) => m.fractionDigits)).toEqual([2, 2, 2, 2])
    expect(currencyMeta.UZS.symbol).toBe('soʻm')
  })

  it('default rates cover every currency, are positive, and UZS is 1', () => {
    for (const code of CURRENCIES) expect(defaultRates[code]).toBeGreaterThan(0)
    expect(defaultRates).toEqual({ UZS: 1, USD: 12_110, EUR: 14_150, GBP: 16_320, RUB: 155, KZT: 23.5, JPY: 82 })
  })

  it('isCurrencyCode', () => {
    expect(isCurrencyCode('USD')).toBe(true)
    expect(isCurrencyCode('usd')).toBe(false)
    expect(isCurrencyCode('XXX')).toBe(false)
    expect(isCurrencyCode(42)).toBe(false)
    expect(isCurrencyCode(undefined)).toBe(false)
  })
})

describe('convert', () => {
  it.each(CURRENCIES)('identity for %s', (code) => {
    expect(convert(defaultRates, 123.45, code, code)).toBe(123.45)
    expect(convert(defaultRates, -7, code, code)).toBe(-7)
  })

  it('identity holds even when that currency has an invalid rate', () => {
    const rates: Rates = { ...defaultRates, USD: 0 }
    expect(convert(rates, 5, 'USD', 'USD')).toBe(5)
  })

  it('to and from UZS', () => {
    expect(convert(defaultRates, 1, 'USD', 'UZS')).toBe(12_110)
    expect(convert(defaultRates, 100, 'USD', 'UZS')).toBe(1_211_000)
    expect(convert(defaultRates, 12_110, 'UZS', 'USD')).toBe(1)
    expect(convert(defaultRates, 100, 'KZT', 'UZS')).toBe(2_350)
  })

  it('cross rates go through UZS', () => {
    approx(convert(defaultRates, 1, 'EUR', 'USD'), 14_150 / 12_110)
    approx(convert(defaultRates, 1_000, 'JPY', 'RUB'), (1_000 * 82) / 155)
    const there = convert(defaultRates, 987.65, 'GBP', 'KZT')
    approx(convert(defaultRates, there, 'KZT', 'GBP'), 987.65)
  })

  it('custom rates are used', () => {
    const rates: Rates = { ...defaultRates, USD: 10_000, EUR: 20_000 }
    expect(convert(rates, 1, 'EUR', 'USD')).toBe(2)
  })

  it('a zero, negative, NaN or missing rate yields 0 — never NaN, Infinity, or a flipped sign', () => {
    const bad: Array<Partial<Rates>> = [{ USD: 0 }, { USD: -12_110 }, { USD: NaN }, { USD: undefined }]
    for (const patch of bad) {
      const rates = { ...defaultRates, ...patch } as Rates
      if (patch.USD === undefined) delete (rates as Partial<Rates>).USD
      for (const [from, to] of [['USD', 'UZS'], ['UZS', 'USD'], ['USD', 'EUR'], ['EUR', 'USD']] as const) {
        const r = convert(rates, 100, from, to)
        expect(Number.isNaN(r)).toBe(false)
        expect(r).toBe(0)
      }
    }
  })
})

describe('categories', () => {
  it('every category has meta and type guards work', () => {
    expect(CATEGORIES).toHaveLength(18)
    for (const c of CATEGORIES) expect(categoryMeta[c].title.length).toBeGreaterThan(0)
    expect(isCategory('groceries')).toBe(true)
    expect(isCategory('Groceries')).toBe(false)
    expect(isCategory(null)).toBe(false)
  })

  it('income/expense lists route debt categories correctly', () => {
    expect(incomeCategories).toContain('loanReceived')
    expect(incomeCategories).not.toContain('debtPayment')
    expect(expenseCategories).toContain('debtPayment')
    expect(expenseCategories).not.toContain('salary')
    expect(expenseCategories).not.toContain('transfer')
  })
})
