import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  convert, defaultRates, emptyData, loadFromStorage, saveToStorage, sampleData, serializeAppData, sortAccounts, sortTransactions,
  type Account, type AccountKind, type AppData, type Budget, type CurrencyCode, type Goal, type Transaction,
} from '../core'
import { newID } from '../core/models'
import { telegram } from '../telegram'
import { createSyncRunner, syncOff, type SyncRunner, type SyncStatus } from './syncRunner'

export type Section = 'dashboard' | 'transactions' | 'accounts' | 'budgets' | 'goals' | 'converter' | 'settings'
export type Appearance = 'system' | 'light' | 'dark'

const APPEARANCE_KEY = 'fintrack.appearance'
/** The local data a cloud copy replaced before it ever synced — kept once, for recovery. */
const PRESYNC_KEY = 'fintrack.data.presync'

export interface Store {
  data: AppData
  /** Ticks every minute so "this month" totals and Today/Yesterday labels roll over honestly. */
  now: Date
  saveError: string | null
  loadError: string | null
  clearSaveError(): void
  clearLoadError(): void

  appearance: Appearance
  setAppearance(a: Appearance): void

  /** True when running as a Telegram Mini App. */
  inTelegram: boolean
  /** Telegram cloud sync; `available` is false outside Telegram. */
  sync: SyncStatus
  /** `force: 'push'` uploads this device's data over whatever the cloud holds. */
  syncNow(force?: 'push'): void

  /** Set by the global ⌘N shortcut; the Transactions screen opens its sheet and clears it. */
  newTransactionRequested: boolean
  requestNewTransaction(on: boolean): void

  /** Converter input, kept across screen switches (not persisted). */
  converter: { amount: number | null; from: CurrencyCode; to: CurrencyCode | null }
  setConverter(c: Partial<Store['converter']>): void

  setDisplayCurrency(c: CurrencyCode): void
  setRate(uzsPerUnit: number, currency: CurrencyCode): void
  resetRatesToDefaults(): void

  addTransaction(t: Omit<Transaction, 'id'> & { id?: string }): void
  updateTransaction(t: Transaction): void
  deleteTransaction(id: string): void
  /** Saves many transactions at once (bank statement import). */
  importTransactions(list: Transaction[]): void

  addBudget(b: Omit<Budget, 'id'>): void
  updateBudget(b: Budget): void
  deleteBudget(id: string): void

  addGoal(g: Omit<Goal, 'id'>): void
  updateGoal(g: Goal): void
  deleteGoal(id: string): void
  addFunds(goalID: string, amount: number, currency: CurrencyCode): void

  addAccount(a: Omit<Account, 'id'>): void
  /** Creates (or returns the existing same-named) account from just a name. */
  createAccount(name: string, currency: CurrencyCode, kind?: AccountKind): Account
  updateAccount(a: Account): void
  deleteAccount(id: string): void

  resetToSampleData(): void
  eraseAll(): void
  replaceAll(data: AppData): void
}

const StoreContext = createContext<Store | null>(null)

function readAppearance(): Appearance {
  try {
    const v = localStorage.getItem(APPEARANCE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [{ data: initial, error: initialError }] = useState(() => loadFromStorage(localStorage))
  const [data, setDataState] = useState<AppData>(initial)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(initialError ?? null)
  const [appearance, setAppearanceState] = useState<Appearance>(readAppearance)
  const [now, setNow] = useState(() => new Date())
  const [newTransactionRequested, requestNewTransaction] = useState(false)
  const [converter, setConverterState] = useState<Store['converter']>({ amount: 100, from: 'USD', to: null })
  const dataRef = useRef(data)
  dataRef.current = data
  const [tgScheme, setTgScheme] = useState(telegram.colorScheme)
  const [sync, setSync] = useState<SyncStatus>(syncOff)
  const runner = useRef<SyncRunner | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(new Date()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => telegram.onThemeChanged(() => setTgScheme(telegram.colorScheme())), [])

  useEffect(() => {
    const root = document.documentElement
    // Inside Telegram, "System" means Telegram's own light/dark setting.
    const theme = appearance === 'system' ? tgScheme : appearance
    if (theme) root.setAttribute('data-theme', theme)
    else root.removeAttribute('data-theme')
    if (theme) telegram.setChrome(theme)
    try { localStorage.setItem(APPEARANCE_KEY, appearance) } catch { /* ignore */ }
  }, [appearance, tgScheme])

  useEffect(() => {
    const kv = telegram.cloudKV()
    if (!kv) return
    const r = createSyncRunner({
      kv,
      getLocal: () => dataRef.current,
      applyRemote: (next, keepCopy) => {
        if (keepCopy) {
          try { localStorage.setItem(PRESYNC_KEY, serializeAppData(dataRef.current)) } catch { /* ignore */ }
        }
        // Not a local edit: saved on the device, but not marked for upload.
        setDataState(next)
        dataRef.current = next
        setSaveError(saveToStorage(localStorage, next))
      },
      onStatus: setSync,
    })
    runner.current = r
    return () => { r.dispose(); runner.current = null }
  }, [])

  /** Every mutation goes through here so it is saved. */
  const commit = useCallback((next: AppData) => {
    setDataState(next)
    dataRef.current = next
    setSaveError(saveToStorage(localStorage, next))
    telegram.haptic('impact')
    runner.current?.changed()
  }, [])

  const update = useCallback((fn: (d: AppData) => AppData) => commit(fn(dataRef.current)), [commit])

  const store = useMemo<Store>(() => ({
    data,
    now,
    saveError,
    loadError,
    clearSaveError: () => setSaveError(null),
    clearLoadError: () => setLoadError(null),
    appearance,
    setAppearance: setAppearanceState,
    inTelegram: telegram.active(),
    sync,
    syncNow: (force) => runner.current?.syncNow(force),
    newTransactionRequested,
    requestNewTransaction,
    converter,
    setConverter: (c) => setConverterState((prev) => ({ ...prev, ...c })),

    setDisplayCurrency: (displayCurrency) => update((d) => ({ ...d, displayCurrency })),
    setRate: (uzsPerUnit, currency) => {
      if (currency === 'UZS' || !(uzsPerUnit > 0) || !Number.isFinite(uzsPerUnit)) return
      update((d) => ({ ...d, rates: { ...d.rates, [currency]: uzsPerUnit, UZS: 1 } }))
    },
    resetRatesToDefaults: () => update((d) => ({ ...d, rates: { ...defaultRates } })),

    addTransaction: (t) => update((d) => ({ ...d, transactions: sortTransactions([...d.transactions, { ...t, id: t.id ?? newID() }]) })),
    updateTransaction: (t) => update((d) => ({ ...d, transactions: sortTransactions(d.transactions.map((x) => (x.id === t.id ? t : x))) })),
    deleteTransaction: (id) => update((d) => ({ ...d, transactions: d.transactions.filter((t) => t.id !== id) })),
    importTransactions: (list) => update((d) => ({ ...d, transactions: sortTransactions([...d.transactions, ...list]) })),

    addBudget: (b) => update((d) => ({ ...d, budgets: [...d.budgets, { ...b, id: newID() }] })),
    updateBudget: (b) => update((d) => ({ ...d, budgets: d.budgets.map((x) => (x.id === b.id ? b : x)) })),
    deleteBudget: (id) => update((d) => ({ ...d, budgets: d.budgets.filter((b) => b.id !== id) })),

    addGoal: (g) => update((d) => ({ ...d, goals: [...d.goals, { ...g, id: newID() }] })),
    updateGoal: (g) => update((d) => ({ ...d, goals: d.goals.map((x) => (x.id === g.id ? g : x)) })),
    deleteGoal: (id) => update((d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) })),
    addFunds: (goalID, amount, currency) => update((d) => ({
      ...d,
      goals: d.goals.map((g) => (g.id === goalID ? { ...g, saved: g.saved + convert(d.rates, amount, currency, g.currency) } : g)),
    })),

    addAccount: (a) => update((d) => ({ ...d, accounts: sortAccounts([...d.accounts, { ...a, id: newID() }]) })),
    createAccount: (name, currency, kind = 'regular') => {
      const trimmed = name.trim()
      const d = dataRef.current
      const existing = d.accounts.find((a) => a.name.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0)
      if (existing) return existing
      const account: Account = { id: newID(), name: trimmed, icon: 'credit-card', currency, openingBalance: 0, kind, includeInTotal: true }
      commit({ ...d, accounts: sortAccounts([...d.accounts, account]) })
      return account
    },
    updateAccount: (a) => update((d) => ({ ...d, accounts: sortAccounts(d.accounts.map((x) => (x.id === a.id ? a : x))) })),
    /** Deletes an account and unlinks every transaction that referenced it — the transactions are kept. */
    deleteAccount: (id) => update((d) => ({
      ...d,
      accounts: d.accounts.filter((a) => a.id !== id),
      transactions: d.transactions.map((t) => {
        if (t.accountID !== id && t.fromAccountID !== id && t.toAccountID !== id) return t
        const copy = { ...t }
        if (copy.accountID === id) delete copy.accountID
        if (copy.fromAccountID === id) { delete copy.fromAccountID; delete copy.fromAccount }
        if (copy.toAccountID === id) { delete copy.toAccountID; delete copy.toAccount }
        return copy
      }),
    })),

    resetToSampleData: () => update((d) => ({ ...d, ...sampleData() })),
    eraseAll: () => update((d) => ({ ...emptyData(), displayCurrency: d.displayCurrency, rates: d.rates })),
    replaceAll: (next) => commit(next),
  }), [data, now, saveError, loadError, appearance, sync, newTransactionRequested, converter, update, commit])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const s = useContext(StoreContext)
  if (!s) throw new Error('useStore must be used inside StoreProvider')
  return s
}
