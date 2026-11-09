import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  buildTransactions, categoryMeta, expenseCategories, incomeCategories, money, parseISO, REASONS, shortDay, suggest,
  type Category, type ImportDraft, type StatementRow,
} from '../core'
import { Field, Select, Sheet } from '../ui'

const NEW = '__new__'
const expenseOptions = expenseCategories.filter((c) => c !== 'debtPayment')
const incomeOptions = incomeCategories.filter((c) => c !== 'loanReceived')

/** Rows the bank or an earlier import has settled: shown, but they can't be switched on. */
const isLocked = (d: ImportDraft) => d.reason === REASONS.duplicate || d.reason === REASONS.notCompleted

function timeOf(iso: string): string {
  const d = parseISO(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Review step: every statement row with a suggested category, nothing saved until Import. */
export function ImportStatementSheet({ open, rows, onClose, onImported }: {
  open: boolean; rows: StatementRow[]; onClose: () => void; onImported: (count: number) => void
}) {
  const { data, createAccount, importTransactions } = useStore()
  const regular = data.accounts.filter((a) => a.kind === 'regular')
  const last4 = rows.find((r) => r.cardLast4)?.cardLast4 ?? ''
  const newName = last4 ? `Card •${last4}` : 'Bank card'

  const [accountID, setAccountID] = useState(
    () => // A statement is a card's history: never default it onto a cash wallet.
    regular.find((a) => a.name === newName)?.id ?? regular.find((a) => a.currency === 'UZS' && !/cash|налич/i.test(a.name))?.id ?? NEW,
  )
  const [cashID, setCashID] = useState(() => regular.find((a) => a.id !== accountID && /cash|налич/i.test(a.name))?.id ?? '')
  const [drafts, setDrafts] = useState(() => suggest(rows, {
    existingImportIDs: new Set(data.transactions.flatMap((t) => (t.importID ? [t.importID] : []))),
    hasCashSource: cashID !== '',
  }))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())

  // A ticked cash deposit with no source can't be built, so it must not be counted.
  const included = useMemo(() => drafts.filter((d) => d.include && !(d.waitsForCashSource && cashID === '')).length, [drafts, cashID])
  const toReview = useMemo(() => drafts.filter((d) => d.needsAttention && d.include).length, [drafts])

  const editRow = (id: string, patch: Partial<ImportDraft>) => {
    setDrafts((list) => list.map((d) => (d.row.importID === id ? { ...d, ...patch } : d)))
    setTouched((t) => new Set(t).add(id))
  }

  const pickCashSource = (id: string) => {
    setCashID(id)
    setDrafts((list) => list.map((d) => {
      if (!d.waitsForCashSource || touched.has(d.row.importID)) return d
      return { ...d, include: id !== '', needsAttention: id === '', reason: id === '' ? REASONS.cashSource : undefined }
    }))
  }

  const pickAccount = (id: string) => {
    setAccountID(id)
    if (id === cashID) pickCashSource('') // money can't move from an account into itself
  }

  const save = () => {
    const accountId = accountID === NEW ? createAccount(newName, 'UZS').id : accountID
    const txs = buildTransactions(drafts, { accountID: accountId, cashSourceID: cashID || undefined })
    importTransactions(txs)
    onImported(txs.length)
  }

  return (
    <Sheet open={open} wide title="Import bank statement" saveTitle={`Import ${included}`} canSave={included > 0} onSave={save} onClose={onClose}>
      <p className="caption" role="status">
        {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {included} will be imported
        {toReview > 0 && ` · ${toReview} to check`}
      </p>

      <div className="import-pickers">
        <Field label="Card account">
          {(id) => (
            <Select id={id} value={accountID} onChange={(e) => pickAccount(e.target.value)}>
              {regular.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value={NEW}>New account “{newName}”</option>
            </Select>
          )}
        </Field>
        <Field label="Cash deposits come from">
          {(id) => (
            <Select id={id} value={cashID} onChange={(e) => pickCashSource(e.target.value)}>
              <option value="">Don’t import cash deposits</option>
              {regular.filter((a) => a.id !== accountID).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </Field>
      </div>

      <ul className="import-list">
        {drafts.map((d) => {
          const disabled = isLocked(d) || (d.waitsForCashSource && cashID === '')
          const options: Category[] = d.kind === 'income' ? incomeOptions : expenseOptions
          const sign = d.row.credit ? (d.kind === 'transfer' ? '' : '+') : '−'
          return (
            <li key={d.row.importID} className={`import-row${d.needsAttention && d.include ? ' attention' : ''}${d.include ? '' : ' off'}`}>
              <input type="checkbox" className="import-check" checked={d.include} disabled={disabled} aria-label={`Include ${d.title}`}
                onChange={(e) => editRow(d.row.importID, { include: e.target.checked })} />
              <div className="import-main">
                <span className="row-title truncate">{d.title}</span>
                <span className="row-detail num">{shortDay(parseISO(d.row.date))}, {timeOf(d.row.date)}</span>
                {d.reason && <span className="import-reason">{d.reason}</span>}
              </div>
              <span className="import-amount num">{sign}{money(d.row.amount, 'UZS')}</span>
              {d.kind === 'transfer'
                ? <span className="import-static">Transfer</span>
                : (
                  <Select className="import-category" value={d.category} disabled={isLocked(d)} aria-label={`Category for ${d.title}`}
                    onChange={(e) => editRow(d.row.importID, {
                      category: e.target.value as Category,
                      needsAttention: false,
                      reason: d.reason === REASONS.uncategorised ? undefined : d.reason,
                    })}>
                    {options.map((c) => <option key={c} value={c}>{categoryMeta[c].title}</option>)}
                  </Select>
                )}
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
