/**
 * Interface languages. English text is the key: `t('Add transaction')`. Russian and Uzbek dictionaries map
 * that English text to a translation; anything missing falls back to English, so a gap never shows a raw key.
 *
 * - Placeholders: `t('{amount} left', { amount })`.
 * - Plurals: the key lists the English forms with "|" (`'{n} transaction|{n} transactions'`) and is called
 *   with `n`; a translation gives its own forms as an array (Russian: one / few / many, Uzbek: one form).
 *
 * The current language lives here (not in React state) so plain functions such as `dayLabel` can use it;
 * the store sets it and re-renders the app when it changes.
 */
import ru from './ru'
import uz from './uz'

export type Lang = 'en' | 'ru' | 'uz'
export type Dictionary = Record<string, string | string[]>

export const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ru', label: 'Русский' },
  { value: 'uz', label: 'Oʻzbekcha' },
]

const dictionaries: Record<Lang, Dictionary> = { en: {}, ru, uz }

let current: Lang = 'en'

export function getLanguage(): Lang {
  return current
}

export function setLanguage(lang: Lang) {
  current = lang
  if (typeof document !== 'undefined') document.documentElement.lang = lang
}

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ru' || v === 'uz'
}

/** Best guess for a first launch: Telegram's or the browser's language, else English. */
export function guessLanguage(code?: string | null): Lang {
  const c = (code ?? (typeof navigator !== 'undefined' ? navigator.language : '') ?? '').toLowerCase()
  if (c.startsWith('ru')) return 'ru'
  if (c.startsWith('uz')) return 'uz'
  return 'en'
}

/** Which plural form to use: English and Uzbek forms are [one, other]; Russian [one, few, many]. */
function pluralIndex(lang: Lang, n: number): number {
  const abs = Math.abs(n)
  if (lang === 'ru') {
    if (!Number.isInteger(abs)) return 1
    const m10 = abs % 10, m100 = abs % 100
    if (m10 === 1 && m100 !== 11) return 0
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 1
    return 2
  }
  return abs === 1 ? 0 : 1
}

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

export function t(key: string, params?: Record<string, string | number>): string {
  const entry = dictionaries[current][key] ?? key
  const forms = Array.isArray(entry) ? entry : entry.includes('|') ? entry.split('|') : [entry]
  if (forms.length === 1) return fill(forms[0], params)
  const n = typeof params?.n === 'number' ? params.n : 0
  // A translation with fewer forms than the rule asks for uses its last one.
  return fill(forms[Math.min(pluralIndex(current, n), forms.length - 1)], params)
}

// ---------- Dates ----------

const months: Record<Lang, { standalone: string[]; inDate: string[]; short: string[] }> = {
  en: {
    standalone: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    inDate: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  },
  ru: {
    standalone: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    inDate: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
    short: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  },
  uz: {
    standalone: ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'],
    inDate: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'],
    short: ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'],
  },
}

/** "November" on its own (a heading, "Income · November"). */
export function monthTitle(monthIndex: number): string {
  return months[current].standalone[monthIndex]
}

/** "12 November" / "12 ноября" / "12-noyabr", with the year when asked. */
export function dayMonth(day: number, monthIndex: number, year?: number): string {
  const m = months[current].inDate[monthIndex]
  const base = current === 'uz' ? `${day}-${m}` : `${day} ${m}`
  return year === undefined ? base : current === 'uz' ? `${year}-yil ${base}` : `${base} ${year}`
}

/** "12 Nov" / "12 ноя" / "12-noy" for chart axes and tight spots. */
export function dayMonthShort(day: number, monthIndex: number): string {
  const m = months[current].short[monthIndex]
  return current === 'uz' ? `${day}-${m}` : `${day} ${m}`
}
