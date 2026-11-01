import { describe, expect, it } from 'vitest'
import { sampleAppData, sampleData } from './sample'
import { addDays, addMonths, daysBetween, startOfDay, toISO } from './dates'
import { defaultRates } from './currency'
import { balanceOf, balancesByCurrency, headlineBalance, inDisplay, monthExpense, monthSpendingByCategory } from './analytics'
import { goalIsComplete, isDebtPayment, type Account, type Transaction } from './models'
import { parseAppData, serializeAppData } from './persistence'

/** Late evening, so every "today" entry (latest is 22:xx) is in the past. */
const NOW = new Date(2026, 10, 15, 23, 59, 59)

/** A UUID-free fingerprint with account links resolved to names (SampleDataTests.fingerprint). */
function fingerprint(t: Transaction, accounts: Account[]): string {
  const name = (id?: string) => accounts.find((a) => a.id === id)?.name ?? '-'
  return [t.title, t.amount, t.currency, t.category, t.kind, t.note, t.date, name(t.accountID), name(t.fromAccountID), name(t.toAccountID), t.fromAccount ?? '-', t.toAccount ?? '-'].join('|')
}
const stripIds = <T extends { id: string }>(xs: T[]) => xs.map(({ id: _id, ...rest }) => rest)

describe('sampleData', () => {
  it('is deterministic for the same now (ignoring ids)', () => {
    const a = sampleData(NOW), b = sampleData(NOW)
    expect(stripIds(a.accounts)).toEqual(stripIds(b.accounts))
    expect(a.transactions.map((t) => fingerprint(t, a.accounts))).toEqual(b.transactions.map((t) => fingerprint(t, b.accounts)))
    expect(stripIds(a.budgets)).toEqual(stripIds(b.budgets))
    expect(stripIds(a.goals)).toEqual(stripIds(b.goals))
    // …but ids are fresh per call.
    expect(a.accounts[0].id).not.toBe(b.accounts[0].id)
  })

  it('ids are unique; names and budget categories unique', () => {
    const b = sampleData(NOW)
    expect(new Set(b.transactions.map((t) => t.id)).size).toBe(b.transactions.length)
    expect(new Set(b.accounts.map((a) => a.id)).size).toBe(b.accounts.length)
    expect(new Set(b.accounts.map((a) => a.name)).size).toBe(b.accounts.length)
    expect(new Set(b.budgets.map((x) => x.category)).size).toBe(b.budgets.length)
  })

  it('every transaction links to existing accounts; transfers have both distinct endpoints', () => {
    const b = sampleData(NOW)
    const ids = new Set(b.accounts.map((a) => a.id))
    expect(b.transactions.length).toBeGreaterThan(0)
    for (const t of b.transactions) {
      if (t.kind === 'transfer') {
        expect(ids.has(t.fromAccountID!), `${t.title} missing source`).toBe(true)
        expect(ids.has(t.toAccountID!), `${t.title} missing destination`).toBe(true)
        expect(t.fromAccountID).not.toBe(t.toAccountID)
        expect(t.accountID).toBeUndefined()
        // Readable names match the linked accounts.
        expect(t.fromAccount).toBe(b.accounts.find((a) => a.id === t.fromAccountID)!.name)
        expect(t.toAccount).toBe(b.accounts.find((a) => a.id === t.toAccountID)!.name)
      } else {
        expect(ids.has(t.accountID!), `${t.title} unlinked`).toBe(true)
        expect(t.fromAccountID).toBeUndefined()
        expect(t.toAccountID).toBeUndefined()
      }
    }
  })

  it('5 accounts sorted by name, one debt with a negative opening balance, one not counted', () => {
    const { accounts } = sampleData(NOW)
    expect(accounts.map((a) => a.name)).toEqual(['Car loan', 'Cash', 'Humo card', 'Savings', 'Visa USD'])
    const debts = accounts.filter((a) => a.kind === 'debt')
    expect(debts.map((a) => a.name)).toEqual(['Car loan'])
    expect(debts[0].openingBalance).toBeLessThan(0)
    expect(accounts.filter((a) => !a.includeInTotal).map((a) => a.name)).toEqual(['Savings'])
    expect(accounts.find((a) => a.name === 'Visa USD')!.currency).toBe('USD')
  })

  it('three debt payments, all into the debt account', () => {
    const b = sampleData(NOW)
    const debtIDs = new Set(b.accounts.filter((a) => a.kind === 'debt').map((a) => a.id))
    const payments = b.transactions.filter(isDebtPayment)
    expect(payments).toHaveLength(3)
    for (const p of payments) expect(debtIDs.has(p.toAccountID!)).toBe(true)
  })

  it('7 budgets, 4 goals, exactly one goal complete; deadlines relative to now', () => {
    const b = sampleData(NOW)
    expect(b.budgets).toHaveLength(7)
    expect(b.goals).toHaveLength(4)
    expect(b.goals.filter(goalIsComplete).map((g) => g.name)).toEqual(['New camera'])
    expect(b.goals.find((g) => g.name === 'Emergency fund')!.deadline).toBe(toISO(addMonths(NOW, 6)))
    expect(b.goals.find((g) => g.name === 'Trip to Tokyo')!.deadline).toBe(toISO(addMonths(NOW, 10)))
  })

  it('amounts, limits and goal values are positive and finite', () => {
    const b = sampleData(NOW)
    for (const t of b.transactions) expect(t.amount > 0 && Number.isFinite(t.amount)).toBe(true)
    for (const x of b.budgets) expect(x.limit).toBeGreaterThan(0)
    for (const g of b.goals) expect(g.target > 0 && g.saved >= 0).toBe(true)
  })

  it('all dates ≤ now, none after today, ISO without milliseconds', () => {
    const b = sampleData(NOW)
    const endOfToday = addDays(startOfDay(NOW), 1)
    for (const t of b.transactions) {
      expect(t.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
      expect(new Date(t.date).getTime(), `${t.title} @ ${t.date}`).toBeLessThanOrEqual(NOW.getTime())
      expect(new Date(t.date).getTime()).toBeLessThan(endOfToday.getTime())
    }
  })

  // BUG: sample.ts:27-31 — `at()` stamps "today" entries at a fixed hour (Salary 09:00, Rent 10:00,
  // groceries 17-20h, …) without clamping to `now`, so loading the sample in the morning creates
  // future-dated transactions. The Mac app clamps every stamp to `min(stamped, now - 60s)`
  // (SampleData.swift `date(daysAgo:hour:minute:)` and the loan-payment loop).
  // Fix: pass `now` into `at()` and return `toISO(new Date(Math.min(day.getTime(), now.getTime() - 60_000)))`.
  it('no transaction is in the future, whatever the time of day', () => {
    for (const now of [new Date(2026, 10, 1, 0, 5), new Date(2026, 10, 1, 8, 0), new Date(2026, 10, 15, 12, 0), new Date(2026, 10, 2, 9, 30)]) {
      const future = sampleData(now).transactions.filter((t) => new Date(t.date).getTime() > now.getTime())
      expect(future.map((t) => `${t.title} @ ${t.date}`), `now = ${now.toString()}`).toEqual([])
    }
  })

  it('sorted newest first', () => {
    const ts = sampleData(NOW).transactions
    for (let i = 1; i < ts.length; i++) expect(ts[i - 1].date >= ts[i].date).toBe(true)
  })

  it('covers roughly three months', () => {
    const ts = sampleData(NOW).transactions
    const oldest = new Date(ts[ts.length - 1].date)
    const days = daysBetween(oldest, NOW)
    expect(days).toBeGreaterThanOrEqual(80)
    expect(days).toBeLessThanOrEqual(93)
  })

  it('salary lands on the 1st of each month in range', () => {
    const salaries = sampleData(NOW).transactions.filter((t) => t.title === 'Salary')
    expect(salaries.length).toBeGreaterThanOrEqual(3)
    for (const s of salaries) expect(new Date(s.date).getDate()).toBe(1)
  })

  it('sampleAppData keeps UZS display currency and default rates, and round-trips through persistence', () => {
    const d = sampleAppData(NOW)
    expect(d.displayCurrency).toBe('UZS')
    expect(d.rates).toEqual(defaultRates)
    expect(d.rates).not.toBe(defaultRates)
    expect(parseAppData(JSON.parse(serializeAppData(d)))).toStrictEqual(d)
  })

  it('produces sane analytics (AnalyticsTests.seedDataProducesSaneAnalytics / balancesByCurrencySumMatchesHeadline)', () => {
    const d = sampleAppData(NOW)
    expect(monthExpense(d, NOW)).toBeGreaterThanOrEqual(0)
    const rows = monthSpendingByCategory(d, NOW)
    const sum = rows.reduce((s, r) => s + r.amount, 0)
    expect(Math.abs(sum - monthExpense(d, NOW))).toBeLessThan(1e-6)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].amount).toBeGreaterThanOrEqual(rows[i].amount)
    for (const displayCurrency of ['UZS', 'EUR'] as const) {
      const x = { ...d, displayCurrency }
      const summed = balancesByCurrency(x).reduce((s, r) => s + inDisplay(x, r.amount, r.currency), 0)
      expect(Math.abs(summed - headlineBalance(x))).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(summed)))
    }
    const loan = d.accounts.find((a) => a.kind === 'debt')!
    expect(balanceOf(d, loan)).toBe(-5_000_000 + 3 * 1_000_000)
  })
})
