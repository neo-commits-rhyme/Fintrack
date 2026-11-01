export type CurrencyCode = 'UZS' | 'KZT' | 'RUB' | 'USD' | 'JPY' | 'GBP' | 'EUR'

export const CURRENCIES: CurrencyCode[] = ['UZS', 'KZT', 'RUB', 'USD', 'JPY', 'GBP', 'EUR']

export interface CurrencyMeta {
  symbol: string
  name: string
  flag: string
  /** Symbol before the amount ($12) or after (12 soʻm). */
  symbolLeading: boolean
  fractionDigits: number
}

export const currencyMeta: Record<CurrencyCode, CurrencyMeta> = {
  UZS: { symbol: 'soʻm', name: 'Uzbek soʻm', flag: '🇺🇿', symbolLeading: false, fractionDigits: 0 },
  KZT: { symbol: '₸', name: 'Kazakhstani tenge', flag: '🇰🇿', symbolLeading: false, fractionDigits: 0 },
  RUB: { symbol: '₽', name: 'Russian ruble', flag: '🇷🇺', symbolLeading: false, fractionDigits: 2 },
  USD: { symbol: '$', name: 'US dollar', flag: '🇺🇸', symbolLeading: true, fractionDigits: 2 },
  JPY: { symbol: '¥', name: 'Japanese yen', flag: '🇯🇵', symbolLeading: true, fractionDigits: 0 },
  GBP: { symbol: '£', name: 'British pound', flag: '🇬🇧', symbolLeading: true, fractionDigits: 2 },
  EUR: { symbol: '€', name: 'Euro', flag: '🇪🇺', symbolLeading: true, fractionDigits: 2 },
}

export type Rates = Record<CurrencyCode, number>

/** UZS per 1 unit of each currency. Matches the Mac app's defaults. */
export const defaultRates: Rates = {
  UZS: 1,
  USD: 12_110,
  EUR: 14_150,
  GBP: 16_320,
  RUB: 155,
  KZT: 23.5,
  JPY: 82,
}

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as string[]).includes(value)
}

/** Every conversion crosses through UZS at the user's rates. */
export function convert(rates: Rates, amount: number, from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return amount
  const fromRate = rates[from]
  const toRate = rates[to]
  if (!(fromRate > 0) || !(toRate > 0)) return 0
  return (amount * fromRate) / toRate
}
