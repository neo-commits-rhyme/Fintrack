import { afterEach, describe, expect, it } from 'vitest'
import { dayMonth, dayMonthShort, guessLanguage, monthTitle, setLanguage, t } from './index'
import { dayLabel } from '../core/format'

afterEach(() => setLanguage('en'))

describe('t()', () => {
  it('returns the English key when no translation exists', () => {
    setLanguage('ru')
    expect(t('A sentence nobody translated')).toBe('A sentence nobody translated')
  })

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(t('{amount} left over, {missing}', { amount: '5,000 soʻm' })).toBe('5,000 soʻm left over, {missing}')
  })

  it('picks English plural forms', () => {
    expect(t('{n} item|{n} items', { n: 1 })).toBe('1 item')
    expect(t('{n} item|{n} items', { n: 0 })).toBe('0 items')
    expect(t('{n} item|{n} items', { n: 5 })).toBe('5 items')
  })

  it('picks Russian one / few / many', () => {
    setLanguage('ru')
    const key = '{n} transaction|{n} transactions'
    const forms = (n: number) => t(key, { n })
    // Whatever the wording, 1/21 share a form, 2/3/4/22 share a form, 5/11/12/14/25 share a form.
    expect(forms(1)).toBe(forms(21).replace('21', '1'))
    expect(forms(2)).toBe(forms(22).replace('22', '2'))
    expect(forms(5)).toBe(forms(11).replace('11', '5'))
    expect(forms(5)).toBe(forms(12).replace('12', '5'))
    expect(forms(1)).not.toBe(forms(2).replace('2', '1'))
    expect(forms(2)).not.toBe(forms(5).replace('5', '2'))
  })
})

describe('dates', () => {
  const nov12 = new Date(2026, 10, 12)
  const now = new Date(2026, 10, 24)

  it('English', () => {
    expect(monthTitle(10)).toBe('November')
    expect(dayLabel(nov12, now)).toBe('12 November')
    expect(dayMonthShort(12, 10)).toBe('12 Nov')
  })

  it('Russian uses the genitive month inside a date', () => {
    setLanguage('ru')
    expect(monthTitle(10)).toBe('Ноябрь')
    expect(dayLabel(nov12, now)).toBe('12 ноября')
    expect(dayMonth(12, 10, 2025)).toBe('12 ноября 2025')
  })

  it('Uzbek writes day-month with a hyphen', () => {
    setLanguage('uz')
    expect(monthTitle(10)).toBe('Noyabr')
    expect(dayLabel(nov12, now)).toBe('12-noyabr')
    expect(dayMonth(12, 10, 2025)).toBe('2025-yil 12-noyabr')
  })

  it('Today and Yesterday follow the language', () => {
    setLanguage('ru')
    expect(dayLabel(now, now)).toBe(t('Today'))
    expect(dayLabel(now, now)).not.toBe('Today')
  })
})

describe('guessLanguage', () => {
  it.each([['ru', 'ru'], ['ru-RU', 'ru'], ['uz', 'uz'], ['uz-Latn', 'uz'], ['en-US', 'en'], ['de', 'en'], ['', 'en']])('%s → %s', (code, lang) => {
    expect(guessLanguage(code)).toBe(lang)
  })
})
