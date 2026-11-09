import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useStore } from '../state/store'
import {
  balanceOf, CATEGORIES, categoryMeta, convert, dayLabel, expenseCategories, fromDateTimeInputValue, inDisplay, incomeCategories,
  isDebtPayment, isLoanReceived, isSpending, money, monthExpense, monthIncome, newID, parseISO, signedAmount, startOfDay,
  toDateTimeInputValue, toISO, toDateInputValue, parseStatement, readXlsxRows, StatementFormatError, XlsxError,
  type Account, type Category, type CurrencyCode, type StatementRow, type Transaction, type TransactionKind,
} from '../core'
import {
  AmountInput, Button, Card, CategoryBadge, ConfirmDialog, CurrencySelect, EmptyState, Field, Icon, Menu, Page,
  Segmented, Select, Sheet, TextInput,
} from '../ui'
import { displayAmount, signedDisplay } from './Dashboard'
import { ImportStatementSheet } from './ImportStatement'

// ---------- Shared helpers ----------

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const shortcutLabel = isMac ? '⌘N' : 'Ctrl+N'

/** Amounts must be finite, above zero and below 1e15 (beyond that doubles lose cents). */
export function amountError(amount: number | null, text: string): string | undefined {
  if (amount === null) return text.trim() ? 'Enter a number, like 125 000.' : undefined
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter an amount greater than zero.'
  if (amount >= 1e15) return 'That amount is too large.'
  return undefined
}

function isValidAmount(amount: number | null): amount is number {
  return amount !== null && Number.isFinite(amount) && amount > 0 && amount < 1e15
}

/** Each opening bumps `key`, so the sheet remounts with fresh state; closing keeps it mounted so focus returns. */
function useSheetSession<T>() {
  const [s, setS] = useState<{ open: boolean; item: T | null; key: number }>({ open: false, item: null, key: 0 })
  const show = useCallback((item: T | null) => setS((p) => ({ open: true, item, key: p.key + 1 })), [])
  const hide = useCallback(() => setS((p) => ({ ...p, open: false })), [])
  return { ...s, show, hide }
}

type KindFilter = 'all' | 'income' | 'expense' | 'transfers'

const kindFilterOptions: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfers', label: 'Transfers' },
]

/** Debt payments live under BOTH Expense (spending to the user) and Transfers (their ledger form). */
function kindMatches(filter: KindFilter, t: Transaction): boolean {
  switch (filter) {
    case 'all': return true
    case 'income': return t.kind === 'income' || isLoanReceived(t)
    case 'expense': return isSpending(t)
    case 'transfers': return t.kind === 'transfer'
  }
}

// ---------- Screen ----------

export function TransactionsScreen() {
  const { data, now, deleteTransaction } = useStore()
  const dc = data.displayCurrency
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<Category | ''>('')
  const editor = useSheetSession<Transaction>()
  const importer = useSheetSession<StatementRow[]>()
  const fileInput = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [importedCount, setImportedCount] = useState<number | null>(null)

  const onStatementPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still fires
    if (!file) return
    setImportError(null)
    setImportedCount(null)
    try {
      const rows = parseStatement(await readXlsxRows(new Uint8Array(await file.arrayBuffer())))
      if (rows.length === 0) throw new StatementFormatError('This statement has no transactions in it.')
      importer.show(rows)
    } catch (err) {
      setImportError(err instanceof XlsxError || err instanceof StatementFormatError ? err.message : 'That file couldn’t be read.')
    }
  }
  const [pendingDeletion, setPendingDeletion] = useState<Transaction | null>(null)

  // ⌘N / Ctrl+N adds a transaction while this screen is shown; the global shortcut
  // from other screens lands here with `newTransactionRequested` set.
  const showEditor = editor.show
  const { newTransactionRequested, requestNewTransaction } = useStore()
  useEffect(() => {
    if (!newTransactionRequested) return
    requestNewTransaction(false)
    showEditor(null)
  }, [newTransactionRequested, requestNewTransaction, showEditor])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'n') return
      const active = document.activeElement as HTMLElement | null
      if (active && (active.matches('input, textarea, select') || active.isContentEditable)) return
      if (document.querySelector('dialog[open]')) return
      e.preventDefault()
      showEditor(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showEditor])

  const count = data.transactions.length
  const net = monthIncome(data, now) - monthExpense(data, now)
  const subtitle = `${count === 1 ? '1 transaction' : `${count} transactions`} · ${net > 0 ? '+' : ''}${money(net, dc)} net this month`

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return data.transactions.filter((t) => {
      if (!kindMatches(kindFilter, t)) return false
      if (categoryFilter && t.category !== categoryFilter) return false
      if (!query) return true
      return t.title.toLocaleLowerCase().includes(query)
        || t.note.toLocaleLowerCase().includes(query)
        || categoryMeta[t.category].title.toLocaleLowerCase().includes(query)
    })
  }, [data.transactions, search, kindFilter, categoryFilter])

  /** Bucketed by local calendar day, newest day first; store order (newest first) kept inside each day. */
  const groups = useMemo(() => {
    const map = new Map<string, { day: Date; items: Transaction[] }>()
    for (const t of filtered) {
      const day = startOfDay(parseISO(t.date))
      const key = toDateInputValue(day)
      const g = map.get(key)
      if (g) g.items.push(t)
      else map.set(key, { day, items: [t] })
    }
    return [...map.values()].sort((a, b) => b.day.getTime() - a.day.getTime())
  }, [filtered])

  const dayTotal = (items: Transaction[]) => {
    // Debt payments are net-worth neutral but the user counts them as money out for the day.
    const total = items.reduce((sum, t) => sum + inDisplay(data, isDebtPayment(t) ? -t.amount : signedAmount(t), t.currency), 0)
    const formatted = money(total, dc)
    return total > 0 ? `+${formatted}` : formatted
  }

  return (
    <Page
      title="Transactions"
      subtitle={subtitle}
      actions={
        <>
        <input ref={fileInput} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onStatementPicked} />
        <Button icon="upload" onClick={() => fileInput.current?.click()}>Import…</Button>
        <Button variant="primary" icon="plus" onClick={() => editor.show(null)} aria-keyshortcuts={isMac ? 'Meta+N' : 'Control+N'} title={`Add Transaction (${shortcutLabel})`}>
          Add Transaction
        </Button>
        </>
      }
    >
      {importError && (
        <div className="banner" role="alert">
          <Icon name="alert-circle" size={16} />
          <span className="grow">{importError}</span>
          <Button size="sm" onClick={() => setImportError(null)}>Dismiss</Button>
        </div>
      )}
      {importedCount !== null && (
        <div className="banner banner-neutral" role="status">
          <Icon name="check" size={16} />
          <span className="grow">Imported {importedCount} {importedCount === 1 ? 'transaction' : 'transactions'}.</span>
          <Button size="sm" onClick={() => setImportedCount(null)}>Dismiss</Button>
        </div>
      )}
      <Card className="card-small">
        <div className="row row-wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <div className="grow" style={{ flexBasis: 220 }}>
            <Field label="Search">
              {(id) => (
                <div style={{ position: 'relative' }}>
                  <span className="faint" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', translate: '0 -50%', display: 'flex', pointerEvents: 'none' }}>
                    <Icon name="search" size={15} strokeWidth={2} />
                  </span>
                  <TextInput
                    id={id}
                    type="text"
                    value={search}
                    placeholder="Search transactions"
                    autoComplete="off"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape' && search) { e.preventDefault(); setSearch('') } }}
                    style={{ paddingInlineStart: 34, paddingInlineEnd: search ? 42 : 12 }}
                  />
                  {search && (
                    <Button variant="ghost" iconOnly icon="x" onClick={() => setSearch('')}
                      style={{ position: 'absolute', insetInlineEnd: 2, top: '50%', translate: '0 -50%' }}>
                      Clear search
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>
          <div className="field" style={{ maxWidth: '100%' }}>
            <span className="field-label" aria-hidden="true">Kind</span>
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
              <Segmented label="Kind" options={kindFilterOptions} value={kindFilter} onChange={setKindFilter} />
            </div>
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 240 }}>
            <Field label="Category">
              {(id) => (
                <Select id={id} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | '')}>
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{categoryMeta[c].title}</option>)}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card>
          {count === 0
            ? <EmptyState icon="list-checks" title="No transactions yet" message={`Record your first income or expense with Add Transaction (${shortcutLabel}).`} />
            : (
              <EmptyState icon="search" title="No matching transactions" message="Try a different search, or broaden the kind and category filters.">
                <Button onClick={() => { setSearch(''); setKindFilter('all'); setCategoryFilter('') }}>Clear filters</Button>
              </EmptyState>
            )}
        </Card>
      ) : (
        groups.map((g) => (
          <section key={toDateInputValue(g.day)} className="stack" aria-label={dayLabel(g.day, now)}>
            <div className="section-head">
              <h2>{dayLabel(g.day, now)}</h2>
              <span className="caption num">{dayTotal(g.items)}</span>
            </div>
            <Card>
              <div className="list">
                {g.items.map((t) => (
                  <TransactionRow key={t.id} t={t} onEdit={() => editor.show(t)} onDelete={() => setPendingDeletion(t)} />
                ))}
              </div>
            </Card>
          </section>
        ))
      )}

      {importer.key > 0 && importer.item && (
        <ImportStatementSheet key={importer.key} open={importer.open} rows={importer.item} onClose={importer.hide} onImported={setImportedCount} />
      )}
      {editor.key > 0 && (
        <TransactionEditorSheet key={editor.key} open={editor.open} editing={editor.item} onClose={editor.hide} />
      )}

      <ConfirmDialog
        open={pendingDeletion !== null}
        title="Delete Transaction?"
        message={pendingDeletion
          ? `${money(pendingDeletion.amount, pendingDeletion.currency)} from ${dayLabel(parseISO(pendingDeletion.date), now)} will be removed. This cannot be undone.`
          : ''}
        confirmTitle={pendingDeletion ? `Delete “${pendingDeletion.title}”` : 'Delete'}
        onConfirm={() => { if (pendingDeletion) deleteTransaction(pendingDeletion.id) }}
        onClose={() => setPendingDeletion(null)}
      />
    </Page>
  )
}

// ---------- Row ----------

function TransactionRow({ t, onEdit, onDelete }: { t: Transaction; onEdit: () => void; onDelete: () => void }) {
  const { data } = useStore()
  const dc = data.displayCurrency
  const accountName = (id?: string) => (id ? data.accounts.find((a) => a.id === id)?.name : undefined)

  let detail: string
  if (t.kind === 'transfer') {
    const from = accountName(t.fromAccountID) ?? t.fromAccount ?? 'Unlinked'
    const to = accountName(t.toAccountID) ?? t.toAccount ?? 'Unlinked'
    const received = t.toAmount != null && t.toCurrency ? ` · received ${money(t.toAmount, t.toCurrency)}` : ''
    detail = `${from} → ${to}${received}`
  } else {
    detail = categoryMeta[t.category].title
    const acc = accountName(t.accountID)
    if (acc) detail += ` · ${acc}`
  }
  if (t.note) detail += ` · ${t.note}`

  const { text, tone } = signedDisplay(t, money(displayAmount(data, t), dc))

  return (
    <div className="list-row clickable" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onEdit() }}>
      <CategoryBadge category={t.category} size={38} />
      <div className="row-main">
        <span className="row-title truncate">{t.title}</span>
        <span className="row-detail truncate">{detail}</span>
      </div>
      <div className="row-amount">
        <span className={`primary num ${tone}`}>{text}</span>
        {t.currency !== dc && <span className="secondary num">{money(t.amount, t.currency)}</span>}
      </div>
      <Menu
        label={`Options for ${t.title}`}
        items={[
          { label: 'Edit', icon: 'pencil', onSelect: onEdit },
          { label: 'Delete', icon: 'trash', danger: true, onSelect: onDelete },
        ]}
      />
    </div>
  )
}

// ---------- Add / Edit sheet ----------

const NEW = '__new__'

const kindOptions: { value: TransactionKind; label: string }[] = [
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
  { value: 'transfer', label: 'Transfer' },
]

interface Initial {
  kind: TransactionKind
  category: Category
  accountID: string
  fromAccountID: string
  toAccountID: string
  debtAccountID: string
}

function initialState(t: Transaction | null, accounts: Account[]): Initial {
  const exists = (id?: string) => (id && accounts.some((a) => a.id === id) ? id : '')
  // A stale or no-longer-debt link starts empty, so the user must pick a real debt.
  const debt = (id?: string) => (id && accounts.some((a) => a.id === id && a.kind === 'debt') ? id : '')
  if (t && isDebtPayment(t)) {
    // Debt payments re-open in the expense form they were created from.
    return { kind: 'expense', category: 'debtPayment', accountID: exists(t.fromAccountID), debtAccountID: debt(t.toAccountID), fromAccountID: '', toAccountID: '' }
  }
  if (t && isLoanReceived(t)) {
    // Borrowings re-open in the income form they were created from.
    return { kind: 'income', category: 'loanReceived', accountID: exists(t.toAccountID), debtAccountID: debt(t.fromAccountID), fromAccountID: '', toAccountID: '' }
  }
  // New entries default to the first regular account, so money comes from somewhere unless the user says otherwise.
  const firstRegular = accounts.find((a) => a.kind === 'regular')?.id ?? ''
  return {
    kind: t?.kind ?? 'expense',
    category: t?.category ?? 'groceries',
    accountID: t ? exists(t.accountID) : firstRegular,
    fromAccountID: exists(t?.fromAccountID),
    toAccountID: exists(t?.toAccountID),
    debtAccountID: '',
  }
}

function TransactionEditorSheet({ open, editing, onClose }: { open: boolean; editing: Transaction | null; onClose: () => void }) {
  const { data, addTransaction, updateTransaction, createAccount } = useStore()
  const accounts = data.accounts
  const [init] = useState(() => initialState(editing, accounts))
  const [initialDateValue] = useState(() => toDateTimeInputValue(editing ? parseISO(editing.date) : new Date()))

  const [title, setTitle] = useState(editing?.title ?? '')
  const [amount, setAmount] = useState<number | null>(editing?.amount ?? null)
  const [amountText, setAmountText] = useState(editing ? String(editing.amount) : '')
  const [currency, setCurrency] = useState<CurrencyCode>(
    editing?.currency ?? accounts.find((a) => a.id === init.accountID)?.currency ?? data.displayCurrency,
  )
  /** Cross-currency transfer: what lands on the destination, in its currency. */
  const [received, setReceived] = useState<number | null>(editing?.toAmount ?? null)
  const [receivedEdited, setReceivedEdited] = useState(editing?.toAmount != null)
  // A new entry is usually typed in the chosen account's currency.
  const pickAccount = (id: string) => {
    setAccountID(id)
    if (!editing) { const a = accounts.find((x) => x.id === id); if (a) setCurrency(a.currency) }
  }
  const pickFrom = (id: string) => {
    setFromAccountID(id)
    if (!editing) { const a = accounts.find((x) => x.id === id); if (a) setCurrency(a.currency) }
  }
  const [kind, setKind] = useState<TransactionKind>(init.kind)
  const [category, setCategory] = useState<Category>(init.category)
  const [dateValue, setDateValue] = useState(initialDateValue)
  const [note, setNote] = useState(editing?.note ?? '')
  const [accountID, setAccountID] = useState(init.accountID)
  const [fromAccountID, setFromAccountID] = useState(init.fromAccountID)
  const [toAccountID, setToAccountID] = useState(init.toAccountID)
  const [debtAccountID, setDebtAccountID] = useState(init.debtAccountID)
  const [newFromName, setNewFromName] = useState('')
  const [newToName, setNewToName] = useState('')
  const [newDebtName, setNewDebtName] = useState('')
  // Editing a debt payment / loan whose debt was deleted: say so until the user picks something else.
  const [staleDebt, setStaleDebt] = useState(() => editing !== null && (isDebtPayment(editing) || isLoanReceived(editing)) && init.debtAccountID === '')

  const find = (id: string) => (id && id !== NEW ? accounts.find((a) => a.id === id) : undefined)
  const debtAccounts = accounts.filter((a) => a.kind === 'debt')
  const regularAccounts = accounts.filter((a) => a.kind === 'regular')

  const isDebtPaymentEntry = kind === 'expense' && category === 'debtPayment'
  const isLoanEntry = kind === 'income' && category === 'loanReceived'
  const needsRealAccount = isDebtPaymentEntry || isLoanEntry
  const accountRowLabel = isDebtPaymentEntry ? 'From account' : isLoanEntry ? 'Deposit to' : 'Account'

  const availableCategories = useMemo(() => {
    let list = kind === 'income' ? incomeCategories : expenseCategories
    // "Debt payment" only makes sense once a debt account exists — unless this entry already is one.
    if (debtAccounts.length === 0 && category !== 'debtPayment') list = list.filter((c) => c !== 'debtPayment')
    return list
  }, [kind, category, debtAccounts.length])

  const changeKind = (next: TransactionKind) => {
    setKind(next)
    if (next === 'transfer') setCategory('transfer')
    else if (next === 'income' && !incomeCategories.includes(category)) setCategory(incomeCategories[0])
    else if (next === 'expense' && !expenseCategories.includes(category)) setCategory(expenseCategories[0])
    setDebtAccountID('')
    setNewDebtName('')
    setStaleDebt(false)
  }
  const changeCategory = (next: Category) => {
    setCategory(next)
    setDebtAccountID('')
    setNewDebtName('')
    setStaleDebt(false)
  }

  // Transfer endpoints
  const endpointName = (sel: string, typed: string) => (sel === NEW ? typed.trim() : find(sel)?.name ?? '')
  const resolvedFrom = endpointName(fromAccountID, newFromName)
  const resolvedTo = endpointName(toAccountID, newToName)
  const sameEndpoints = resolvedFrom !== '' && resolvedFrom.localeCompare(resolvedTo, undefined, { sensitivity: 'accent' }) === 0

  // Validation
  const trimmedTitle = title.trim()
  const amountErr = amountError(amount, amountText)
  const date = fromDateTimeInputValue(dateValue)
  const chosenDebt = debtAccounts.find((a) => a.id === debtAccountID)
  const chosenAccount = find(accountID)
  const newDebtTrimmed = newDebtName.trim()
  const newDebtClash = debtAccountID === NEW && newDebtTrimmed !== ''
    ? accounts.find((a) => a.name.localeCompare(newDebtTrimmed, undefined, { sensitivity: 'accent' }) === 0)
    : undefined

  let debtError: string | undefined
  if (isDebtPaymentEntry && debtAccounts.length === 0) debtError = 'No debt accounts left. Choose another category.'
  else if (staleDebt && needsRealAccount && debtAccountID === '') debtError = 'The debt this was linked to no longer exists. Choose another, or change the category.'
  if (newDebtClash) debtError = `You already have an account named “${newDebtClash.name}”.`

  let accountError: string | undefined
  if (needsRealAccount && regularAccounts.length === 0) accountError = 'Add a regular account in Accounts first.'

  // The destination account when it holds a different currency than the amount typed.
  const destination = kind === 'transfer' ? find(toAccountID) : undefined
  const crossCurrency = destination && destination.currency !== currency ? destination : undefined
  const suggestedReceived = crossCurrency ? convert(data.rates, amount ?? 0, currency, crossCurrency.currency) : 0
  const receivedErr = crossCurrency && receivedEdited && !isValidAmount(received) ? 'Enter the amount that arrived, above 0.' : undefined

  const canSave = (() => {
    if (!trimmedTitle || !isValidAmount(amount) || !date) return false
    if (kind === 'transfer') return resolvedFrom !== '' && resolvedTo !== '' && !sameEndpoints && !receivedErr
    if (needsRealAccount && (!chosenAccount || chosenAccount.kind !== 'regular')) return false
    if (isDebtPaymentEntry) return chosenDebt !== undefined
    if (isLoanEntry) return debtAccountID === NEW ? newDebtTrimmed !== '' && !newDebtClash : chosenDebt !== undefined
    return true
  })()

  const save = () => {
    if (!isValidAmount(amount) || !date) return
    let storedKind: TransactionKind = kind
    let storedCategory: Category = kind === 'transfer' ? 'transfer' : category
    let from: Account | undefined
    let to: Account | undefined

    if (kind === 'transfer') {
      from = fromAccountID === NEW ? createAccount(newFromName, currency) : find(fromAccountID)
      to = toAccountID === NEW ? createAccount(newToName, currency) : find(toAccountID)
    } else if (isDebtPaymentEntry) {
      // A debt payment is a transfer under the hood: source account → debt account. Stats still count it as spending.
      storedKind = 'transfer'
      storedCategory = 'debtPayment'
      from = chosenAccount
      to = chosenDebt
    } else if (isLoanEntry) {
      // Borrowing: debt account → deposit account. Income stats untouched.
      storedKind = 'transfer'
      storedCategory = 'loanReceived'
      from = debtAccountID === NEW ? createAccount(newDebtName, currency, 'debt') : chosenDebt
      to = chosenAccount
    }

    const isTransferForm = storedKind === 'transfer'
    const transaction: Transaction = {
      id: editing?.id ?? newID(),
      title: trimmedTitle,
      amount,
      currency,
      category: storedCategory,
      kind: storedKind,
      // Keep the original timestamp (with its seconds) when the date wasn't touched.
      date: editing && dateValue === initialDateValue ? editing.date : toISO(date),
      note: note.trim(),
      // An edited bank row must stay recognised, or the next import would add it again.
      ...(editing?.importID ? { importID: editing.importID } : {}),
      ...(isTransferForm
        // Names duplicated for JSON readability + pre-account file compat.
        ? { fromAccountID: from?.id, toAccountID: to?.id, fromAccount: from?.name, toAccount: to?.name }
        : { accountID: accountID || undefined }),
      // Fix what arrived on a cross-currency transfer so a later rate edit never re-prices it.
      ...(crossCurrency && to && to.currency !== currency
        ? { toAmount: receivedEdited && received != null ? received : suggestedReceived, toCurrency: to.currency }
        : {}),
    }
    if (editing) updateTransaction(transaction)
    else addTransaction(transaction)
  }

  const accountOptions = (() => {
    const list = [...regularAccounts]
    // Keep an existing non-regular link visible rather than silently dropping it.
    const current = find(accountID)
    if (current && current.kind !== 'regular' && !needsRealAccount) list.push(current)
    return list
  })()

  const remaining = chosenDebt ? Math.abs(Math.min(0, balanceOf(data, chosenDebt))) : 0

  return (
    <Sheet open={open} title={editing ? 'Edit Transaction' : 'New Transaction'} saveTitle={editing ? 'Save' : 'Add'} canSave={canSave} onSave={save} onClose={onClose}>
      <Field label="Title">
        {(id) => <TextInput id={id} value={title} placeholder="What was it for?" autoComplete="off" onChange={(e) => setTitle(e.target.value)} />}
      </Field>

      <Field label="Amount" error={amountErr}>
        {(id, describedBy) => (
          <div className="input-row">
            <AmountInput id={id} value={amount} onChange={setAmount} onInput={(e) => setAmountText(e.currentTarget.value)}
              aria-describedby={describedBy} aria-invalid={amountErr ? true : undefined} />
            <CurrencySelect value={currency} onChange={setCurrency} ariaLabel="Currency" />
          </div>
        )}
      </Field>

      <div className="field">
        <span className="field-label" aria-hidden="true">Kind</span>
        <Segmented label="Kind" block options={kindOptions} value={kind} onChange={changeKind} />
      </div>

      {kind === 'transfer' ? (
        <>
          <EndpointPicker label="From account" value={fromAccountID} onChange={pickFrom} newName={newFromName} onNewName={setNewFromName} accounts={accounts} />
          <EndpointPicker label="To account" value={toAccountID} onChange={setToAccountID} newName={newToName} onNewName={setNewToName} accounts={accounts}
            error={sameEndpoints ? 'Choose two different accounts.' : undefined} />
          {crossCurrency && (
            <Field label="Amount received" error={receivedErr}
              hint={`${crossCurrency.name} is in ${crossCurrency.currency}. At your current rate that's ${money(suggestedReceived, crossCurrency.currency)}; edit it to what the bank actually credited.`}>
              {(id, describedBy) => (
                <div className="input-row" style={{ alignItems: 'center' }}>
                  <AmountInput id={id} value={receivedEdited ? received : suggestedReceived}
                    onChange={(v) => { setReceived(v); setReceivedEdited(true) }} aria-describedby={describedBy} aria-invalid={receivedErr ? true : undefined} />
                  <span className="muted" style={{ flex: 'none' }}>{crossCurrency.currency}</span>
                </div>
              )}
            </Field>
          )}
        </>
      ) : (
        <>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => changeCategory(e.target.value as Category)}>
                {availableCategories.map((c) => <option key={c} value={c}>{categoryMeta[c].title}</option>)}
              </Select>
            )}
          </Field>

          {isDebtPaymentEntry && (
            <Field label="Pay toward" error={debtError}>
              {(id, describedBy) => (
                <div className="stack-tight">
                  <Select id={id} value={debtAccountID} onChange={(e) => setDebtAccountID(e.target.value)} aria-describedby={describedBy}>
                    <option value="">Choose debt…</option>
                    {debtAccounts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} — {money(Math.abs(balanceOf(data, d)), d.currency)} left</option>
                    ))}
                  </Select>
                  {chosenDebt && remaining > 0 && (
                    <Button variant="link" className="num" style={{ minHeight: 36, alignSelf: 'flex-start' }}
                      onClick={() => { setAmount(remaining); setAmountText(String(remaining)); setCurrency(chosenDebt.currency) }}>
                      Pay in full — {money(remaining, chosenDebt.currency)}
                    </Button>
                  )}
                </div>
              )}
            </Field>
          )}

          {isLoanEntry && (
            <>
              <Field label="From debt" error={debtAccountID === NEW ? undefined : debtError}>
                {(id, describedBy) => (
                  <Select id={id} value={debtAccountID} onChange={(e) => setDebtAccountID(e.target.value)} aria-describedby={describedBy}>
                    <option value="">Choose debt…</option>
                    {debtAccounts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name} — owes {money(Math.abs(Math.min(0, balanceOf(data, d))), d.currency)}</option>
                    ))}
                    <option value={NEW}>New Debt…</option>
                  </Select>
                )}
              </Field>
              {debtAccountID === NEW && (
                <Field label="Debt name" error={debtError}>
                  {(id, describedBy) => (
                    <TextInput id={id} value={newDebtName} placeholder="e.g. Bank loan" autoComplete="off" onChange={(e) => setNewDebtName(e.target.value)}
                      aria-describedby={describedBy} aria-invalid={newDebtClash ? true : undefined} />
                  )}
                </Field>
              )}
            </>
          )}

          {(accounts.length > 0 || needsRealAccount) && (
            <Field label={accountRowLabel} error={accountError}>
              {(id, describedBy) => (
                <Select id={id} value={accountID} onChange={(e) => pickAccount(e.target.value)} aria-describedby={describedBy}>
                  {/* Debt payments and loans must move real money: no "None". */}
                  <option value="">{needsRealAccount ? 'Choose account…' : 'None'}</option>
                  {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              )}
            </Field>
          )}
        </>
      )}

      <Field label="Date" error={date ? undefined : 'Choose a date and time.'}>
        {(id, describedBy) => (
          <TextInput id={id} type="datetime-local" value={dateValue} onChange={(e) => setDateValue(e.target.value)}
            aria-describedby={describedBy} aria-invalid={date ? undefined : true} className="num" />
        )}
      </Field>

      <Field label="Note">
        {(id) => <TextInput id={id} value={note} placeholder="Optional details" autoComplete="off" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Sheet>
  )
}

/** Transfer endpoint picker: existing accounts + "New Account…", which reveals a name field. */
function EndpointPicker({ label, value, onChange, newName, onNewName, accounts, error }: {
  label: string; value: string; onChange: (v: string) => void; newName: string; onNewName: (v: string) => void; accounts: Account[]; error?: string
}) {
  const isNew = value === NEW
  return (
    <>
      <Field label={label} error={isNew ? undefined : error}>
        {(id, describedBy) => (
          <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
            <option value="">Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value={NEW}>New Account…</option>
          </Select>
        )}
      </Field>
      {isNew && (
        <Field label={`${label} name`} error={error}>
          {(id, describedBy) => (
            <TextInput id={id} value={newName} placeholder="e.g. Kapital Visa" autoComplete="off" onChange={(e) => onNewName(e.target.value)}
              aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
          )}
        </Field>
      )}
    </>
  )
}
