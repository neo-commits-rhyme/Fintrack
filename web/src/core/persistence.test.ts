import { describe, expect, it, vi } from 'vitest'
import {
  DataFormatError, STORAGE_KEY, emptyData, loadFromStorage, parseAppData, saveToStorage, serializeAppData, type Storage,
} from './persistence'
import { balanceOf, headlineBalance, sortAccounts, sortTransactions } from './analytics'
import { CURRENCIES, defaultRates } from './currency'
import { newID, type Account, type AppData, type Transaction } from './models'

// ---- fixtures ---------------------------------------------------------------------------------

/** A dataset that exercises every field, every optional, debt, excluded accounts, legacy names. */
function richData(): AppData {
  const cash: Account = { id: newID(), name: 'Cash', icon: 'banknote', currency: 'UZS', openingBalance: 400_000, kind: 'regular', includeInTotal: true }
  const loan: Account = { id: newID(), name: 'Loan', icon: 'lock', currency: 'USD', openingBalance: -1_000, kind: 'debt', includeInTotal: false }
  const visa: Account = { id: newID(), name: 'visa', icon: 'credit-card', currency: 'USD', openingBalance: 12.34, kind: 'regular', includeInTotal: true }
  const transactions: Transaction[] = [
    { id: newID(), title: 'Salary', amount: 14_500_000, currency: 'UZS', category: 'salary', kind: 'income', date: '2026-11-01T09:00:00Z', note: 'Nov', accountID: cash.id },
    { id: newID(), title: 'Pay loan', amount: 12.34, currency: 'USD', category: 'debtPayment', kind: 'transfer', date: '2026-10-31T09:00:00Z', note: '', fromAccountID: cash.id, toAccountID: loan.id, fromAccount: 'Cash', toAccount: 'Loan' },
    { id: newID(), title: 'Coffee “Ozbek” ☕️ — ok', amount: 30_000.5, currency: 'UZS', category: 'eatingOut', kind: 'expense', date: '2026-10-30T23:59:59Z', note: 'multi\nline "quoted"' },
    { id: newID(), title: 'Loan in', amount: 500, currency: 'USD', category: 'loanReceived', kind: 'transfer', date: '2026-10-01T00:00:00Z', note: '', fromAccountID: loan.id, toAccountID: visa.id },
  ]
  return {
    transactions: sortTransactions(transactions),
    budgets: [
      { id: newID(), category: 'groceries', limit: 3_500_000, currency: 'UZS' },
      { id: newID(), category: 'subscriptions', limit: 25.5, currency: 'USD' },
    ],
    goals: [
      { id: newID(), name: 'Mac', icon: 'laptop', target: 2_400, saved: 1_150.5, currency: 'USD', deadline: '2026-12-01T09:00:00Z' },
      { id: newID(), name: 'Camera', icon: 'camera', target: 1_100, saved: 1_100, currency: 'EUR' },
    ],
    accounts: sortAccounts([visa, loan, cash]),
    displayCurrency: 'EUR',
    rates: { ...defaultRates, USD: 12_345.67, KZT: 24.1 },
  }
}

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const storage: Storage = {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v) },
  }
  return { storage, map }
}

const reload = (d: AppData) => parseAppData(JSON.parse(serializeAppData(d)))

function expectSortedKeysDeep(v: unknown, path = '$'): void {
  if (Array.isArray(v)) { v.forEach((x, i) => expectSortedKeysDeep(x, `${path}[${i}]`)); return }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v)
    expect(keys, path).toEqual([...keys].sort())
    for (const k of keys) expectSortedKeysDeep((v as Record<string, unknown>)[k], `${path}.${k}`)
  }
}

// ---- round trip & shape -----------------------------------------------------------------------

describe('serialize / parse round trip (PersistenceTests.everyEntityRoundTrips)', () => {
  it('parseAppData(serializeAppData(x)) deep-equals x for a rich dataset', () => {
    const d = richData()
    expect(reload(d)).toStrictEqual(d)
  })

  it('round trip is stable (serialize → parse → serialize is byte-identical)', () => {
    const text = serializeAppData(richData())
    expect(serializeAppData(parseAppData(JSON.parse(text)))).toBe(text)
  })

  it('empty data round-trips', () => {
    expect(reload(emptyData())).toStrictEqual(emptyData())
  })

  it('balances survive the round trip', () => {
    const d = richData()
    const r = reload(d)
    for (const a of d.accounts) expect(balanceOf(r, r.accounts.find((x) => x.id === a.id)!)).toBe(balanceOf(d, a))
    expect(headlineBalance(r)).toBe(headlineBalance(d))
  })
})

describe('serializeAppData JSON shape (PersistenceTests.jsonShape)', () => {
  it('sorted keys at every level, 2-space indent', () => {
    const text = serializeAppData(richData())
    expectSortedKeysDeep(JSON.parse(text))
    expect(text.startsWith('{\n  "accounts": [\n    {\n      "currency": ')).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual(['accounts', 'budgets', 'displayCurrency', 'goals', 'rates', 'transactions'])
    expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2))
  })

  it('rates are a string-keyed object with every currency', () => {
    const obj = JSON.parse(serializeAppData(emptyData()))
    expect(Array.isArray(obj.rates)).toBe(false)
    expect(typeof obj.rates).toBe('object')
    expect(new Set(Object.keys(obj.rates))).toEqual(new Set(CURRENCIES))
    expect(obj.rates.USD).toBe(12_110)
    expect(obj.rates.UZS).toBe(1)
    expect(obj.displayCurrency).toBe('UZS')
    for (const k of ['accounts', 'budgets', 'goals', 'transactions']) expect(Array.isArray(obj[k])).toBe(true)
  })

  it('omits undefined keys', () => {
    const d = emptyData()
    d.transactions.push({ id: newID(), title: 't', amount: 1, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2026-11-01T09:00:00Z', note: '', accountID: undefined, fromAccountID: undefined })
    d.goals.push({ id: newID(), name: 'g', icon: 'star', target: 1, saved: 0, currency: 'USD', deadline: undefined })
    const text = serializeAppData(d)
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('accountID')
    expect(text).not.toContain('fromAccountID')
    expect(text).not.toContain('deadline')
    const back = parseAppData(JSON.parse(text))
    expect('accountID' in back.transactions[0]).toBe(false)
    expect('deadline' in back.goals[0]).toBe(false)
  })

  it('dates are written as "YYYY-MM-DDTHH:MM:SSZ" with no milliseconds', () => {
    const obj = JSON.parse(serializeAppData(richData()))
    expect(obj.transactions.map((t: Transaction) => t.date)).toContain('2026-11-01T09:00:00Z')
    for (const t of obj.transactions) expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(obj.goals[0].deadline).toBe('2026-12-01T09:00:00Z')
  })

  it('parse normalises other parseable date forms to the Mac format', () => {
    const r = parseAppData({
      transactions: [{ title: 'a', amount: 1, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2026-11-01T09:00:00.750Z', note: '' },
        { title: 'b', amount: 1, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2026-11-01T14:00:00+05:00', note: '' }],
      goals: [{ name: 'g', target: 1, currency: 'USD', deadline: '2026-12-01T00:00:00.000Z' }],
      accounts: [],
    })
    expect(r.transactions.map((t) => t.date)).toEqual(['2026-11-01T09:00:00Z', '2026-11-01T09:00:00Z'])
    expect(r.goals[0].deadline).toBe('2026-12-01T00:00:00Z')
  })
})

// ---- legacy layouts ---------------------------------------------------------------------------

describe('legacy layouts', () => {
  it('(1) rates as a flat ["USD", 12110, "UZS", 1] array', () => {
    const r = parseAppData({ transactions: [], rates: ['USD', 12_110, 'UZS', 1] })
    expect(r.rates).toEqual(defaultRates)
  })

  it('(1) flat-array rates with invalid entries, newest-first ordering, defaults (legacyEnumKeyedRatesFlatArray)', () => {
    const r = parseAppData(JSON.parse(`{
      "transactions": [
        {"id": "11111111-1111-1111-1111-111111111111", "title": "Coffee", "amount": 30000,
         "currency": "UZS", "category": "eatingOut", "kind": "expense", "date": "2025-01-10T09:00:00Z", "note": ""},
        {"id": "22222222-2222-2222-2222-222222222222", "title": "Salary", "amount": 1000,
         "currency": "USD", "category": "salary", "kind": "income", "date": "2025-01-11T09:00:00Z", "note": "Jan"}
      ],
      "budgets": [{"id": "33333333-3333-3333-3333-333333333333", "category": "groceries", "limit": 100, "currency": "UZS"}],
      "goals": [{"id": "44444444-4444-4444-4444-444444444444", "name": "Car", "icon": "car", "target": 5000, "saved": 10, "currency": "USD"}],
      "displayCurrency": "USD",
      "rates": ["USD", 12000, "UZS", 1, "EUR", 0, "RUB", -3]
    }`))
    expect(r.transactions.map((t) => t.title)).toEqual(['Salary', 'Coffee'])
    expect(r.transactions[0].id).toBe('22222222-2222-2222-2222-222222222222')
    expect(r.budgets).toHaveLength(1)
    expect(r.goals[0].name).toBe('Car')
    expect(r.goals[0].deadline).toBeUndefined()
    expect(r.displayCurrency).toBe('USD')
    expect(r.accounts).toEqual([])
    expect(r.rates.USD).toBe(12_000)
    expect(r.rates.EUR).toBe(defaultRates.EUR)
    expect(r.rates.RUB).toBe(defaultRates.RUB)
    expect(r.rates.JPY).toBe(defaultRates.JPY)
    expect(r.rates.UZS).toBe(1)
    // Next save is in the current string-keyed layout.
    expect(Array.isArray(JSON.parse(serializeAppData(r)).rates)).toBe(false)
  })

  it('(2) accounts as plain strings (legacyAccountsAsPlainStrings)', () => {
    const r = parseAppData({
      transactions: [], budgets: [], goals: [], displayCurrency: 'RUB',
      rates: { USD: 12_500, RUB: 150 }, accounts: ['Humo card', 'Cash'],
    })
    expect(r.accounts.map((a) => a.name)).toEqual(['Cash', 'Humo card'])
    for (const a of r.accounts) {
      expect(a).toMatchObject({ currency: 'RUB', openingBalance: 0, kind: 'regular', includeInTotal: true, icon: 'credit-card' })
      expect(a.id).toMatch(/^[0-9A-F-]{36}$/)
    }
    expect(r.rates.USD).toBe(12_500)
    expect(r.rates.RUB).toBe(150)
    expect(r.rates.EUR).toBe(defaultRates.EUR)
  })

  it('(2) string accounts + name-only transfers: names reuse existing accounts case-insensitively and link by ID', () => {
    const r = parseAppData({
      transactions: [{ id: '11111111-1111-1111-1111-111111111111', title: 'Top-up', amount: 50_000, currency: 'UZS', category: 'transfer', kind: 'transfer', date: '2025-01-10T09:00:00Z', note: '', fromAccount: 'CASH', toAccount: 'Savings' }],
      budgets: [], goals: [], displayCurrency: 'UZS', rates: { USD: 12_110 }, accounts: ['Cash'],
    })
    expect(r.accounts.map((a) => a.name)).toEqual(['Cash', 'Savings'])
    expect(r.transactions[0].fromAccountID).toBe(r.accounts[0].id)
    expect(r.transactions[0].toAccountID).toBe(r.accounts[1].id)
  })

  it('(3) no accounts key: transfer names create accounts and link them (legacyTransferNamesCreateAndLinkAccounts)', () => {
    const r = parseAppData(JSON.parse(`{
      "transactions": [
        {"id": "11111111-1111-1111-1111-111111111111", "title": "Top-up", "amount": 50000, "currency": "UZS", "category": "transfer",
         "kind": "transfer", "date": "2025-01-10T09:00:00Z", "note": "", "fromAccount": "Cash", "toAccount": "Humo card"},
        {"id": "22222222-2222-2222-2222-222222222222", "title": "Back", "amount": 10000, "currency": "UZS", "category": "transfer",
         "kind": "transfer", "date": "2025-01-11T09:00:00Z", "note": "", "fromAccount": "humo CARD", "toAccount": "cash"},
        {"id": "33333333-3333-3333-3333-333333333333", "title": "Visa", "amount": 5, "currency": "USD", "category": "transfer",
         "kind": "transfer", "date": "2025-01-12T09:00:00Z", "note": "", "fromAccount": "Cash", "toAccount": "Visa"},
        {"id": "44444444-4444-4444-4444-444444444444", "title": "Unnamed", "amount": 1, "currency": "UZS", "category": "transfer",
         "kind": "transfer", "date": "2025-01-13T09:00:00Z", "note": "", "fromAccount": "", "toAccount": null}
      ],
      "budgets": [], "goals": [], "displayCurrency": "UZS", "rates": ["USD", 12110]
    }`))
    expect(r.accounts.map((a) => a.name.toLowerCase())).toEqual(['cash', 'humo card', 'visa'])
    for (const a of r.accounts) expect(a).toMatchObject({ currency: 'UZS', openingBalance: 0 })
    const byName = Object.fromEntries(r.accounts.map((a) => [a.name.toLowerCase(), a.id]))
    const find = (title: string) => r.transactions.find((t) => t.title === title)!
    expect([find('Top-up').fromAccountID, find('Top-up').toAccountID]).toEqual([byName.cash, byName['humo card']])
    expect([find('Back').fromAccountID, find('Back').toAccountID]).toEqual([byName['humo card'], byName.cash])
    expect(find('Unnamed').fromAccountID).toBeUndefined()
    expect(find('Unnamed').toAccountID).toBeUndefined()
    const cash = r.accounts.find((a) => a.id === byName.cash)!
    expect(balanceOf(r, cash)).toBe(-50_000 + 10_000 - 5 * 12_110)
    expect(Math.abs(headlineBalance(r))).toBeLessThan(1e-6) // own-account transfers are net zero
  })

  it('(3) no accounts key and no transfers → no accounts', () => {
    const r = parseAppData({ transactions: [{ title: 'x', amount: 1, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2025-01-10T09:00:00Z' }] })
    expect(r.accounts).toEqual([])
    expect(r.transactions[0].note).toBe('')
    expect(r.budgets).toEqual([])
    expect(r.goals).toEqual([])
    expect(r.displayCurrency).toBe('UZS')
  })

  it('current layout: a transfer with names but no IDs must NOT resurrect a deleted account', () => {
    const card: Account = { id: newID(), name: 'Card', icon: 'credit-card', currency: 'UZS', openingBalance: 0, kind: 'regular', includeInTotal: true }
    const d = emptyData()
    d.accounts.push(card)
    // How the store leaves a transfer after deleting "Cash": fromAccountID cleared, readable names kept.
    d.transactions.push({ id: newID(), title: 'Top-up', amount: 50, currency: 'UZS', category: 'transfer', kind: 'transfer', date: '2026-11-01T09:00:00Z', note: '', toAccountID: card.id, fromAccount: 'Cash', toAccount: 'Card' })
    const r = reload(d)
    expect(r.accounts.map((a) => a.name)).toEqual(['Card'])
    expect(r.transactions[0].fromAccountID).toBeUndefined()
    expect(r.transactions[0].toAccountID).toBe(card.id)
    expect(r.transactions[0].fromAccount).toBe('Cash')
  })

  it('current layout with an empty accounts array does not create accounts either', () => {
    const r = parseAppData({ transactions: [{ title: 'T', amount: 1, currency: 'UZS', category: 'transfer', kind: 'transfer', date: '2026-11-01T09:00:00Z', fromAccount: 'Ghost', toAccount: 'Other' }], accounts: [] })
    expect(r.accounts).toEqual([])
    expect(r.transactions[0].fromAccountID).toBeUndefined()
  })

  it('accounts without newer fields decode with defaults', () => {
    const r = parseAppData({ transactions: [], accounts: [{ id: '55555555-5555-5555-5555-555555555555', name: 'Old', currency: 'USD' }] })
    expect(r.accounts).toEqual([{ id: '55555555-5555-5555-5555-555555555555', name: 'Old', icon: 'credit-card', currency: 'USD', openingBalance: 0, kind: 'regular', includeInTotal: true }])
  })
})

// ---- validation -------------------------------------------------------------------------------

describe('rates validation', () => {
  it('invalid rates fall back to defaults, unknown keys ignored, UZS always 1 (invalidRatesInCurrentLayoutFallBackToDefaults)', () => {
    const r = parseAppData(JSON.parse('{"transactions": [], "budgets": [], "goals": [], "accounts": [], "displayCurrency": "UZS", "rates": {"USD": 0, "EUR": -14150, "GBP": 17000, "UZS": 7, "XXX": 5}}'))
    expect(r.rates).toEqual({ ...defaultRates, GBP: 17_000 })
    expect(Object.keys(r.rates)).toHaveLength(CURRENCIES.length)
    expect('XXX' in r.rates).toBe(false)
  })

  it('NaN, Infinity, strings, null and missing rates fall back to defaults', () => {
    const r = parseAppData({ transactions: [], rates: { USD: NaN, EUR: Infinity, GBP: '16000', RUB: null, UZS: 0 } })
    expect(r.rates).toEqual(defaultRates)
    expect(parseAppData({ transactions: [] }).rates).toEqual(defaultRates)
    expect(parseAppData({ transactions: [], rates: 'nope' }).rates).toEqual(defaultRates)
    expect(parseAppData({ transactions: [], rates: ['USD'] }).rates).toEqual(defaultRates)
    expect(parseAppData({ transactions: [], rates: ['UZS', 5, 'USD', -1, 12, 'EUR'] }).rates).toEqual(defaultRates)
  })

  it('returns a fresh rates object (defaults are never aliased)', () => {
    const r = parseAppData({ transactions: [] })
    r.rates.USD = 1
    expect(defaultRates.USD).toBe(12_110)
    expect(emptyData().rates).not.toBe(emptyData().rates)
  })
})

describe('bad rows are skipped, the rest loads', () => {
  const good = { id: 'GOOD', title: 'Good', amount: 1_000, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2026-11-01T09:00:00Z', note: '' }

  it('unknown currency / category / kind, bad or missing date, missing title, non-object rows', () => {
    const r = parseAppData({
      transactions: [
        good,
        { ...good, id: 'B1', currency: 'XXX' },
        { ...good, id: 'B2', category: 'nope' },
        { ...good, id: 'B3', kind: 'refund' },
        { ...good, id: 'B4', date: 'not a date' },
        { ...good, id: 'B5', date: undefined },
        { ...good, id: 'B6', date: 12345 },
        { ...good, id: 'B7', title: undefined },
        null, 'row', 42, [],
      ],
      budgets: [{ category: 'groceries', limit: 1, currency: 'UZS' }, { category: 'nope', limit: 1, currency: 'UZS' }, { category: 'groceries', limit: 1, currency: 'XXX' }],
      goals: [{ name: 'G', target: 1, currency: 'USD' }, { target: 1, currency: 'USD' }, { name: 'G2', target: 1, currency: 'ABC' }],
      accounts: [{ name: 'A', currency: 'UZS' }, { name: 'B', currency: 'XXX' }, { currency: 'UZS' }, 7],
    })
    expect(r.transactions.map((t) => t.id)).toEqual(['GOOD'])
    expect(r.budgets).toHaveLength(1)
    expect(r.goals.map((g) => g.name)).toEqual(['G'])
    expect(r.accounts.map((a) => a.name)).toEqual(['A'])
    expect(r.goals[0].icon).toBe('star')
  })

  it('a bad goal deadline is dropped but the goal is kept', () => {
    const r = parseAppData({ transactions: [], goals: [{ name: 'G', target: 1, currency: 'USD', deadline: 'whenever' }] })
    expect(r.goals).toHaveLength(1)
    expect('deadline' in r.goals[0]).toBe(false)
  })

  // BUG: persistence.ts:61 (`amount: num(v.amount)`) turns a non-finite or missing amount into 0
  // and KEEPS the row, so a corrupt row silently becomes a 0-amount transaction. The Mac app
  // (Models.swift Transaction.init(from:)) requires `amount` and rejects non-finite values, and its
  // Lossy decoder drops just that row. Same for Budget.limit (persistence.ts:78) and Goal.target /
  // saved (persistence.ts:87-88). Fix: in parseTransaction
  // `if (typeof v.amount !== 'number' || !Number.isFinite(v.amount)) return null`, and likewise for
  // budget limit and goal target (saved may default to 0 when absent, but must be finite when present).
  it('a non-finite or missing amount skips the row (parity with the Mac decoder)', () => {
    const r = parseAppData(JSON.parse(`{"transactions": [
      ${JSON.stringify(good)},
      {"id": "INF", "title": "x", "amount": 1e999, "currency": "UZS", "category": "groceries", "kind": "expense", "date": "2026-11-01T09:00:00Z"},
      {"id": "STR", "title": "x", "amount": "abc", "currency": "UZS", "category": "groceries", "kind": "expense", "date": "2026-11-01T09:00:00Z"},
      {"id": "MISSING", "title": "x", "currency": "UZS", "category": "groceries", "kind": "expense", "date": "2026-11-01T09:00:00Z"}
    ], "budgets": [{"category": "groceries", "limit": 1e999, "currency": "UZS"}],
       "goals": [{"name": "G", "target": -1e999, "currency": "USD"}]}`))
    expect(r.transactions.map((t) => t.id)).toEqual(['GOOD'])
    expect(r.budgets).toEqual([])
    expect(r.goals).toEqual([])
    const viaObject = parseAppData({ transactions: [good, { ...good, id: 'NAN', amount: NaN }] })
    expect(viaObject.transactions.map((t) => t.id)).toEqual(['GOOD'])
  })

  it('unknown displayCurrency falls back to UZS', () => {
    expect(parseAppData({ transactions: [], displayCurrency: 'XYZ' }).displayCurrency).toBe('UZS')
  })
})

describe('non-Fintrack JSON', () => {
  it.each([
    ['null', null], ['array', []], ['number', 42], ['string', 'hi'], ['empty object', {}],
    ['transactions not an array', { transactions: 'nope', displayCurrency: 'XYZ' }],
    ['other app', { users: [], version: 2 }],
  ])('%s throws DataFormatError', (_label, json) => {
    expect(() => parseAppData(json)).toThrow(DataFormatError)
  })

  it('DataFormatError is an Error with a message', () => {
    try { parseAppData({}); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(Error)
      expect((e as Error).message).toBe('Not a Fintrack data file.')
    }
  })
})

// ---- storage ----------------------------------------------------------------------------------

describe('loadFromStorage / saveToStorage', () => {
  it('empty storage → emptyData, no error, nothing written', () => {
    const { storage, map } = memoryStorage()
    const res = loadFromStorage(storage)
    expect(res).toEqual({ data: emptyData() })
    expect(res.error).toBeUndefined()
    expect(map.size).toBe(0)
  })

  it('an empty string counts as empty', () => {
    expect(loadFromStorage(memoryStorage({ [STORAGE_KEY]: '' }).storage)).toEqual({ data: emptyData() })
  })

  it('a getItem that throws (private mode) → emptyData', () => {
    const storage: Storage = { getItem: () => { throw new Error('SecurityError') }, setItem: vi.fn() }
    expect(loadFromStorage(storage)).toEqual({ data: emptyData() })
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('loads what saveToStorage wrote', () => {
    const { storage, map } = memoryStorage()
    const d = richData()
    expect(saveToStorage(storage, d)).toBeNull()
    expect(map.get(STORAGE_KEY)).toBe(serializeAppData(d))
    const res = loadFromStorage(storage)
    expect(res.error).toBeUndefined()
    expect(res.data).toStrictEqual(d)
  })

  it('corrupted JSON → error, emptyData, and a recoverable copy under fintrack.data.unreadable.*', () => {
    const garbage = '{ this is not json '
    const { storage, map } = memoryStorage({ [STORAGE_KEY]: garbage })
    const res = loadFromStorage(storage)
    expect(res.data).toEqual(emptyData())
    expect(typeof res.error).toBe('string')
    expect(res.error!.length).toBeGreaterThan(0)
    const parked = [...map.keys()].filter((k) => k.startsWith(`${STORAGE_KEY}.unreadable.`))
    expect(parked).toHaveLength(1)
    expect(parked[0]).toMatch(/^fintrack\.data\.unreadable\.\d+$/)
    expect(map.get(parked[0])).toBe(garbage)
    // The original is untouched by loading.
    expect(map.get(STORAGE_KEY)).toBe(garbage)
  })

  it('well-formed but incompatible JSON is parked too, with the DataFormatError message', () => {
    const json = '{"transactions": "nope", "displayCurrency": "XYZ"}'
    const { storage, map } = memoryStorage({ [STORAGE_KEY]: json })
    const res = loadFromStorage(storage)
    expect(res.error).toBe('Not a Fintrack data file.')
    expect([...map.entries()].filter(([k, v]) => k.startsWith('fintrack.data.unreadable.') && v === json)).toHaveLength(1)
    expect(map.get(STORAGE_KEY)).toBe(json)
  })

  it('still reports the error when parking the copy fails', () => {
    const storage: Storage = { getItem: () => 'not json', setItem: () => { throw new Error('QuotaExceededError') } }
    const res = loadFromStorage(storage)
    expect(res.data).toEqual(emptyData())
    expect(res.error).toBeTruthy()
  })

  it('saveToStorage returns the message when setItem throws', () => {
    const storage: Storage = { getItem: () => null, setItem: () => { throw new Error('The quota has been exceeded.') } }
    expect(saveToStorage(storage, emptyData())).toBe('The quota has been exceeded.')
  })

  it('saveToStorage returns a generic message for non-Error throws', () => {
    const storage: Storage = { getItem: () => null, setItem: () => { throw 'boom' } }
    expect(saveToStorage(storage, emptyData())).toBe('Could not save.')
  })
})
