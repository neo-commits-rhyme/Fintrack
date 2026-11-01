import { describe, expect, it } from 'vitest'
import {
  balanceOf, balancesByCurrency, budgetStatus, dailyExpenses, findAccount, headlineBalance, inDisplay, monthExpense,
  monthIncome, monthSpendingByCategory, sortAccounts, sortTransactions, spentThisMonth, totalAccountsBalance,
  unbudgetedCategories,
} from './analytics'
import { emptyData } from './persistence'
import { addDays, startOfDay, startOfMonth, toISO } from './dates'
import { expenseCategories, type Category } from './category'
import type { CurrencyCode } from './currency'
import {
  goalFraction, goalIsComplete, goalRemaining, isDebtPayment, isLoanReceived, isSpending, newID, signedAmount,
  type Account, type AppData, type Budget, type Goal, type Transaction, type TransactionKind,
} from './models'

// ---- fixtures ---------------------------------------------------------------------------------

/** Fixed "now": Sunday 15 November 2026, 14:30 local. */
const NOW = new Date(2026, 10, 15, 14, 30, 0)
const firstSecondOfMonth = startOfMonth(NOW)
const lastSecondOfLastMonth = new Date(firstSecondOfMonth.getTime() - 1000)
const firstSecondOfNextMonth = new Date(2026, 11, 1, 0, 0, 0)
const lastSecondOfMonth = new Date(firstSecondOfNextMonth.getTime() - 1000)
const daysAgo = (n: number, hour = 12, minute = 0) => { const d = addDays(startOfDay(NOW), -n); d.setHours(hour, minute, 0, 0); return d }

function acct(name: string, currency: CurrencyCode = 'UZS', openingBalance = 0, extra: Partial<Account> = {}): Account {
  return { id: newID(), name, icon: 'credit-card', currency, openingBalance, kind: 'regular', includeInTotal: true, ...extra }
}

interface TxOpts { category?: Category; date?: Date; account?: string; from?: string; to?: string; title?: string }
function tx(kind: TransactionKind, amount: number, currency: CurrencyCode = 'UZS', o: TxOpts = {}): Transaction {
  const category = o.category ?? (kind === 'income' ? 'salary' : kind === 'expense' ? 'groceries' : 'transfer')
  const t: Transaction = { id: newID(), title: o.title ?? 't', amount, currency, category, kind, date: toISO(o.date ?? NOW), note: '' }
  if (o.account) t.accountID = o.account
  if (o.from) t.fromAccountID = o.from
  if (o.to) t.toAccountID = o.to
  return t
}

function data(accounts: Account[] = [], transactions: Transaction[] = [], extra: Partial<AppData> = {}): AppData {
  const d = emptyData()
  d.accounts.push(...accounts)
  d.transactions.push(...transactions)
  return { ...d, ...extra }
}

const approx = (a: number, b: number, tol = 1e-9) =>
  expect(Math.abs(a - b), `${a} ≈ ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)))

// ---- model helpers ----------------------------------------------------------------------------

describe('transaction flags (AnalyticsTests.isSpendingFlags)', () => {
  it('isSpending / isDebtPayment / isLoanReceived / signedAmount', () => {
    expect(isSpending(tx('expense', 1))).toBe(true)
    expect(isSpending(tx('transfer', 1, 'UZS', { category: 'debtPayment' }))).toBe(true)
    expect(isDebtPayment(tx('transfer', 1, 'UZS', { category: 'debtPayment' }))).toBe(true)
    expect(isSpending(tx('transfer', 1))).toBe(false)
    expect(isSpending(tx('transfer', 1, 'UZS', { category: 'loanReceived' }))).toBe(false)
    expect(isLoanReceived(tx('transfer', 1, 'UZS', { category: 'loanReceived' }))).toBe(true)
    expect(isSpending(tx('income', 1))).toBe(false)
    expect(isDebtPayment(tx('income', 1, 'UZS', { category: 'debtPayment' }))).toBe(false)
    expect(isLoanReceived(tx('income', 1, 'UZS', { category: 'loanReceived' }))).toBe(false)
    expect(signedAmount(tx('income', 5))).toBe(5)
    expect(signedAmount(tx('expense', 5))).toBe(-5)
    expect(signedAmount(tx('transfer', 5))).toBe(0)
  })

  it('goal fraction / complete / remaining (GoalsBudgetsTests.goalFractionCompleteRemaining)', () => {
    const g = (target: number, saved: number): Goal => ({ id: newID(), name: 'g', icon: 'star', target, saved, currency: 'USD' })
    expect([goalFraction(g(200, 100)), goalIsComplete(g(200, 100)), goalRemaining(g(200, 100))]).toEqual([0.5, false, 100])
    expect([goalFraction(g(200, 200)), goalIsComplete(g(200, 200)), goalRemaining(g(200, 200))]).toEqual([1, true, 0])
    expect([goalFraction(g(200, 500)), goalIsComplete(g(200, 500)), goalRemaining(g(200, 500))]).toEqual([1, true, 0])
    expect([goalFraction(g(0, 0)), goalIsComplete(g(0, 0)), goalRemaining(g(0, 0))]).toEqual([0, false, 0])
    expect([goalFraction(g(0, 50)), goalIsComplete(g(0, 50)), goalRemaining(g(0, 50))]).toEqual([0, false, 0])
    expect([goalFraction(g(100, 0)), goalRemaining(g(100, 0))]).toEqual([0, 100])
  })
})

// ---- balances ---------------------------------------------------------------------------------

describe('balanceOf (StoreBalanceTests.swift)', () => {
  it('opening balance only', () => {
    const a = acct('Cash', 'UZS', 400_000)
    expect(balanceOf(data([a]), a)).toBe(400_000)
  })

  it('income and expense in the same currency', () => {
    const a = acct('Cash', 'UZS', 1_000)
    const d = data([a], [tx('income', 500, 'UZS', { account: a.id }), tx('expense', 200, 'UZS', { account: a.id })])
    expect(balanceOf(d, a)).toBe(1_300)
  })

  it('income and expense in another currency are converted into the account currency', () => {
    const usd = acct('Visa', 'USD', 10)
    const d = data([usd], [tx('income', 121_100, 'UZS', { account: usd.id }), tx('expense', 14_150, 'UZS', { account: usd.id })])
    approx(balanceOf(d, usd), 10 + 10 - 14_150 / 12_110)
  })

  it('unlinked and other-account transactions do not touch an account', () => {
    const a = acct('A'), b = acct('B')
    const d = data([a, b], [tx('income', 500, 'UZS', { account: b.id }), tx('expense', 70)])
    expect(balanceOf(d, a)).toBe(0)
    expect(balanceOf(d, b)).toBe(500)
  })

  it('a transfer moves money between accounts and is net zero for the headline', () => {
    const a = acct('A', 'UZS', 1_000), b = acct('B')
    const d = data([a, b], [tx('transfer', 300, 'UZS', { from: a.id, to: b.id })])
    expect(balanceOf(d, a)).toBe(700)
    expect(balanceOf(d, b)).toBe(300)
    expect(headlineBalance(d)).toBe(1_000)
  })

  it('a cross-currency transfer converts each side', () => {
    const uzs = acct('Humo', 'UZS', 1_000_000), usd = acct('Visa', 'USD')
    const d = data([uzs, usd], [tx('transfer', 50, 'USD', { from: uzs.id, to: usd.id })])
    expect(balanceOf(d, usd)).toBe(50)
    expect(balanceOf(d, uzs)).toBe(1_000_000 - 50 * 12_110)
    approx(headlineBalance(d), 1_000_000)
  })

  it('a transfer to self is net zero', () => {
    const a = acct('A', 'UZS', 10)
    expect(balanceOf(data([a], [tx('transfer', 5, 'UZS', { from: a.id, to: a.id })]), a)).toBe(10)
  })

  it('a debt account has a negative balance and pulls the total down', () => {
    const cash = acct('Cash', 'UZS', 2_000_000)
    const loan = acct('Car loan', 'UZS', -5_000_000, { kind: 'debt' })
    const d = data([cash, loan])
    expect(balanceOf(d, loan)).toBe(-5_000_000)
    expect(totalAccountsBalance(d)).toBe(-3_000_000)
    expect(headlineBalance(d)).toBe(-3_000_000)
  })

  it('a transfer into a debt pays it down; net worth unchanged', () => {
    const card = acct('Card', 'UZS', 3_000_000)
    const loan = acct('Loan', 'UZS', -5_000_000, { kind: 'debt' })
    const d = data([card, loan], [tx('transfer', 1_000_000, 'UZS', { category: 'debtPayment', from: card.id, to: loan.id, date: NOW })])
    expect(balanceOf(d, card)).toBe(2_000_000)
    expect(balanceOf(d, loan)).toBe(-4_000_000)
    expect(headlineBalance(d)).toBe(-2_000_000)
    // …but it counts as spending.
    expect(monthExpense(d, NOW)).toBe(1_000_000)
  })

  it('a foreign-currency debt payment is converted into the debt currency', () => {
    const visa = acct('Visa', 'USD', 100)
    const loan = acct('Loan', 'UZS', -1_000_000, { kind: 'debt' })
    const d = data([visa, loan], [tx('transfer', 10, 'USD', { category: 'debtPayment', from: visa.id, to: loan.id })])
    expect(balanceOf(d, visa)).toBe(90)
    expect(balanceOf(d, loan)).toBe(-1_000_000 + 121_100)
  })

  it('loan received (debt → regular) deepens the debt, funds the account, and is neither income nor spending', () => {
    const card = acct('Card'), loan = acct('Loan', 'UZS', -1_000, { kind: 'debt' })
    const d = data([card, loan], [tx('transfer', 500, 'UZS', { category: 'loanReceived', from: loan.id, to: card.id, date: NOW })])
    expect(balanceOf(d, loan)).toBe(-1_500)
    expect(balanceOf(d, card)).toBe(500)
    expect(headlineBalance(d)).toBe(-1_000)
    expect(monthIncome(d, NOW)).toBe(0)
    expect(monthExpense(d, NOW)).toBe(0)
  })

  it('after an account is deleted (links absent) the other side and the unlinked income still count', () => {
    // State after AppStore.deleteAccount(A): A removed, every reference to A cleared.
    const b = acct('B')
    const inc = tx('income', 50) // was accountID: A
    const tr = tx('transfer', 30, 'UZS', { to: b.id }) // was from A
    const tr2 = tx('transfer', 10, 'UZS', { from: b.id }) // was to A
    const d = data([b], [inc, tr, tr2])
    expect(inc.accountID).toBeUndefined()
    expect('accountID' in inc).toBe(false)
    expect(balanceOf(d, b)).toBe(20)
    expect(headlineBalance(d)).toBe(20 + 50)
  })

  it('findAccount', () => {
    const a = acct('A')
    const d = data([a])
    expect(findAccount(d, a.id)).toBe(a)
    expect(findAccount(d, undefined)).toBeUndefined()
    expect(findAccount(d, '')).toBeUndefined()
    expect(findAccount(d, newID())).toBeUndefined()
  })
})

describe('headlineBalance / totalAccountsBalance', () => {
  it('plain ledger when there are no accounts (transfers ignored)', () => {
    const d = data([], [tx('income', 1_000), tx('expense', 300), tx('income', 1, 'USD'), tx('transfer', 99_999)])
    expect(headlineBalance(d)).toBe(1_000 - 300 + 12_110)
    expect(totalAccountsBalance(d)).toBe(0)
  })

  it('empty data is zero', () => {
    const d = emptyData()
    expect(headlineBalance(d)).toBe(0)
    expect(totalAccountsBalance(d)).toBe(0)
  })

  it('includeInTotal off is skipped', () => {
    const main = acct('Main', 'UZS', 1_000)
    const hidden = acct('Savings', 'UZS', 9_000, { includeInTotal: false })
    const d = data([main, hidden], [tx('income', 500, 'UZS', { account: hidden.id })])
    expect(balanceOf(d, hidden)).toBe(9_500)
    expect(totalAccountsBalance(d)).toBe(1_000)
    expect(headlineBalance(d)).toBe(1_000)
    expect(balancesByCurrency(d).map((r) => r.amount)).toEqual([1_000])
  })

  it('a transfer from an excluded account raises the total', () => {
    const main = acct('Main'), hidden = acct('Savings', 'UZS', 9_000, { includeInTotal: false })
    expect(headlineBalance(data([main, hidden], [tx('transfer', 2_000, 'UZS', { from: hidden.id, to: main.id })]))).toBe(2_000)
  })

  it('unlinked income/expense are added when accounts exist; unlinked transfers are not', () => {
    const a = acct('A', 'UZS', 1_000)
    const d = data([a], [tx('expense', 200), tx('income', 3, 'USD'), tx('transfer', 777)])
    expect(totalAccountsBalance(d)).toBe(1_000)
    expect(headlineBalance(d)).toBe(1_000 - 200 + 3 * 12_110)
    const split = balancesByCurrency(d)
    expect(split).toEqual([{ currency: 'UZS', amount: 800 }, { currency: 'USD', amount: 3 }])
  })

  it('totals convert into the display currency', () => {
    const d = data([acct('Visa', 'USD', 10), acct('Humo', 'UZS', 121_100)], [], { displayCurrency: 'USD' })
    approx(totalAccountsBalance(d), 20)
    approx(headlineBalance(d), 20)
    expect(inDisplay(d, 24_220, 'UZS')).toBe(2)
  })
})

describe('balancesByCurrency', () => {
  it('fallback ledger split per currency', () => {
    const d = data([], [tx('income', 1_000), tx('expense', 300), tx('income', 1, 'USD'), tx('transfer', 99_999)])
    expect(balancesByCurrency(d)).toEqual([{ currency: 'UZS', amount: 700 }, { currency: 'USD', amount: 1 }])
  })

  it('empty → [{displayCurrency, 0}]', () => {
    expect(balancesByCurrency(emptyData())).toEqual([{ currency: 'UZS', amount: 0 }])
    expect(balancesByCurrency({ ...emptyData(), displayCurrency: 'EUR' })).toEqual([{ currency: 'EUR', amount: 0 }])
  })

  it('display currency first, then by converted size (absolute)', () => {
    const accounts = [
      acct('Humo', 'UZS', 1_000), // tiny
      acct('Visa', 'USD', 10), // 121 100 UZS
      acct('EUR', 'EUR', 100), // 1 415 000 UZS
      acct('Loan', 'GBP', -1_000, { kind: 'debt' }), // −16.3M UZS
    ]
    expect(balancesByCurrency(data(accounts)).map((r) => r.currency)).toEqual(['UZS', 'GBP', 'EUR', 'USD'])
    expect(balancesByCurrency(data(accounts, [], { displayCurrency: 'USD' })).map((r) => r.currency)).toEqual(['USD', 'GBP', 'EUR', 'UZS'])
  })

  it('display currency first even when it is the smallest and appears last in the data', () => {
    const accounts = [acct('EUR', 'EUR', 100), acct('Visa', 'USD', 10), acct('Humo', 'UZS', 1)]
    expect(balancesByCurrency(data(accounts)).map((r) => r.currency)).toEqual(['UZS', 'EUR', 'USD'])
  })

  it('zero (and sub-0.005) balances are dropped', () => {
    const usd = acct('Visa', 'USD', 10)
    const d = data([usd, acct('Humo', 'UZS', 500)], [tx('expense', 10, 'USD', { account: usd.id }), tx('expense', 0.001, 'EUR')])
    expect(balancesByCurrency(d).map((r) => r.currency)).toEqual(['UZS'])
  })

  it('all-zero balances fall back to [{displayCurrency, 0}]', () => {
    const d = data([acct('Visa', 'USD', 0)], [], { displayCurrency: 'GBP' })
    expect(balancesByCurrency(d)).toEqual([{ currency: 'GBP', amount: 0 }])
  })

  it('the split sums back to the headline in any display currency', () => {
    const humo = acct('Humo', 'UZS', 2_500_000), visa = acct('Visa', 'USD', 180)
    const loan = acct('Loan', 'UZS', -5_000_000, { kind: 'debt' }), hidden = acct('Savings', 'UZS', 9_000_000, { includeInTotal: false })
    const ts = [
      tx('expense', 120_000, 'UZS', { account: humo.id }), tx('income', 350, 'USD', { account: visa.id }),
      tx('transfer', 1_000_000, 'UZS', { category: 'debtPayment', from: humo.id, to: loan.id }),
      tx('transfer', 150, 'USD', { from: hidden.id, to: visa.id }), tx('expense', 7, 'EUR'),
    ]
    for (const displayCurrency of ['UZS', 'EUR', 'USD'] as const) {
      const d = data([humo, visa, loan, hidden], ts, { displayCurrency })
      const summed = balancesByCurrency(d).reduce((s, r) => s + inDisplay(d, r.amount, r.currency), 0)
      approx(summed, headlineBalance(d))
    }
  })
})

// ---- monthly stats ----------------------------------------------------------------------------

describe('monthly analytics with an explicit now (AnalyticsTests.swift)', () => {
  it('monthIncome counts only income this month', () => {
    const d = data([], [
      tx('income', 1_000, 'UZS', { date: NOW }),
      tx('income', 1, 'USD', { date: firstSecondOfMonth }),
      tx('income', 50_000, 'UZS', { date: lastSecondOfLastMonth }),
      tx('expense', 77, 'UZS', { date: NOW }),
      tx('transfer', 5_000, 'UZS', { category: 'loanReceived', date: NOW }),
      tx('transfer', 5_000, 'UZS', { date: NOW }),
    ])
    expect(monthIncome(d, NOW)).toBe(1_000 + 12_110)
  })

  it('monthExpense includes debt payments but not plain transfers or loans', () => {
    const d = data([], [
      tx('expense', 100), tx('transfer', 1_000, 'UZS', { category: 'debtPayment' }),
      tx('transfer', 10_000, 'UZS', { category: 'transfer' }), tx('transfer', 20_000, 'UZS', { category: 'loanReceived' }),
      tx('income', 30_000),
    ])
    expect(monthExpense(d, NOW)).toBe(1_100)
  })

  it('month boundaries: last second of previous month excluded, first second of this month included', () => {
    const d = data([], [
      tx('expense', 1, 'UZS', { date: firstSecondOfMonth }),
      tx('expense', 10, 'UZS', { date: lastSecondOfLastMonth }),
      tx('expense', 100, 'UZS', { date: firstSecondOfNextMonth }),
    ])
    expect(toISO(lastSecondOfLastMonth)).not.toBe(toISO(firstSecondOfMonth))
    expect(monthExpense(d, NOW)).toBe(1)
    expect(spentThisMonth(d, 'groceries', 'UZS', NOW)).toBe(1)
    expect(monthSpendingByCategory(d, NOW).map((r) => r.amount)).toEqual([1])
  })

  it('the same month last year is excluded', () => {
    const lastYear = new Date(2025, 10, 15, 14, 30)
    const d = data([], [tx('expense', 999, 'UZS', { date: lastYear }), tx('income', 999, 'UZS', { date: lastYear })])
    expect(monthExpense(d, NOW)).toBe(0)
    expect(monthIncome(d, NOW)).toBe(0)
  })

  it('a future-dated transaction later this month counts in month totals', () => {
    const d = data([], [tx('expense', 40, 'UZS', { date: lastSecondOfMonth }), tx('income', 60, 'UZS', { date: lastSecondOfMonth })])
    expect(monthExpense(d, NOW)).toBe(40)
    expect(monthIncome(d, NOW)).toBe(60)
  })

  it('monthExpense converts to the display currency', () => {
    const ts = [tx('expense', 2, 'USD'), tx('expense', 12_110, 'UZS')]
    expect(monthExpense(data([], ts), NOW)).toBe(36_330)
    approx(monthExpense(data([], ts, { displayCurrency: 'USD' }), NOW), 3)
  })

  it('spentThisMonth per category and currency', () => {
    const d = data([], [
      tx('expense', 24_220, 'UZS', { category: 'groceries' }), tx('expense', 1, 'USD', { category: 'groceries' }),
      tx('expense', 500, 'UZS', { category: 'transport' }), tx('transfer', 1_000, 'UZS', { category: 'debtPayment' }),
    ])
    expect(spentThisMonth(d, 'groceries', undefined, NOW)).toBe(36_330)
    approx(spentThisMonth(d, 'groceries', 'USD', NOW), 3)
    expect(spentThisMonth(d, 'transport', 'UZS', NOW)).toBe(500)
    expect(spentThisMonth(d, 'debtPayment', 'UZS', NOW)).toBe(1_000)
    expect(spentThisMonth(d, 'health', 'UZS', NOW)).toBe(0)
  })

  it('monthSpendingByCategory is sorted highest first and includes debt payments', () => {
    const d = data([], [
      tx('expense', 300, 'UZS', { category: 'transport' }), tx('expense', 100, 'UZS', { category: 'groceries' }),
      tx('expense', 250, 'UZS', { category: 'groceries' }), tx('expense', 1, 'USD', { category: 'shopping' }),
      tx('transfer', 200, 'UZS', { category: 'debtPayment' }), tx('transfer', 99_999, 'UZS', { category: 'transfer' }),
      tx('expense', 5_000, 'UZS', { category: 'health', date: lastSecondOfLastMonth }),
    ])
    const rows = monthSpendingByCategory(d, NOW)
    expect(rows.map((r) => r.category)).toEqual(['shopping', 'groceries', 'transport', 'debtPayment'])
    expect(rows.map((r) => r.amount)).toEqual([12_110, 350, 300, 200])
    approx(rows.reduce((s, r) => s + r.amount, 0), monthExpense(d, NOW))
  })
})

describe('dailyExpenses', () => {
  it('length, ordering and zero-fill', () => {
    const d = data([], [
      tx('expense', 100, 'UZS', { date: daysAgo(0, 0) }),
      tx('expense', 50, 'UZS', { date: daysAgo(0, 0, 1) }),
      tx('expense', 7, 'UZS', { date: daysAgo(2) }),
      tx('transfer', 1_000, 'UZS', { category: 'debtPayment', date: daysAgo(2) }),
      tx('transfer', 9_999, 'UZS', { date: daysAgo(2) }),
      tx('transfer', 9_999, 'UZS', { category: 'loanReceived', date: daysAgo(2) }),
      tx('income', 9_999, 'UZS', { date: daysAgo(1) }),
      tx('expense', 3, 'UZS', { date: daysAgo(7) }), // outside a 7-day window
    ])
    const series = dailyExpenses(d, 7, NOW)
    expect(series).toHaveLength(7)
    expect(series.at(-1)!.date.getTime()).toBe(startOfDay(NOW).getTime())
    expect(series[0].date.getTime()).toBe(addDays(startOfDay(NOW), -6).getTime())
    for (let i = 1; i < series.length; i++) expect(series[i].date.getTime()).toBeGreaterThan(series[i - 1].date.getTime())
    for (const p of series) expect(p.date.getTime()).toBe(startOfDay(p.date).getTime())
    expect(series.map((p) => p.amount)).toEqual([0, 0, 0, 0, 1_007, 0, 150])
  })

  it('a transaction at 23:59 local counts on its own day (not the next, not UTC)', () => {
    const d = data([], [tx('expense', 42, 'UZS', { date: daysAgo(1, 23, 59) }), tx('expense', 8, 'UZS', { date: daysAgo(1, 0, 0) })])
    expect(dailyExpenses(d, 3, NOW).map((p) => p.amount)).toEqual([0, 50, 0])
  })

  it.each(['America/Los_Angeles', 'Pacific/Auckland', 'Asia/Tashkent'])('day bucketing follows local time in %s', (tz) => {
    const original = process.env.TZ
    process.env.TZ = tz
    try {
      const now = new Date(2026, 10, 15, 14, 30)
      const at = (day: number, h: number, m: number) => toISO(new Date(2026, 10, day, h, m, 0))
      const mk = (amount: number, date: string): Transaction => ({ ...tx('expense', amount), date })
      const d = data([], [mk(42, at(14, 23, 59)), mk(8, at(14, 0, 0)), mk(1, at(15, 0, 0)), mk(1000, at(13, 23, 59))])
      expect(dailyExpenses(d, 2, now).map((p) => p.amount)).toEqual([50, 1])
      // Month boundary in local time.
      const m = data([], [mk(1, toISO(new Date(2026, 10, 1, 0, 0, 0))), mk(10, toISO(new Date(2026, 9, 31, 23, 59, 59)))])
      expect(monthExpense(m, now)).toBe(1)
    } finally {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    }
  })

  it('converts to the display currency', () => {
    const ts = [tx('expense', 2, 'USD', { date: daysAgo(0, 0) })]
    expect(dailyExpenses(data([], ts), 1, NOW).map((p) => p.amount)).toEqual([24_220])
    expect(dailyExpenses(data([], ts, { displayCurrency: 'USD' }), 1, NOW).map((p) => p.amount)).toEqual([2])
  })

  it.each([0, -3])('a non-positive window (%d) is empty', (n) => {
    expect(dailyExpenses(data([], [tx('expense', 1)]), n, NOW)).toEqual([])
  })

  it('30 days are unique consecutive calendar days', () => {
    const series = dailyExpenses(emptyData(), 30, NOW)
    expect(series).toHaveLength(30)
    expect(new Set(series.map((p) => p.date.getTime())).size).toBe(30)
    for (let i = 1; i < series.length; i++) {
      expect(addDays(series[i - 1].date, 1).getTime()).toBe(series[i].date.getTime())
    }
  })

  it('a transaction dated tomorrow never shows up in a series ending today', () => {
    const d = data([], [tx('expense', 500, 'UZS', { date: addDays(daysAgo(0), 1) })])
    expect(dailyExpenses(d, 7, NOW).reduce((s, p) => s + p.amount, 0)).toBe(0)
  })
})

// ---- budgets ----------------------------------------------------------------------------------

describe('budgetStatus (GoalsBudgetsTests.swift)', () => {
  const budget = (category: Category, limit: number, currency: CurrencyCode = 'UZS'): Budget => ({ id: newID(), category, limit, currency })

  it('same currency', () => {
    const b = budget('groceries', 1_000)
    const d = data([], [tx('expense', 400, 'UZS', { category: 'groceries' }), tx('expense', 999, 'UZS', { category: 'transport' })])
    d.budgets.push(b)
    expect(budgetStatus(d, b, NOW)).toEqual({ spent: 400, limit: 1_000, remaining: 600, fraction: 0.4, isOver: false })
  })

  it('converts spending into the budget currency, independent of display currency', () => {
    const b = budget('subscriptions', 25, 'USD')
    const ts = [tx('expense', 121_100, 'UZS', { category: 'subscriptions' }), tx('expense', 5, 'USD', { category: 'subscriptions' })]
    for (const displayCurrency of ['UZS', 'EUR'] as const) {
      const s = budgetStatus(data([], ts, { displayCurrency }), b, NOW)
      approx(s.spent, 15)
      approx(s.remaining, 10)
      approx(s.fraction, 0.6)
      expect(s.isOver).toBe(false)
    }
  })

  it('over the limit', () => {
    const b = budget('eatingOut', 100)
    const s = budgetStatus(data([], [tx('expense', 150, 'UZS', { category: 'eatingOut' })]), b, NOW)
    expect(s.isOver).toBe(true)
    expect(s.remaining).toBe(0)
    expect(s.fraction).toBe(1.5)
  })

  it('exactly at the limit is not over', () => {
    const s = budgetStatus(data([], [tx('expense', 100, 'UZS', { category: 'eatingOut' })]), budget('eatingOut', 100), NOW)
    expect(s.isOver).toBe(false)
    expect(s.fraction).toBe(1)
    expect(s.remaining).toBe(0)
  })

  it('ignores last month', () => {
    const d = data([], [tx('expense', 80, 'UZS', { category: 'groceries', date: lastSecondOfLastMonth })])
    expect(budgetStatus(d, budget('groceries', 100), NOW).spent).toBe(0)
  })

  it('counts debt payments in a debtPayment budget', () => {
    const d = data([], [tx('transfer', 1_000_000, 'UZS', { category: 'debtPayment' })])
    expect(budgetStatus(d, budget('debtPayment', 2_000_000), NOW).spent).toBe(1_000_000)
  })

  it('zero limit', () => {
    expect(budgetStatus(emptyData(), budget('groceries', 0), NOW)).toEqual({ spent: 0, limit: 0, remaining: 0, fraction: 0, isOver: false })
    const s = budgetStatus(data([], [tx('expense', 10)]), budget('groceries', 0), NOW)
    expect(s.fraction).toBe(0)
    expect(s.isOver).toBe(true)
  })
})

describe('unbudgetedCategories', () => {
  it('all expense categories when there are no budgets; budgeted ones removed', () => {
    const d = emptyData()
    expect(unbudgetedCategories(d)).toEqual(expenseCategories)
    d.budgets.push({ id: newID(), category: 'groceries', limit: 1, currency: 'UZS' }, { id: newID(), category: 'travel', limit: 1, currency: 'UZS' })
    const remaining = unbudgetedCategories(d)
    expect(remaining).not.toContain('groceries')
    expect(remaining).not.toContain('travel')
    expect(remaining).toHaveLength(expenseCategories.length - 2)
    expect(remaining).not.toContain('salary')
    expect(remaining).not.toContain('transfer')
  })
})

// ---- sorting ----------------------------------------------------------------------------------

describe('sorting', () => {
  it('sortTransactions: newest first, without mutating the input', () => {
    const old = tx('expense', 1, 'UZS', { date: new Date(NOW.getTime() - 3_600_000) })
    const mid = tx('expense', 2, 'UZS', { date: new Date(NOW.getTime() - 60_000) })
    const nw = tx('expense', 3, 'UZS', { date: NOW })
    const input = [mid, old, nw]
    expect(sortTransactions(input).map((t) => t.id)).toEqual([nw.id, mid.id, old.id])
    expect(input.map((t) => t.id)).toEqual([mid.id, old.id, nw.id])
    const moved = { ...old, date: toISO(new Date(NOW.getTime() + 60_000)) }
    expect(sortTransactions([nw, mid, moved]).map((t) => t.id)).toEqual([old.id, nw.id, mid.id])
  })

  it('sortTransactions orders across years and months', () => {
    const a = tx('expense', 1, 'UZS', { date: new Date(2025, 11, 31, 23, 59, 59) })
    const b = tx('expense', 1, 'UZS', { date: new Date(2026, 0, 1, 0, 0, 0) })
    const c = tx('expense', 1, 'UZS', { date: new Date(2026, 9, 2) })
    expect(sortTransactions([a, c, b]).map((t) => t.id)).toEqual([c.id, b.id, a.id])
  })

  it('sortAccounts: by name, case-insensitively', () => {
    const names = (list: Account[]) => sortAccounts(list).map((a) => a.name)
    expect(names([acct('visa'), acct('Cash'), acct('humo')])).toEqual(['Cash', 'humo', 'visa'])
    expect(names([acct('humo'), acct('visa'), acct('Zebra')])).toEqual(['humo', 'visa', 'Zebra'])
    expect(names([acct('Visa USD'), acct('Car loan'), acct('Savings'), acct('Humo card'), acct('Cash')]))
      .toEqual(['Car loan', 'Cash', 'Humo card', 'Savings', 'Visa USD'])
  })
})
