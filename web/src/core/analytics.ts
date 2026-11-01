import { convert, type CurrencyCode } from './currency'
import { expenseCategories, type Category } from './category'
import {
  isSpending, signedAmount, type Account, type AppData, type Budget, type Transaction,
} from './models'
import { addDays, isSameDay, isSameMonth, parseISO, startOfDay } from './dates'

export interface DailyAmount { date: Date; amount: number }
export interface BudgetStatus { spent: number; limit: number; remaining: number; fraction: number; isOver: boolean }

export function inDisplay(data: AppData, amount: number, from: CurrencyCode): number {
  return convert(data.rates, amount, from, data.displayCurrency)
}

export function findAccount(data: AppData, id: string | undefined): Account | undefined {
  if (!id) return undefined
  return data.accounts.find((a) => a.id === id)
}

/** Current balance in the account's own currency: opening + linked activity. */
export function balanceOf(data: AppData, account: Account): number {
  let total = account.openingBalance
  for (const t of data.transactions) {
    const conv = (amt: number) => convert(data.rates, amt, t.currency, account.currency)
    if (t.kind === 'income' && t.accountID === account.id) total += conv(t.amount)
    else if (t.kind === 'expense' && t.accountID === account.id) total -= conv(t.amount)
    else if (t.kind === 'transfer') {
      if (t.fromAccountID === account.id) total -= conv(t.amount)
      if (t.toAccountID === account.id) {
        // A fixed received amount beats re-pricing at today's rate.
        total += t.toAmount != null && t.toCurrency
          ? convert(data.rates, t.toAmount, t.toCurrency, account.currency)
          : conv(t.amount)
      }
    }
  }
  return total
}

/** Counted accounts' balances summed in the display currency. */
export function totalAccountsBalance(data: AppData): number {
  return data.accounts
    .filter((a) => a.includeInTotal)
    .reduce((sum, a) => sum + inDisplay(data, balanceOf(data, a), a.currency), 0)
}

/** Headline balance: counted accounts + unlinked income/expense; plain ledger when there are no accounts. */
export function headlineBalance(data: AppData): number {
  if (data.accounts.length === 0) {
    return data.transactions.reduce((s, t) => s + inDisplay(data, signedAmount(t), t.currency), 0)
  }
  const unlinked = data.transactions
    .filter((t) => t.kind !== 'transfer' && !t.accountID)
    .reduce((s, t) => s + inDisplay(data, signedAmount(t), t.currency), 0)
  return totalAccountsBalance(data) + unlinked
}

/** The headline balance split per currency, display currency first, zero balances dropped. */
export function balancesByCurrency(data: AppData): { currency: CurrencyCode; amount: number }[] {
  const totals = new Map<CurrencyCode, number>()
  const add = (c: CurrencyCode, v: number) => totals.set(c, (totals.get(c) ?? 0) + v)
  if (data.accounts.length === 0) {
    for (const t of data.transactions) if (t.kind !== 'transfer') add(t.currency, signedAmount(t))
  } else {
    for (const a of data.accounts) if (a.includeInTotal) add(a.currency, balanceOf(data, a))
    for (const t of data.transactions) if (t.kind !== 'transfer' && !t.accountID) add(t.currency, signedAmount(t))
  }
  const nonZero = [...totals.entries()].filter(([, v]) => Math.abs(v) >= 0.005).map(([currency, amount]) => ({ currency, amount }))
  if (nonZero.length === 0) return [{ currency: data.displayCurrency, amount: 0 }]
  return nonZero.sort((a, b) => {
    if (a.currency === data.displayCurrency) return -1
    if (b.currency === data.displayCurrency) return 1
    return Math.abs(inDisplay(data, b.amount, b.currency)) - Math.abs(inDisplay(data, a.amount, a.currency))
  })
}

function inMonth(t: Transaction, now: Date): boolean {
  return isSameMonth(parseISO(t.date), now)
}

export function monthIncome(data: AppData, now = new Date()): number {
  return data.transactions
    .filter((t) => t.kind === 'income' && inMonth(t, now))
    .reduce((s, t) => s + inDisplay(data, t.amount, t.currency), 0)
}

export function monthExpense(data: AppData, now = new Date()): number {
  return data.transactions
    .filter((t) => isSpending(t) && inMonth(t, now))
    .reduce((s, t) => s + inDisplay(data, t.amount, t.currency), 0)
}

/** Current-month spending in one category, converted to `currency` (display currency by default). */
export function spentThisMonth(data: AppData, category: Category, currency: CurrencyCode = data.displayCurrency, now = new Date()): number {
  return data.transactions
    .filter((t) => isSpending(t) && t.category === category && inMonth(t, now))
    .reduce((s, t) => s + convert(data.rates, t.amount, t.currency, currency), 0)
}

/** Current-month spending per category, highest first, in the display currency. */
export function monthSpendingByCategory(data: AppData, now = new Date()): { category: Category; amount: number }[] {
  const totals = new Map<Category, number>()
  for (const t of data.transactions) {
    if (!isSpending(t) || !inMonth(t, now)) continue
    totals.set(t.category, (totals.get(t.category) ?? 0) + inDisplay(data, t.amount, t.currency))
  }
  return [...totals.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount)
}

/** Spending per day for the last `lastDays` days including today, oldest first, zero-filled. */
export function dailyExpenses(data: AppData, lastDays: number, now = new Date()): DailyAmount[] {
  const today = startOfDay(now)
  const series: DailyAmount[] = []
  const parsed = data.transactions.filter(isSpending).map((t) => ({ t, d: parseISO(t.date) }))
  for (let offset = lastDays - 1; offset >= 0; offset--) {
    const day = addDays(today, -offset)
    const amount = parsed
      .filter(({ d }) => isSameDay(d, day))
      .reduce((s, { t }) => s + inDisplay(data, t.amount, t.currency), 0)
    series.push({ date: day, amount })
  }
  return series
}

export function budgetStatus(data: AppData, budget: Budget, now = new Date()): BudgetStatus {
  const spent = spentThisMonth(data, budget.category, budget.currency, now)
  const limit = budget.limit
  return {
    spent,
    limit,
    remaining: Math.max(0, limit - spent),
    fraction: limit > 0 ? spent / limit : 0,
    isOver: spent > limit,
  }
}

export function unbudgetedCategories(data: AppData): Category[] {
  const used = new Set(data.budgets.map((b) => b.category))
  return expenseCategories.filter((c) => !used.has(c))
}

export function sortTransactions(list: Transaction[]): Transaction[] {
  return [...list].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

export function sortAccounts(list: Account[]): Account[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
