import type { Category } from './category'
import type { CurrencyCode, Rates } from './currency'

export type AccountKind = 'regular' | 'debt'
export type TransactionKind = 'income' | 'expense' | 'transfer'

/** A place money lives: cash, a card, savings — or a debt (negative balance). */
export interface Account {
  id: string
  name: string
  icon: string
  currency: CurrencyCode
  /** Balance when the account was added; current balance is derived from linked transactions. */
  openingBalance: number
  kind: AccountKind
  /** Whether this account participates in the headline total balance. */
  includeInTotal: boolean
}

export const accountIcons = ['credit-card', 'banknote', 'landmark', 'wallet', 'circle-dollar-sign', 'lock'] as const

/** Dates are ISO-8601 strings without fractional seconds ("2026-11-01T09:00:00Z"), which is the only form the Mac app decodes. */
export interface Transaction {
  id: string
  title: string
  amount: number
  currency: CurrencyCode
  category: Category
  kind: TransactionKind
  date: string
  note: string
  /** Income/expense: the account the money hit. Absent = untracked. */
  accountID?: string
  /** Transfers: where the money left and where it landed. */
  fromAccountID?: string
  toAccountID?: string
  /** Legacy name-based transfer endpoints, kept for file compatibility. */
  fromAccount?: string
  toAccount?: string
  /** Cross-currency transfers: what landed on the destination, in `toCurrency`, fixed at transfer time. */
  toAmount?: number
  toCurrency?: CurrencyCode
}

export interface Budget {
  id: string
  category: Category
  limit: number
  currency: CurrencyCode
}

export interface Goal {
  id: string
  name: string
  icon: string
  target: number
  saved: number
  currency: CurrencyCode
  /** ISO date string, or absent. */
  deadline?: string
}

export const goalIcons = ['star', 'laptop', 'plane', 'house', 'car', 'graduation-cap', 'heart', 'shield', 'gift', 'camera'] as const

export interface AppData {
  transactions: Transaction[]
  budgets: Budget[]
  goals: Goal[]
  accounts: Account[]
  displayCurrency: CurrencyCode
  rates: Rates
}

// Derived helpers that mirror the Swift computed properties.

/** Positive for income, negative for expense, zero for transfers — in the transaction's own currency. */
export function signedAmount(t: Transaction): number {
  switch (t.kind) {
    case 'income': return t.amount
    case 'expense': return -t.amount
    case 'transfer': return 0
  }
}

/** Debt payments are transfers under the hood but the user counts them as spending. */
export function isDebtPayment(t: Transaction): boolean {
  return t.kind === 'transfer' && t.category === 'debtPayment'
}

/** Borrowing: transfer out of a debt account. Neutral for income stats. */
export function isLoanReceived(t: Transaction): boolean {
  return t.kind === 'transfer' && t.category === 'loanReceived'
}

/** Whether a transaction counts toward spending stats and budgets. */
export function isSpending(t: Transaction): boolean {
  return t.kind === 'expense' || isDebtPayment(t)
}

export function goalFraction(g: Goal): number {
  return g.target > 0 ? Math.min(1, g.saved / g.target) : 0
}
export function goalIsComplete(g: Goal): boolean {
  return g.target > 0 && g.saved >= g.target
}
export function goalRemaining(g: Goal): number {
  return Math.max(0, g.target - g.saved)
}

export function newID(): string {
  return crypto.randomUUID().toUpperCase()
}
