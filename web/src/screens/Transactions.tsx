import { useCallback, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useStore } from '../state/store'
import {
  balanceOf, CATEGORIES, categoryMeta, convert, dayLabel, expenseCategories, frequentCategories, inDisplay, incomeCategories,
  isDebtPayment, isLoanReceived, isSameDay, isSpending, money, monthExpense, monthIncome, newID, parseISO, signedAmount, startOfDay,
  toISO, toDateInputValue, parseStatement, readXlsxRows, StatementFormatError, XlsxError,
  type Account, type Category, type CurrencyCode, type StatementRow, type Transaction, type TransactionKind,
} from '../core'
import {
  AmountInput, Button, Card, CategoryBadge, CategoryChips, ConfirmDialog, CurrencySelect, DayPicker, EmptyState, Field, Icon, Page,
  Segmented, Select, Sheet, TextInput,
} from '../ui'
import { displayAmount, signedDisplay } from './Dashboard'
import { ImportStatementSheet } from './ImportStatement'
import { t } from '../i18n'
import { categoryLabel, transactionTitle } from '../i18n/labels'

// ---------- Shared helpers ----------

/** "Today"/"Yesterday" read mid-sentence in lower case; dates stay as they are. */
const relativeDay = (label: string) => (label === t('Today') || label === t('Yesterday') ? label.toLocaleLowerCase() : label)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
const shortcutLabel = isMac ? '⌘N' : 'Ctrl+N'

/** Amounts must be finite, above zero and below 1e15 (beyond that doubles lose cents). */
export function amountError(amount: number | null, text: string): string | undefined {
  if (amount === null) return text.trim() ? t('Enter a number, like 125,000.') : undefined
  if (!Number.isFinite(amount) || amount <= 0) return t('Enter an amount greater than zero.')
  if (amount >= 1e15) return t('That amount is too large.')
  return undefined
}

function isValidAmount(amount: number | null): amount is number {
  return amount !== null && Number.isFinite(amount) && amount > 0 && amount < 1e15
}

/** Each opening bumps `key`, so the sheet remounts with fresh state; closing keeps it mounted so focus returns. */
export function useSheetSession<T>() {
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
function kindMatches(filter: KindFilter, tx: Transaction): boolean {
  switch (filter) {
    case 'all': return true
    case 'income': return tx.kind === 'income' || isLoanReceived(tx)
    case 'expense': return isSpending(tx)
    case 'transfers': return tx.kind === 'transfer'
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
      if (rows.length === 0) throw new StatementFormatError(t('This statement has no transactions in it.'))
      importer.show(rows)
    } catch (err) {
      setImportError(err instanceof XlsxError || err instanceof StatementFormatError ? t(err.message) : t('That file couldn’t be read.'))
    }
  }
  const [pendingDeletion, setPendingDeletion] = useState<Transaction | null>(null)

  // New entries open in the app-wide sheet (the add button, ⌘N); this screen's sheet edits existing ones.
  const { requestNewTransaction } = useStore()

  const count = data.transactions.length
  const net = monthIncome(data, now) - monthExpense(data, now)
  const subtitle = t('{amount} net this month', { amount: `${net > 0 ? '+' : ''}${money(net, dc)}` })

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return data.transactions.filter((tx) => {
      if (!kindMatches(kindFilter, tx)) return false
      if (categoryFilter && tx.category !== categoryFilter) return false
      if (!query) return true
      return tx.title.toLocaleLowerCase().includes(query)
        || tx.note.toLocaleLowerCase().includes(query)
        || categoryLabel(tx.category).toLocaleLowerCase().includes(query)
    })
  }, [data.transactions, search, kindFilter, categoryFilter])

  /** Bucketed by local calendar day, newest day first; store order (newest first) kept inside each day. */
  const groups = useMemo(() => {
    const map = new Map<string, { day: Date; items: Transaction[] }>()
    for (const tx of filtered) {
      const day = startOfDay(parseISO(tx.date))
      const key = toDateInputValue(day)
      const g = map.get(key)
      if (g) g.items.push(tx)
      else map.set(key, { day, items: [tx] })
    }
    return [...map.values()].sort((a, b) => b.day.getTime() - a.day.getTime())
  }, [filtered])

  const dayTotal = (items: Transaction[]) => {
    // Debt payments are net-worth neutral but the user counts them as money out for the day.
    const total = items.reduce((sum, tx) => sum + inDisplay(data, isDebtPayment(tx) ? -tx.amount : signedAmount(tx), tx.currency), 0)
    const formatted = money(total, dc)
    return total > 0 ? `+${formatted}` : formatted
  }

  return (
    <Page
      title={t('Monitoring')}
      subtitle={subtitle}
      actions={
        <>
        <input ref={fileInput} type="file" hidden accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onStatementPicked} />
        <Button icon="upload" onClick={() => fileInput.current?.click()}>{t('Import…')}</Button>
        <Button variant="primary" icon="plus" className="wide-only" onClick={() => requestNewTransaction(true)} aria-keyshortcuts={isMac ? 'Meta+N' : 'Control+N'} title={t('Add transaction ({shortcut})', { shortcut: shortcutLabel })}>
          {t('Add transaction')}
        </Button>
        </>
      }
    >
      {importError && (
        <div className="banner" role="alert">
          <Icon name="alert-circle" size={16} />
          <span className="grow">{importError}</span>
          <Button size="sm" onClick={() => setImportError(null)}>{t('Dismiss')}</Button>
        </div>
      )}
      {importedCount !== null && (
        <div className="banner banner-neutral" role="status">
          <Icon name="check" size={16} />
          <span className="grow">{t('Imported {n} transaction.|Imported {n} transactions.', { n: importedCount })}</span>
          <Button size="sm" onClick={() => setImportedCount(null)}>{t('Dismiss')}</Button>
        </div>
      )}
      <Card className="card-small">
        <div className="row row-wrap" style={{ alignItems: 'flex-end', gap: 'var(--space-3)' }}>
          <div className="grow" style={{ flexBasis: 220 }}>
            <Field label={t('Search')}>
              {(id) => (
                <div style={{ position: 'relative' }}>
                  <span className="faint" style={{ position: 'absolute', insetInlineStart: 12, top: '50%', translate: '0 -50%', display: 'flex', pointerEvents: 'none' }}>
                    <Icon name="search" size={15} strokeWidth={2} />
                  </span>
                  <TextInput
                    id={id}
                    type="text"
                    value={search}
                    placeholder={t('Search transactions')}
                    autoComplete="off"
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape' && search) { e.preventDefault(); setSearch('') } }}
                    style={{ paddingInlineStart: 34, paddingInlineEnd: search ? 42 : 12 }}
                  />
                  {search && (
                    <Button variant="ghost" iconOnly icon="x" onClick={() => setSearch('')}
                      style={{ position: 'absolute', insetInlineEnd: 2, top: '50%', translate: '0 -50%' }}>
                      {t('Clear search')}
                    </Button>
                  )}
                </div>
              )}
            </Field>
          </div>
          <div className="field" style={{ maxWidth: '100%' }}>
            <span className="field-label" aria-hidden="true">{t('Kind')}</span>
            <div style={{ maxWidth: '100%', overflowX: 'auto' }}>
              <Segmented label={t('Kind')} options={kindFilterOptions.map((o) => ({ ...o, label: t(o.label) }))} value={kindFilter} onChange={setKindFilter} />
            </div>
          </div>
          <div style={{ flex: '1 1 160px', maxWidth: 240 }}>
            <Field label={t('Category')}>
              {(id) => (
                <Select id={id} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as Category | '')}>
                  <option value="">{t('All categories')}</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </Select>
              )}
            </Field>
          </div>
        </div>
      </Card>

      {groups.length === 0 ? (
        <Card>
          {count === 0
            ? <EmptyState icon="list-checks" title={t('No transactions yet')} message={t('Tap + to record your first income or expense.')} />
            : (
              <EmptyState icon="search" title={t('No matching transactions')} message={t('Try a different search, or broaden the kind and category filters.')}>
                <Button onClick={() => { setSearch(''); setKindFilter('all'); setCategoryFilter('') }}>{t('Clear filters')}</Button>
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
                {g.items.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} onEdit={() => editor.show(tx)} />
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
        <TransactionEditorSheet key={editor.key} open={editor.open} editing={editor.item} onClose={editor.hide}
          onDelete={editor.item ? () => { const tx = editor.item; editor.hide(); setPendingDeletion(tx) } : undefined} />
      )}

      <ConfirmDialog
        open={pendingDeletion !== null}
        title={t('Delete transaction?')}
        message={pendingDeletion
          ? t('{amount} from {day} will be removed. This cannot be undone.', { amount: money(pendingDeletion.amount, pendingDeletion.currency), day: relativeDay(dayLabel(parseISO(pendingDeletion.date), now)) })
          : ''}
        confirmTitle={pendingDeletion ? t('Delete “{name}”', { name: transactionTitle(pendingDeletion) }) : t('Delete')}
        onConfirm={() => { if (pendingDeletion) deleteTransaction(pendingDeletion.id) }}
        onClose={() => setPendingDeletion(null)}
      />
    </Page>
  )
}

// ---------- Row ----------

function TransactionRow({ tx, onEdit }: { tx: Transaction; onEdit: () => void }) {
  const { data } = useStore()
  const dc = data.displayCurrency
  const accountName = (id?: string) => (id ? data.accounts.find((a) => a.id === id)?.name : undefined)

  let detail: string
  if (tx.kind === 'transfer') {
    const from = accountName(tx.fromAccountID) ?? tx.fromAccount ?? t('Unlinked')
    const to = accountName(tx.toAccountID) ?? tx.toAccount ?? t('Unlinked')
    const received = tx.toAmount != null && tx.toCurrency ? ` · ${t('received {amount}', { amount: money(tx.toAmount, tx.toCurrency) })}` : ''
    detail = `${from} → ${to}${received}`
  } else {
    // A transaction saved without a note is titled after its category; don't say it twice.
    const parts = tx.title === categoryMeta[tx.category].title ? [] : [categoryLabel(tx.category)]
    const acc = accountName(tx.accountID)
    if (acc) parts.push(acc)
    detail = parts.join(' · ')
  }
  if (tx.note) detail = detail ? `${detail} · ${tx.note}` : tx.note

  const { text, tone } = signedDisplay(tx, money(displayAmount(data, tx), dc))

  // The whole row opens the editor (Delete lives there), so the name gets the row's full width.
  return (
    <button type="button" className="list-row row-button" onClick={onEdit}>
      <CategoryBadge category={tx.category} size={38} />
      <span className="row-main row-grid">
        <span className="row-title truncate" style={{ gridArea: 'title' }}>{transactionTitle(tx)}</span>
        <span className={`row-value num ${tone}`} style={{ gridArea: 'value' }}>{text}</span>
        <span className="row-detail truncate" style={{ gridArea: 'detail' }}>{detail}</span>
        {tx.currency !== dc && <span className="row-detail num row-foreign" style={{ gridArea: 'foreign' }}>{money(tx.amount, tx.currency)}</span>}
      </span>
    </button>
  )
}

// ---------- Add / Edit sheet ----------

const NEW = '__new__'

const kindOptions: { value: TransactionKind; label: string; tone?: 'income' | 'expense' }[] = [
  { value: 'income', label: 'Income', tone: 'income' },
  { value: 'expense', label: 'Expense', tone: 'expense' },
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

function initialState(tx: Transaction | null, accounts: Account[], favourite: Category): Initial {
  const exists = (id?: string) => (id && accounts.some((a) => a.id === id) ? id : '')
  // A stale or no-longer-debt link starts empty, so the user must pick a real debt.
  const debt = (id?: string) => (id && accounts.some((a) => a.id === id && a.kind === 'debt') ? id : '')
  if (tx && isDebtPayment(tx)) {
    // Debt payments re-open in the expense form they were created from.
    return { kind: 'expense', category: 'debtPayment', accountID: exists(tx.fromAccountID), debtAccountID: debt(tx.toAccountID), fromAccountID: '', toAccountID: '' }
  }
  if (tx && isLoanReceived(tx)) {
    // Borrowings re-open in the income form they were created from.
    return { kind: 'income', category: 'loanReceived', accountID: exists(tx.toAccountID), debtAccountID: debt(tx.fromAccountID), fromAccountID: '', toAccountID: '' }
  }
  // New entries default to the first regular account, so money comes from somewhere unless the user says otherwise.
  const firstRegular = accounts.find((a) => a.kind === 'regular')?.id ?? ''
  return {
    kind: tx?.kind ?? 'expense',
    category: tx?.category ?? favourite,
    accountID: tx ? exists(tx.accountID) : firstRegular,
    fromAccountID: exists(tx?.fromAccountID),
    toAccountID: exists(tx?.toAccountID),
    debtAccountID: '',
  }
}

export function TransactionEditorSheet({ open, editing, onClose, onDelete }: { open: boolean; editing: Transaction | null; onClose: () => void; onDelete?: () => void }) {
  const { data, now, addTransaction, updateTransaction, createAccount } = useStore()
  const accounts = data.accounts
  const [init] = useState(() => initialState(editing, accounts, frequentCategories(data.transactions, 'expense', expenseCategories, 1)[0] ?? 'groceries'))
  /** The day is picked; the time of day comes from the original entry, or from the moment the sheet opened. */
  const [timeSource] = useState(() => (editing ? parseISO(editing.date) : new Date()))

  // The note doubles as the title. Untitled entries are stored under their category's name, so that reads as "no note".
  const [title, setTitle] = useState(() => (editing && editing.title !== categoryMeta[editing.category].title ? editing.title : ''))
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
  const [day, setDay] = useState(() => startOfDay(timeSource))
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
  const accountRowLabel = isDebtPaymentEntry ? t('From account') : isLoanEntry ? t('Deposit to') : t('Account')

  const availableCategories = useMemo(() => {
    let list = kind === 'income' ? incomeCategories : expenseCategories
    // "Debt payment" only makes sense once a debt account exists — unless this entry already is one.
    if (debtAccounts.length === 0 && category !== 'debtPayment') list = list.filter((c) => c !== 'debtPayment')
    return list
  }, [kind, category, debtAccounts.length])
  // The five the user picks most often come first; the rest sit behind "More".
  const topCategories = useMemo(
    () => (kind === 'transfer' ? [] : frequentCategories(data.transactions, kind, availableCategories, 5)),
    [data.transactions, kind, availableCategories],
  )

  const changeKind = (next: TransactionKind) => {
    setKind(next)
    if (next === 'transfer') setCategory('transfer')
    else if (next !== kind) {
      const list = next === 'income' ? incomeCategories : expenseCategories
      if (!list.includes(category)) setCategory(frequentCategories(data.transactions, next, list, 1)[0] ?? list[0])
    }
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
  const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds())
  const chosenDebt = debtAccounts.find((a) => a.id === debtAccountID)
  const chosenAccount = find(accountID)
  const newDebtTrimmed = newDebtName.trim()
  const newDebtClash = debtAccountID === NEW && newDebtTrimmed !== ''
    ? accounts.find((a) => a.name.localeCompare(newDebtTrimmed, undefined, { sensitivity: 'accent' }) === 0)
    : undefined

  let debtError: string | undefined
  if (isDebtPaymentEntry && debtAccounts.length === 0) debtError = t('No debt accounts left. Choose another category.')
  else if (staleDebt && needsRealAccount && debtAccountID === '') debtError = t('The debt this was linked to no longer exists. Choose another, or change the category.')
  if (newDebtClash) debtError = t('You already have an account named “{name}”.', { name: newDebtClash.name })

  let accountError: string | undefined
  if (needsRealAccount && regularAccounts.length === 0) accountError = t('Add a regular account in Accounts first.')

  // The destination account when it holds a different currency than the amount typed.
  const destination = kind === 'transfer' ? find(toAccountID) : undefined
  const crossCurrency = destination && destination.currency !== currency ? destination : undefined
  const suggestedReceived = crossCurrency ? convert(data.rates, amount ?? 0, currency, crossCurrency.currency) : 0
  const receivedErr = crossCurrency && receivedEdited && !isValidAmount(received) ? t('Enter the amount that arrived, above 0.') : undefined

  const canSave = (() => {
    if (!isValidAmount(amount)) return false
    if (kind === 'transfer') return resolvedFrom !== '' && resolvedTo !== '' && !sameEndpoints && !receivedErr
    if (needsRealAccount && (!chosenAccount || chosenAccount.kind !== 'regular')) return false
    if (isDebtPaymentEntry) return chosenDebt !== undefined
    if (isLoanEntry) return debtAccountID === NEW ? newDebtTrimmed !== '' && !newDebtClash : chosenDebt !== undefined
    return true
  })()

  const save = () => {
    if (!isValidAmount(amount)) return
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
      title: trimmedTitle || categoryMeta[storedCategory].title,
      amount,
      currency,
      category: storedCategory,
      kind: storedKind,
      // Keep the original timestamp (with its seconds) when the date wasn't touched.
      date: editing && isSameDay(day, timeSource) ? editing.date : toISO(date),
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
    <Sheet open={open} title={editing ? t('Edit transaction') : t('New transaction')} saveTitle={editing ? t('Save') : t('Add')} canSave={canSave} onSave={save} onClose={onClose}>
      <Field label={t('Amount')} error={amountErr}>
        {(id, describedBy) => (
          <div className="input-row">
            <AmountInput id={id} value={amount} onChange={setAmount} onInput={(e) => setAmountText(e.currentTarget.value)}
              aria-describedby={describedBy} aria-invalid={amountErr ? true : undefined} />
            <CurrencySelect value={currency} onChange={setCurrency} ariaLabel={t('Currency')} />
          </div>
        )}
      </Field>

      <div className="field">
        <span className="field-label" aria-hidden="true">{t('Kind')}</span>
        <Segmented label={t('Kind')} block options={kindOptions.map((o) => ({ ...o, label: t(o.label) }))} value={kind} onChange={changeKind} />
      </div>

      {kind === 'transfer' ? (
        <>
          <EndpointPicker label={t('From account')} nameLabel={t('From account name')} value={fromAccountID} onChange={pickFrom} newName={newFromName} onNewName={setNewFromName} accounts={accounts} />
          <EndpointPicker label={t('To account')} nameLabel={t('To account name')} value={toAccountID} onChange={setToAccountID} newName={newToName} onNewName={setNewToName} accounts={accounts}
            error={sameEndpoints ? t('Choose two different accounts.') : undefined} />
          {crossCurrency && (
            <Field label={t('Amount received')} error={receivedErr}
              hint={t('{account} is in {currency}. At your current rate that’s {amount}; edit it to what the bank actually credited.', { account: crossCurrency.name, currency: crossCurrency.currency, amount: money(suggestedReceived, crossCurrency.currency) })}>
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
          <div className="field">
            <span className="field-label" aria-hidden="true">{t('Category')}</span>
            <CategoryChips label={t('Category')} top={topCategories} all={availableCategories} value={category} onChange={changeCategory}
              tone={kind === 'income' ? 'income' : 'expense'} />
          </div>

          {isDebtPaymentEntry && (
            <Field label={t('Pay toward')} error={debtError}>
              {(id, describedBy) => (
                <div className="stack-tight">
                  <Select id={id} value={debtAccountID} onChange={(e) => setDebtAccountID(e.target.value)} aria-describedby={describedBy}>
                    <option value="">{t('Choose debt…')}</option>
                    {debtAccounts.map((d) => (
                      <option key={d.id} value={d.id}>{t('{name}, {amount} left', { name: d.name, amount: money(Math.abs(balanceOf(data, d)), d.currency) })}</option>
                    ))}
                  </Select>
                  {chosenDebt && remaining > 0 && (
                    <Button variant="link" className="num" style={{ minHeight: 36, alignSelf: 'flex-start' }}
                      onClick={() => { setAmount(remaining); setAmountText(String(remaining)); setCurrency(chosenDebt.currency) }}>
                      {t('Pay in full: {amount}', { amount: money(remaining, chosenDebt.currency) })}
                    </Button>
                  )}
                </div>
              )}
            </Field>
          )}

          {isLoanEntry && (
            <>
              <Field label={t('From debt')} error={debtAccountID === NEW ? undefined : debtError}>
                {(id, describedBy) => (
                  <Select id={id} value={debtAccountID} onChange={(e) => setDebtAccountID(e.target.value)} aria-describedby={describedBy}>
                    <option value="">{t('Choose debt…')}</option>
                    {debtAccounts.map((d) => (
                      <option key={d.id} value={d.id}>{t('{name}, owes {amount}', { name: d.name, amount: money(Math.abs(Math.min(0, balanceOf(data, d))), d.currency) })}</option>
                    ))}
                    <option value={NEW}>{t('New debt…')}</option>
                  </Select>
                )}
              </Field>
              {debtAccountID === NEW && (
                <Field label={t('Debt name')} error={debtError}>
                  {(id, describedBy) => (
                    <TextInput id={id} value={newDebtName} placeholder={t('e.g. Bank loan')} autoComplete="off" onChange={(e) => setNewDebtName(e.target.value)}
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
                  <option value="">{needsRealAccount ? t('Choose account…') : t('None')}</option>
                  {accountOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              )}
            </Field>
          )}
        </>
      )}

      <div className="field">
        <span className="field-label" aria-hidden="true">{t('Date')}</span>
        <DayPicker label={t('Date')} value={day} onChange={setDay} now={now} />
      </div>

      <Field label={t('Note')}>
        {(id) => <TextInput id={id} value={title} placeholder={t('Optional')} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />}
      </Field>

      {onDelete && (
        <Button variant="danger" icon="trash" onClick={onDelete} style={{ alignSelf: 'flex-start' }}>{t('Delete transaction')}</Button>
      )}

      {/* Older and imported entries can carry extra details; keep them editable rather than hidden. */}
      {editing?.note && (
        <Field label={t('Details')}>
          {(id) => <TextInput id={id} value={note} placeholder={t('Optional')} autoComplete="off" onChange={(e) => setNote(e.target.value)} />}
        </Field>
      )}
    </Sheet>
  )
}

/** Transfer endpoint picker: existing accounts + "New account…", which reveals a name field. */
function EndpointPicker({ label, nameLabel, value, onChange, newName, onNewName, accounts, error }: {
  label: string; nameLabel: string; value: string; onChange: (v: string) => void; newName: string; onNewName: (v: string) => void; accounts: Account[]; error?: string
}) {
  const isNew = value === NEW
  return (
    <>
      <Field label={label} error={isNew ? undefined : error}>
        {(id, describedBy) => (
          <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
            <option value="">{t('Choose…')}</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value={NEW}>{t('New account…')}</option>
          </Select>
        )}
      </Field>
      {isNew && (
        <Field label={nameLabel} error={error}>
          {(id, describedBy) => (
            <TextInput id={id} value={newName} placeholder={t('e.g. Kapital Visa')} autoComplete="off" onChange={(e) => onNewName(e.target.value)}
              aria-describedby={describedBy} aria-invalid={error ? true : undefined} />
          )}
        </Field>
      )}
    </>
  )
}
