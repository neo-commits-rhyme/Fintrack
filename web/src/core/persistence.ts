import { CURRENCIES, defaultRates, isCurrencyCode, type CurrencyCode, type Rates } from './currency'
import { isCategory, type Category } from './category'
import { newID, type Account, type AppData, type Budget, type Goal, type Transaction } from './models'
import { sortAccounts, sortTransactions } from './analytics'

export const STORAGE_KEY = 'fintrack.data'

export function emptyData(): AppData {
  return {
    transactions: [],
    budgets: [],
    goals: [],
    accounts: [],
    displayCurrency: 'UZS',
    rates: { ...defaultRates },
  }
}

export class DataFormatError extends Error {}

type Json = Record<string, unknown>

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** Swift's .iso8601 reads only "YYYY-MM-DDTHH:MM:SSZ"; normalise anything parseable to that. */
function normaliseDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseAccount(v: unknown, fallbackCurrency: CurrencyCode): Account | null {
  if (typeof v === 'string') {
    // Interim layout: accounts were plain name strings.
    return { id: newID(), name: v, icon: 'credit-card', currency: fallbackCurrency, openingBalance: 0, kind: 'regular', includeInTotal: true }
  }
  if (!isObj(v) || typeof v.name !== 'string' || !isCurrencyCode(v.currency)) return null
  return {
    id: str(v.id, newID()),
    name: v.name,
    icon: str(v.icon, 'credit-card'),
    currency: v.currency,
    openingBalance: num(v.openingBalance),
    kind: v.kind === 'debt' ? 'debt' : 'regular',
    includeInTotal: typeof v.includeInTotal === 'boolean' ? v.includeInTotal : true,
  }
}

function parseTransaction(v: unknown): Transaction | null {
  if (!isObj(v)) return null
  const date = normaliseDate(v.date)
  if (typeof v.title !== 'string' || !isCurrencyCode(v.currency) || !isCategory(v.category) || !date) return null
  const kind = v.kind
  if (kind !== 'income' && kind !== 'expense' && kind !== 'transfer') return null
  // A missing or non-finite amount drops the row, like the Mac decoder: one bad number must not poison every total.
  if (typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return null
  const t: Transaction = {
    id: str(v.id, newID()),
    title: v.title,
    amount: v.amount,
    currency: v.currency,
    category: v.category as Category,
    kind,
    date,
    note: str(v.note),
  }
  if (typeof v.accountID === 'string') t.accountID = v.accountID
  if (typeof v.fromAccountID === 'string') t.fromAccountID = v.fromAccountID
  if (typeof v.toAccountID === 'string') t.toAccountID = v.toAccountID
  if (typeof v.fromAccount === 'string') t.fromAccount = v.fromAccount
  if (typeof v.toAccount === 'string') t.toAccount = v.toAccount
  if (typeof v.toAmount === 'number' && Number.isFinite(v.toAmount) && v.toAmount > 0 && isCurrencyCode(v.toCurrency)) {
    t.toAmount = v.toAmount
    t.toCurrency = v.toCurrency
  }
  return t
}

function parseBudget(v: unknown): Budget | null {
  if (!isObj(v) || !isCategory(v.category) || !isCurrencyCode(v.currency)) return null
  if (typeof v.limit !== 'number' || !Number.isFinite(v.limit)) return null
  return { id: str(v.id, newID()), category: v.category as Category, limit: v.limit, currency: v.currency }
}

function parseGoal(v: unknown): Goal | null {
  if (!isObj(v) || typeof v.name !== 'string' || !isCurrencyCode(v.currency)) return null
  if (typeof v.target !== 'number' || !Number.isFinite(v.target)) return null
  const saved = v.saved === undefined ? 0 : v.saved
  if (typeof saved !== 'number' || !Number.isFinite(saved)) return null
  const g: Goal = {
    id: str(v.id, newID()),
    name: v.name,
    icon: str(v.icon, 'star'),
    target: v.target,
    saved,
    currency: v.currency,
  }
  const deadline = normaliseDate(v.deadline)
  if (deadline) g.deadline = deadline
  return g
}

/** Rates arrive either as {"USD": 12110} or, in the oldest files, as a flat ["USD", 12110, ...] array. */
function parseRates(v: unknown): Rates {
  const loaded: Partial<Rates> = {}
  if (isObj(v)) {
    for (const [k, val] of Object.entries(v)) if (isCurrencyCode(k)) loaded[k] = num(val)
  } else if (Array.isArray(v)) {
    for (let i = 0; i + 1 < v.length; i += 2) {
      const k = v[i], val = v[i + 1]
      if (isCurrencyCode(k)) loaded[k] = num(val)
    }
  }
  const rates = { ...defaultRates }
  // Fill gaps and drop invalid (zero/negative) saved rates.
  for (const code of CURRENCIES) {
    const value = loaded[code] ?? 0
    if (value > 0) rates[code] = value
  }
  rates.UZS = 1
  return rates
}

/** Decode any Fintrack file layout into AppData. Throws DataFormatError when the JSON is not a Fintrack file. */
export function parseAppData(json: unknown): AppData {
  if (!isObj(json) || !Array.isArray(json.transactions)) throw new DataFormatError('Not a Fintrack data file.')
  const displayCurrency: CurrencyCode = isCurrencyCode(json.displayCurrency) ? json.displayCurrency : 'UZS'
  const accounts = (Array.isArray(json.accounts) ? json.accounts : [])
    .map((a) => parseAccount(a, displayCurrency))
    .filter((a): a is Account => a !== null)
  const transactions = json.transactions.map(parseTransaction).filter((t): t is Transaction => t !== null)
  const budgets = (Array.isArray(json.budgets) ? json.budgets : []).map(parseBudget).filter((b): b is Budget => b !== null)
  const goals = (Array.isArray(json.goals) ? json.goals : []).map(parseGoal).filter((g): g is Goal => g !== null)

  const data: AppData = {
    transactions: sortTransactions(transactions),
    budgets,
    goals,
    accounts,
    displayCurrency,
    rates: parseRates(json.rates),
  }
  // Name-based transfer endpoints only exist in pre-account files; the current layout keeps names
  // purely for readability, so a deleted account must not be resurrected from them.
  const legacyLayout = !Array.isArray(json.accounts) || json.accounts.some((a) => typeof a === "string")
  if (legacyLayout) migrateTransferAccountNames(data)
  data.accounts = sortAccounts(data.accounts)
  return data
}

/** Pre-account files stored transfer endpoints as free-text names: resolve to accounts (creating them) and link by ID. */
function migrateTransferAccountNames(data: AppData) {
  const findOrCreate = (name: string): Account => {
    const existing = data.accounts.find((a) => a.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)
    if (existing) return existing
    const account: Account = { id: newID(), name, icon: 'credit-card', currency: data.displayCurrency, openingBalance: 0, kind: 'regular', includeInTotal: true }
    data.accounts.push(account)
    return account
  }
  for (const t of data.transactions) {
    if (t.kind !== 'transfer') continue
    if (!t.fromAccountID && t.fromAccount) t.fromAccountID = findOrCreate(t.fromAccount).id
    if (!t.toAccountID && t.toAccount) t.toAccountID = findOrCreate(t.toAccount).id
  }
}

/** Pretty JSON with sorted keys, like the Mac app writes. */
export function serializeAppData(data: AppData): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (isObj(v)) {
      return Object.keys(v).sort().reduce<Json>((acc, k) => {
        if (v[k] !== undefined) acc[k] = sortKeys(v[k])
        return acc
      }, {})
    }
    return v
  }
  return JSON.stringify(sortKeys(data), null, 2)
}

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function loadFromStorage(storage: Storage): { data: AppData; error?: string } {
  let raw: string | null = null
  try { raw = storage.getItem(STORAGE_KEY) } catch { /* private mode */ }
  if (!raw) return { data: emptyData() }
  try {
    return { data: parseAppData(JSON.parse(raw)) }
  } catch (e) {
    // Never overwrite an unreadable store — park it next to the key so it stays recoverable.
    try { storage.setItem(`${STORAGE_KEY}.unreadable.${Date.now()}`, raw) } catch { /* ignore */ }
    return { data: emptyData(), error: e instanceof Error ? e.message : 'Stored data could not be read.' }
  }
}

export function saveToStorage(storage: Storage, data: AppData): string | null {
  try {
    storage.setItem(STORAGE_KEY, serializeAppData(data))
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Could not save.'
  }
}
