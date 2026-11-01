import { useCallback, useState } from 'react'
import { useStore } from '../state/store'
import {
  accountIcons, balanceOf, balancesByCurrency, convert, currencyMeta, fromDateInputValue, inDisplay, money, plainNumber,
  toDateInputValue, toISO, totalAccountsBalance,
  type Account, type AccountKind, type CurrencyCode,
} from '../core'
import {
  AmountInput, Button, Card, ConfirmDialog, CurrencySelect, EmptyState, Field, Icon, IconPicker, iconName, Menu, Page,
  Segmented, Select, Sheet, Switch, TextInput,
} from '../ui'
import { amountError } from './Transactions'

/** Each opening bumps `key`, so the sheet remounts with fresh state; closing keeps it mounted so focus returns. */
function useSheetSession<T>() {
  const [s, setS] = useState<{ open: boolean; item: T | null; key: number }>({ open: false, item: null, key: 0 })
  const show = useCallback((item: T | null) => setS((p) => ({ open: true, item, key: p.key + 1 })), [])
  const hide = useCallback(() => setS((p) => ({ ...p, open: false })), [])
  return { ...s, show, hide }
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0

/** Remaining debt as a positive number (0 when the debt is paid off or in credit). */
function owed(balance: number): number {
  return Math.abs(Math.min(0, balance))
}

/** Half of the currency's smallest displayed unit, so a typed "$100" can settle a $99.996 debt. */
function tolerance(currency: CurrencyCode): number {
  return 0.5 * 10 ** -currencyMeta[currency].fractionDigits
}

/** A picked calendar day at the current time of day, like a date-only DatePicker seeded with Date(). */
function dayAtNow(value: string): Date | null {
  const day = fromDateInputValue(value)
  if (!day) return null
  const now = new Date()
  day.setHours(now.getHours(), now.getMinutes(), now.getSeconds())
  return day
}

// ---------- Screen ----------

export function AccountsScreen() {
  const { data, deleteAccount } = useStore()
  const editor = useSheetSession<Account>()
  const pay = useSheetSession<Account>()
  const borrow = useSheetSession<Account>()
  const [pendingDeletion, setPendingDeletion] = useState<Account | null>(null)

  const accounts = data.accounts
  const excluded = accounts.filter((a) => !a.includeInTotal).length
  const caption = [
    `${accounts.length} account${accounts.length === 1 ? '' : 's'}`,
    // The converted total only adds information when more than one currency is counted.
    ...(balancesByCurrency(data).length > 1 ? [`≈ ${money(totalAccountsBalance(data), data.displayCurrency)} at your rates`] : []),
    ...(excluded > 0 ? [`${excluded} not counted`] : []),
  ].join(' · ')

  return (
    <Page
      title="Accounts"
      subtitle="Your money, where it lives"
      actions={<Button variant="primary" icon="plus" onClick={() => editor.show(null)}>Add Account</Button>}
    >
      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon="credit-card" title="No accounts yet"
            message="Add your cash, cards and bank accounts to see where your money lives. Transfers move balances between them." />
        </Card>
      ) : (
        <>
          <Card>
            <div className="stack-tight" style={{ gap: 6 }}>
              <span className="caption">Across all accounts</span>
              <div className="stat-number" style={{ fontSize: '1.875rem', overflowWrap: 'anywhere' }}>
                {balancesByCurrency(data).map((s) => money(s.amount, s.currency)).join('  |  ')}
              </div>
              <span className="micro faint num">{caption}</span>
            </div>
          </Card>

          <div className="grid grid-auto-280">
            {accounts.map((a) => (
              <AccountCard key={a.id} account={a}
                onEdit={() => editor.show(a)}
                onDelete={() => setPendingDeletion(a)}
                onPay={() => pay.show(a)}
                onBorrow={() => borrow.show(a)} />
            ))}
          </div>
        </>
      )}

      {editor.key > 0 && <AccountEditorSheet key={editor.key} open={editor.open} editing={editor.item} onClose={editor.hide} />}
      {pay.key > 0 && pay.item && <PayDebtSheet key={pay.key} open={pay.open} debtID={pay.item.id} fallback={pay.item} onClose={pay.hide} />}
      {borrow.key > 0 && borrow.item && <BorrowSheet key={borrow.key} open={borrow.open} debtID={borrow.item.id} fallback={borrow.item} onClose={borrow.hide} />}

      <ConfirmDialog
        open={pendingDeletion !== null}
        title="Delete Account?"
        message={pendingDeletion
          ? `Transactions and transfers that used “${pendingDeletion.name}” are kept, but lose their link to it. This cannot be undone.`
          : ''}
        confirmTitle={pendingDeletion ? `Delete “${pendingDeletion.name}”` : 'Delete'}
        onConfirm={() => { if (pendingDeletion) deleteAccount(pendingDeletion.id) }}
        onClose={() => setPendingDeletion(null)}
      />
    </Page>
  )
}

// ---------- Account card ----------

function AccountCard({ account, onEdit, onDelete, onPay, onBorrow }: {
  account: Account; onEdit: () => void; onDelete: () => void; onPay: () => void; onBorrow: () => void
}) {
  const { data, updateAccount } = useStore()
  const balance = balanceOf(data, account)
  const isDebt = account.kind === 'debt'
  const tint = isDebt ? 'var(--expense)' : 'var(--accent)'

  return (
    <div onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, label, select, a')) onEdit() }} style={{ minWidth: 0 }}>
      <Card>
        <div className="stack-tight" style={{ gap: 12 }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="badge" style={{ width: 34, height: 34, borderRadius: 10, ['--tint' as string]: tint }} aria-hidden="true">
              <Icon name={iconName(account.icon)} size={16} strokeWidth={2} />
            </span>
            <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <div className="row" style={{ gap: 6, minWidth: 0 }}>
                <span className="row-title truncate">{account.name}</span>
                {isDebt && (
                  <span className="chip chip-expense" style={{ padding: '1px 6px', fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', flex: 'none' }}>
                    Debt
                  </span>
                )}
              </div>
              <span className="micro muted">{currencyMeta[account.currency].flag} {account.currency}</span>
            </div>
            <Menu
              label={`Options for ${account.name}`}
              items={[
                { label: 'Edit Account', icon: 'pencil', onSelect: onEdit },
                ...(isDebt ? [{ label: 'Borrow More…', icon: 'arrow-down-circle', onSelect: onBorrow }] : []),
                { label: 'Delete Account…', icon: 'trash', danger: true, onSelect: onDelete },
              ]}
            />
          </div>

          <div className="stack-tight" style={{ gap: 2 }}>
            <span className={`stat-number ${balance < 0 ? 'expense' : ''}`} style={{ overflowWrap: 'anywhere' }}>{money(balance, account.currency)}</span>
            {account.currency !== data.displayCurrency && (
              <span className="micro muted num">{money(inDisplay(data, balance, account.currency), data.displayCurrency)}</span>
            )}
          </div>

          <div className="row row-wrap" style={{ justifyContent: 'space-between', gap: 8, minHeight: 36 }}>
            <Switch
              checked={account.includeInTotal}
              onChange={(v) => updateAccount({ ...account, includeInTotal: v })}
              label="Count in total"
            />
            {isDebt && balance < 0 && <Button onClick={onPay}>Pay…</Button>}
          </div>
        </div>
      </Card>
    </div>
  )
}

// ---------- Pay debt sheet ----------

/** Quick payment into a debt account — the same "debt payment" transfer as Expense → Debt payment. */
function PayDebtSheet({ open, debtID, fallback, onClose }: { open: boolean; debtID: string; fallback: Account; onClose: () => void }) {
  const { data, addTransaction } = useStore()
  const debt = data.accounts.find((a) => a.id === debtID) ?? fallback
  const regular = data.accounts.filter((a) => a.kind === 'regular')
  const remaining = owed(balanceOf(data, debt))

  const [amount, setAmount] = useState<number | null>(null)
  const [amountText, setAmountText] = useState('')
  const [sourceID, setSourceID] = useState('')
  const [dateValue, setDateValue] = useState(() => toDateInputValue(new Date()))

  const tooMuch = amount !== null && Number.isFinite(amount) && amount > remaining + tolerance(debt.currency)
  const amountErr = amountError(amount, amountText) ?? (tooMuch ? 'That is more than you owe.' : undefined)
  const source = regular.find((a) => a.id === sourceID)
  const date = dayAtNow(dateValue)
  const canSave = amount !== null && !amountErr && source !== undefined && date !== null

  const save = () => {
    if (amount === null || !source || !date) return
    addTransaction({
      title: `${debt.name} payment`,
      amount,
      currency: debt.currency,
      category: 'debtPayment',
      kind: 'transfer',
      date: toISO(date),
      note: '',
      fromAccountID: source.id,
      toAccountID: debt.id,
      fromAccount: source.name,
      toAccount: debt.name,
    })
  }

  return (
    <Sheet open={open} title={`Pay ${debt.name}`} saveTitle="Pay" canSave={canSave} onSave={save} onClose={onClose}
      footnote={`Counts as spending in your monthly stats. ${money(remaining, debt.currency)} left on this debt.`}>
      <Field label="Amount" error={amountErr}>
        {(id, describedBy) => (
          <div className="stack-tight">
            <div className="input-row" style={{ alignItems: 'center' }}>
              <AmountInput id={id} value={amount} onChange={setAmount} onInput={(e) => setAmountText(e.currentTarget.value)}
                aria-describedby={describedBy} aria-invalid={amountErr ? true : undefined} />
              <span className="muted" style={{ flex: 'none' }}>{debt.currency}</span>
            </div>
            {remaining > 0 && (
              <Button variant="link" className="num" style={{ minHeight: 36, alignSelf: 'flex-start' }}
                onClick={() => { setAmount(remaining); setAmountText(plainNumber(remaining)) }}>
                Pay in full — {money(remaining, debt.currency)}
              </Button>
            )}
          </div>
        )}
      </Field>
      <SourceAccountField label="From account" value={sourceID} onChange={setSourceID} accounts={regular}
        emptyHint="Add a regular account first, so the payment has somewhere to come from." />
      <DateField value={dateValue} onChange={setDateValue} valid={date !== null} />
    </Sheet>
  )
}

// ---------- Borrow sheet ----------

/** Take more money out of a debt: debt account → regular account. Neutral for income stats. */
function BorrowSheet({ open, debtID, fallback, onClose }: { open: boolean; debtID: string; fallback: Account; onClose: () => void }) {
  const { data, addTransaction } = useStore()
  const debt = data.accounts.find((a) => a.id === debtID) ?? fallback
  const regular = data.accounts.filter((a) => a.kind === 'regular')

  const [amount, setAmount] = useState<number | null>(null)
  const [amountText, setAmountText] = useState('')
  const [depositID, setDepositID] = useState('')
  const [dateValue, setDateValue] = useState(() => toDateInputValue(new Date()))

  const amountErr = amountError(amount, amountText)
  const deposit = regular.find((a) => a.id === depositID)
  const date = dayAtNow(dateValue)
  const canSave = amount !== null && !amountErr && deposit !== undefined && date !== null

  const save = () => {
    if (amount === null || !deposit || !date) return
    addTransaction({
      title: `Borrowed from ${debt.name}`,
      amount,
      currency: debt.currency,
      category: 'loanReceived',
      kind: 'transfer',
      date: toISO(date),
      note: '',
      fromAccountID: debt.id,
      toAccountID: deposit.id,
      fromAccount: debt.name,
      toAccount: deposit.name,
    })
  }

  return (
    <Sheet open={open} title={`Borrow from ${debt.name}`} saveTitle="Borrow" canSave={canSave} onSave={save} onClose={onClose}
      footnote="The debt grows by this amount and the money lands on the chosen account. Doesn't count as income — borrowed money isn't earnings.">
      <Field label="Amount" error={amountErr}>
        {(id, describedBy) => (
          <div className="input-row" style={{ alignItems: 'center' }}>
            <AmountInput id={id} value={amount} onChange={setAmount} onInput={(e) => setAmountText(e.currentTarget.value)}
              aria-describedby={describedBy} aria-invalid={amountErr ? true : undefined} />
            <span className="muted" style={{ flex: 'none' }}>{debt.currency}</span>
          </div>
        )}
      </Field>
      <SourceAccountField label="Deposit to" value={depositID} onChange={setDepositID} accounts={regular}
        emptyHint="Add a regular account first, so the borrowed money has somewhere to land." />
      <DateField value={dateValue} onChange={setDateValue} valid={date !== null} />
    </Sheet>
  )
}

/** Required regular-account picker: no "None", or money would vanish or appear from nowhere. */
function SourceAccountField({ label, value, onChange, accounts, emptyHint }: {
  label: string; value: string; onChange: (v: string) => void; accounts: Account[]; emptyHint: string
}) {
  return (
    <Field label={label} error={accounts.length === 0 ? emptyHint : undefined}>
      {(id, describedBy) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
          <option value="">Choose account…</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      )}
    </Field>
  )
}

function DateField({ value, onChange, valid }: { value: string; onChange: (v: string) => void; valid: boolean }) {
  return (
    <Field label="Date" error={valid ? undefined : 'Choose a date.'}>
      {(id, describedBy) => (
        <TextInput id={id} type="date" className="num" value={value} onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy} aria-invalid={valid ? undefined : true} />
      )}
    </Field>
  )
}

// ---------- Add / Edit sheet ----------

const kindOptions: { value: AccountKind; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'debt', label: 'Debt' },
]

function AccountEditorSheet({ open, editing, onClose }: { open: boolean; editing: Account | null; onClose: () => void }) {
  const { data, addAccount, updateAccount } = useStore()

  const [name, setName] = useState(editing?.name ?? '')
  const [icon, setIcon] = useState(editing ? iconName(editing.icon) : 'credit-card')
  const [currency, setCurrency] = useState<CurrencyCode>(editing?.currency ?? data.displayCurrency)
  const [kind, setKind] = useState<AccountKind>(editing?.kind ?? 'regular')
  // Debts are stored negative but edited as a positive "owed"; regular balances keep their sign (overdrafts).
  const [balance, setBalance] = useState<number | null>(editing ? (editing.kind === 'debt' ? Math.abs(editing.openingBalance) : editing.openingBalance) : null)
  const [balanceText, setBalanceText] = useState(() => (editing ? plainNumber(editing.kind === 'debt' ? Math.abs(editing.openingBalance) : editing.openingBalance) : ''))
  const [convertedFrom, setConvertedFrom] = useState<CurrencyCode | null>(null)
  const [includeInTotal, setIncludeInTotal] = useState(editing?.includeInTotal ?? true)

  const trimmedName = name.trim()
  const duplicate = trimmedName !== '' && data.accounts.find((a) => a.id !== editing?.id && sameName(a.name, trimmedName))
  const nameError = duplicate ? `You already have an account named “${duplicate.name}”.` : undefined

  let balanceError: string | undefined
  if (balance === null) balanceError = balanceText.trim() ? 'Enter a number, like 125 000.' : undefined
  else if (!Number.isFinite(balance) || Math.abs(balance) >= 1e15) balanceError = 'That amount is too large.'

  const canSave = trimmedName !== '' && !duplicate && !balanceError

  const changeCurrency = (next: CurrencyCode) => {
    // When editing, a balance typed in the old currency is converted so $180 doesn't become 180 soʻm.
    if (editing && balance !== null && Number.isFinite(balance) && next !== currency) {
      const factor = 10 ** currencyMeta[next].fractionDigits
      const converted = Math.round(convert(data.rates, balance, currency, next) * factor) / factor
      setBalance(converted)
      setBalanceText(plainNumber(converted))
      setConvertedFrom(convertedFrom ?? currency)
    }
    setCurrency(next)
  }

  const save = () => {
    const typed = balance ?? 0
    const fields = {
      name: trimmedName,
      // Keep the stored (possibly SF Symbol) name when the icon wasn't changed.
      icon: editing && iconName(editing.icon) === icon ? editing.icon : icon,
      currency,
      kind,
      // Debts live below zero: "owed 2 000 000" is stored as −2 000 000.
      openingBalance: kind === 'debt' ? -Math.abs(typed) : typed,
      includeInTotal,
    }
    if (editing) updateAccount({ ...editing, ...fields })
    else addAccount(fields)
  }

  const balanceHint = convertedFrom && convertedFrom !== currency ? `Converted from ${convertedFrom} at your rates.` : undefined

  return (
    <Sheet open={open} title={editing ? 'Edit Account' : 'New Account'} saveTitle={editing ? 'Save' : 'Add'} canSave={canSave} onSave={save} onClose={onClose}
      footnote={kind === 'debt'
        ? 'Debts carry a negative balance and pull the total down while counted. Transfers into a debt account pay it off.'
        : 'The balance right now, before Fintrack starts tracking. Income, expenses and transfers you link to this account adjust it automatically.'}>
      <Field label="Name" error={nameError}>
        {(id, describedBy) => (
          <TextInput id={id} value={name} placeholder="e.g. Humo card" autoComplete="off" onChange={(e) => setName(e.target.value)}
            aria-describedby={describedBy} aria-invalid={nameError ? true : undefined} />
        )}
      </Field>

      <div className="field">
        <span className="field-label" aria-hidden="true">Icon</span>
        <IconPicker icons={accountIcons} value={icon} onChange={setIcon} label="Icon" />
      </div>

      <div className="field">
        <span className="field-label" aria-hidden="true">Kind</span>
        <Segmented label="Kind" block options={kindOptions} value={kind} onChange={setKind} />
      </div>

      <Field label="Currency">
        {(id) => <CurrencySelect id={id} value={currency} onChange={changeCurrency} />}
      </Field>

      <Field label={kind === 'debt' ? 'Amount owed' : 'Current balance'} hint={balanceHint} error={balanceError}>
        {(id, describedBy) => (
          <AmountInput id={id} value={balance} onChange={setBalance} onInput={(e) => setBalanceText(e.currentTarget.value)}
            aria-describedby={describedBy} aria-invalid={balanceError ? true : undefined} />
        )}
      </Field>

      <Switch checked={includeInTotal} onChange={setIncludeInTotal} label="Count in total balance" />
    </Sheet>
  )
}
