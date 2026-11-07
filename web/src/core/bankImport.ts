import type { Category } from './category'
import type { Transaction } from './models'
import { newID } from './models'
import { toISO } from './dates'

/**
 * Bank statement import: the card export ("Filtered_Cheques" sheet, Russian
 * headers) → suggested Fintrack transactions the user reviews before saving.
 *
 * These rules are the spec for BOTH apps. The Mac port in
 * Sources/Fintrack/Store/BankImport.swift must give identical results; both
 * test suites check fixtures/bank-statement-sample.xlsx against
 * fixtures/bank-statement-sample.expected.json.
 */

export const HEADERS = {
  date: 'Дата платежа',
  time: 'Время платежа',
  operation: 'Тип операции',
  merchant: 'Имя поставщика',
  organization: 'Название организации поставщика',
  amount: 'Сумма платежа',
  category: 'Категория',
  party: 'Получатель / Отправитель',
  card: 'Номер карты',
  status: 'Состояние чека',
  terminal: 'Терминал',
} as const

export class StatementFormatError extends Error {}

export interface StatementRow {
  /** 1-based spreadsheet row number, for messages. */
  line: number
  /** Raw "dd-MM-yyyy HH:mm:ss" as printed by the bank (local time). */
  localDate: string
  /** ISO-8601 without fractional seconds, like every Fintrack date. */
  date: string
  credit: boolean
  merchant: string
  organization: string
  amount: number
  /** Bank's own category, lowercased. */
  bankCategory: string
  /** Recipient or sender name for person-to-person transfers, '' when none. */
  party: string
  status: string
  /** Last four digits of the card, '' when absent. */
  cardLast4: string
  /** Stable id: the same bank row always gets the same id, so re-imports skip it. */
  importID: string
}

export type ImportKind = 'income' | 'expense' | 'transfer'

export interface ImportDraft {
  row: StatementRow
  include: boolean
  kind: ImportKind
  category: Category
  title: string
  /** Why the row is off by default or worth a look; absent when it's routine. */
  reason?: string
  /** Shown highlighted in the preview: the suggestion is a guess. */
  needsAttention: boolean
  /** Cash deposits wait for the user to pick where the cash came from. */
  waitsForCashSource: boolean
}

export const REASONS = {
  notCompleted: 'Not completed at the bank',
  duplicate: 'Already imported',
  cashSource: 'Pick where the cash came from to include this',
  unnamedTransfer: 'No recipient shown — include it if it was a payment, not a move between your own cards',
  uncategorised: 'The bank gave no useful category — pick one',
} as const

/** Cleans whitespace the bank pads cells with (tabs, newlines, NBSP). */
function clean(s: string | undefined): string {
  return (s ?? '').replace(/[\t ]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** "Получатель:\n Name\t" → "Name". */
function partyName(s: string | undefined): string {
  const c = clean(s)
  const i = c.indexOf(':')
  return clean(i >= 0 ? c.slice(i + 1) : c)
}

/** FNV-1a, 64-bit, over UTF-8 — implemented identically in Swift. */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte)
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** Finds the header row and turns every data row into a StatementRow. */
export function parseStatement(rows: string[][]): StatementRow[] {
  const headerIndex = rows.findIndex((r) => r.some((c) => clean(c) === HEADERS.amount))
  if (headerIndex < 0) throw new StatementFormatError('This doesn’t look like a bank statement: no “Сумма платежа” column.')
  const header = rows[headerIndex].map(clean)
  const col = (name: string) => header.indexOf(name)
  const need = [HEADERS.date, HEADERS.time, HEADERS.operation, HEADERS.merchant, HEADERS.amount, HEADERS.category]
  const missing = need.filter((h) => col(h) < 0)
  if (missing.length) throw new StatementFormatError(`The statement is missing columns: ${missing.join(', ')}.`)

  const out: StatementRow[] = []
  rows.slice(headerIndex + 1).forEach((r, i) => {
    const get = (name: string) => (col(name) >= 0 ? r[col(name)] : '')
    const dateText = clean(get(HEADERS.date)), timeText = clean(get(HEADERS.time)) || '00:00:00'
    const dm = /^(\d{2})[-.](\d{2})[-.](\d{4})$/.exec(dateText)
    const tm = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(timeText)
    const amount = Number(clean(get(HEADERS.amount)).replace(/\s/g, '').replace(',', '.'))
    if (!dm || !tm || !Number.isFinite(amount) || amount <= 0) return // totals, blanks, footers
    const local = new Date(Number(dm[3]), Number(dm[2]) - 1, Number(dm[1]), Number(tm[1]), Number(tm[2]), Number(tm[3] ?? 0))
    const operation = clean(get(HEADERS.operation))
    const merchant = clean(get(HEADERS.merchant))
    const card = clean(get(HEADERS.card))
    const terminal = clean(get(HEADERS.terminal))
    const localDate = `${dateText} ${tm[1]}:${tm[2]}:${tm[3] ?? '00'}`
    out.push({
      line: headerIndex + 2 + i,
      localDate,
      date: toISO(local),
      credit: operation.toLowerCase().startsWith('поступ'),
      merchant,
      organization: clean(get(HEADERS.organization)),
      amount,
      bankCategory: clean(get(HEADERS.category)).toLowerCase(),
      party: partyName(get(HEADERS.party)),
      status: clean(get(HEADERS.status)),
      cardLast4: /(\d{4})$/.exec(card)?.[1] ?? '',
      importID: fnv1a64([localDate, operation, String(amount), merchant, terminal, card].join('|')),
    })
  })
  return out
}

/** Known merchants: checked before the bank's category, first match wins. */
export const MERCHANT_RULES: { match: string[]; category: Category; title: string }[] = [
  { match: ['YANDEX EATS', 'YANDEXGO EATS'], category: 'foodDelivery', title: 'Yandex Eats' },
  { match: ['YANDEXGO', 'YANDEX GO'], category: 'taxi', title: 'Yandex Go' },
  { match: ['KORZINKA', 'ANGLESEY'], category: 'groceries', title: 'Korzinka' },
  { match: ['ATTO TOLOV'], category: 'transport', title: 'Metro & bus' },
  { match: ['PAYME PLUS'], category: 'subscriptions', title: 'Payme Plus' },
  { match: ['BEST COFFEE'], category: 'eatingOut', title: 'Best Coffee' },
  { match: ['EMPIRE GAMING'], category: 'gaming', title: 'Empire Gaming' },
]

/** The bank's own categories (lowercased) → Fintrack categories. */
export const BANK_CATEGORIES: Record<string, Category> = {
  'общепит': 'eatingOut',
  'кафе и рестораны': 'eatingOut',
  'такси': 'taxi',
  'продукты': 'groceries',
  'супермаркеты': 'groceries',
  'транспорт': 'transport',
  'магазин': 'shopping',
  'одежда': 'shopping',
  'для дома': 'household',
  'игры': 'gaming',
  'развлечения': 'entertainment',
  'услуги': 'subscriptions',
  'связь': 'utilities',
  'коммунальные услуги': 'utilities',
  'здоровье': 'health',
  'аптеки': 'health',
  'образование': 'education',
  'путешествия': 'travel',
}

const LEGAL_TOKENS = new Set(['OOO', 'ООО', 'LLC', 'MCHJ', 'XK', 'YATT', 'YTT', 'IP', 'ИП', 'ЧП', 'АО', 'AO', 'UB', 'XK.'])

/** "OOO INTERNATIONAL FOODCHAIN" → "International Foodchain". */
export function cleanMerchantName(raw: string): string {
  const words = raw
    .replace(/[«»"'“”]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !LEGAL_TOKENS.has(w.toUpperCase()))
  if (words.length === 0) return clean(raw)
  return words
    .map((w) => (/\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

function merchantRule(row: StatementRow) {
  const hay = `${row.merchant} ${row.organization}`.toUpperCase()
  return MERCHANT_RULES.find((r) => r.match.some((m) => hay.includes(m)))
}

export interface SuggestOptions {
  /** importIDs already in the user's data. */
  existingImportIDs: Set<string>
  /** True when the user has picked an account cash deposits come from. */
  hasCashSource: boolean
}

/** One suggestion per row, in file order. */
export function suggest(rows: StatementRow[], opts: SuggestOptions): ImportDraft[] {
  return rows.map((row) => {
    const base = { row, needsAttention: false, waitsForCashSource: false }
    let draft: ImportDraft

    if (row.credit) {
      if (row.bankCategory === 'наличные') {
        draft = { ...base, kind: 'transfer', category: 'transfer', title: 'Cash deposit', include: opts.hasCashSource,
          waitsForCashSource: true, needsAttention: !opts.hasCashSource, reason: opts.hasCashSource ? undefined : REASONS.cashSource }
      } else if (row.bankCategory === 'перевод') {
        draft = { ...base, kind: 'income', category: 'other', title: row.party || 'Card transfer in', include: true }
      } else {
        draft = { ...base, kind: 'income', category: row.bankCategory.includes('зарплат') ? 'salary' : 'other',
          title: cleanMerchantName(row.merchant), include: true }
      }
    } else if (row.bankCategory === 'перевод') {
      draft = row.party
        ? { ...base, kind: 'expense', category: 'sentToPeople', title: row.party, include: true }
        : { ...base, kind: 'expense', category: 'sentToPeople', title: 'Card transfer out', include: false,
            needsAttention: true, reason: REASONS.unnamedTransfer }
    } else {
      const rule = merchantRule(row)
      const category = rule?.category ?? BANK_CATEGORIES[row.bankCategory] ?? 'other'
      draft = { ...base, kind: 'expense', category, title: rule?.title ?? cleanMerchantName(row.merchant), include: true,
        needsAttention: category === 'other', reason: category === 'other' ? REASONS.uncategorised : undefined }
    }

    // Hard stops come last so they win over every suggestion above.
    if (row.status && row.status.toLowerCase() !== 'оплачен') {
      return { ...draft, include: false, needsAttention: false, waitsForCashSource: false, reason: REASONS.notCompleted }
    }
    if (opts.existingImportIDs.has(row.importID)) {
      return { ...draft, include: false, needsAttention: false, waitsForCashSource: false, reason: REASONS.duplicate }
    }
    return draft
  })
}

export interface BuildOptions {
  /** The card's account in Fintrack (required). */
  accountID: string
  /** Where cash deposits come from; deposits are skipped without it. */
  cashSourceID?: string
}

/** Included drafts → transactions ready for the store. */
export function buildTransactions(drafts: ImportDraft[], opts: BuildOptions): Transaction[] {
  const out: Transaction[] = []
  for (const d of drafts) {
    if (!d.include) continue
    const base = { id: newID(), title: d.title, amount: d.row.amount, currency: 'UZS' as const, date: d.row.date, note: '', importID: d.row.importID }
    if (d.kind === 'transfer') {
      if (!opts.cashSourceID) continue
      out.push({ ...base, kind: 'transfer', category: 'transfer', fromAccountID: opts.cashSourceID, toAccountID: opts.accountID })
    } else {
      out.push({ ...base, kind: d.kind, category: d.category, accountID: opts.accountID })
    }
  }
  return out
}
