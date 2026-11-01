import { useState } from 'react'
import { useStore } from '../state/store'
import {
  budgetStatus, categoryMeta, expenseCategories, inDisplay, money, monthName, plainNumber, spentThisMonth,
  unbudgetedCategories, type Budget, type Category, type CurrencyCode,
} from '../core'
import {
  AmountInput, Button, Card, CategoryBadge, CategorySelect, ConfirmDialog, CurrencySelect, EmptyState, Field, Menu, Page,
  ProgressBar, Sheet, SheetSection,
} from '../ui'

// ---------- Amount validation (shared with Goals) ----------

/** Amounts at or above this are rejected: beyond it doubles lose cents and the Mac app's formatters misbehave. */
export const MAX_AMOUNT = 1e15

/** Why an amount can't be saved, or null when it's fine. `null` input means "empty" and is handled by the caller. */
export function amountProblem(value: number | null, allowZero = false): string | null {
  if (value === null) return null
  if (!Number.isFinite(value)) return 'Enter a valid number.'
  if (allowZero ? value < 0 : value <= 0) return allowZero ? 'Can’t be negative.' : 'Enter an amount greater than zero.'
  if (value >= MAX_AMOUNT) return 'That amount is too large.'
  return null
}

export function isValidAmount(value: number | null, allowZero = false): value is number {
  return value !== null && amountProblem(value, allowZero) === null
}

/** Labelled AmountInput that shows a field error for unparseable, non-positive or oversized amounts. */
export function AmountField({ label, value, onChange, allowZero, placeholder, hint }: {
  label: string; value: number | null; onChange: (v: number | null) => void; allowZero?: boolean; placeholder?: string; hint?: string
}) {
  const [raw, setRaw] = useState(() => plainNumber(value))
  const [focused, setFocused] = useState(false)
  // Don't flag half-typed input ("0" on the way to "0.5", a lone "-" or ".") until the user leaves the field.
  const midTyping = focused && (value === 0 || /^\s*[-.,]\s*$/.test(raw))
  let error: string | undefined
  if (!midTyping) {
    if (value === null) error = raw.trim() !== '' ? 'Enter a number.' : undefined
    else error = amountProblem(value, allowZero) ?? undefined
  }
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => (
        <AmountInput
          id={id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          onInput={(e) => setRaw(e.currentTarget.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      )}
    </Field>
  )
}

// ---------- Screen ----------

/** `n` remounts the sheet on every open so its fields start fresh; `open` lets it close in place so focus returns. */
interface EditorState { open: boolean; budget: Budget | null; n: number }

export function BudgetsScreen() {
  const { data, now, deleteBudget } = useStore()
  const [editor, setEditor] = useState<EditorState>({ open: false, budget: null, n: 0 })
  const [deleting, setDeleting] = useState<{ open: boolean; budget: Budget | null }>({ open: false, budget: null })

  const unbudgeted = unbudgetedCategories(data)
  const allBudgeted = unbudgeted.length === 0
  const openEditor = (budget: Budget | null) => setEditor((e) => ({ open: true, budget, n: e.n + 1 }))
  const addHelp = allBudgeted ? 'Every expense category already has a budget' : 'Set a monthly limit for a category'

  return (
    <Page
      title="Budgets"
      subtitle={`${monthName(now)} ${now.getFullYear()} · resets monthly`}
      actions={
        <span title={addHelp}>
          <Button variant="primary" icon="plus" disabled={allBudgeted} title={addHelp} onClick={() => openEditor(null)}>Add</Button>
        </span>
      }
    >
      {data.budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon="chart-pie"
            title="No budgets yet"
            message="Pick a category and set a monthly limit — Fintrack tracks every expense against it and starts fresh on the 1st."
          >
            <Button variant="primary" icon="plus" onClick={() => openEditor(null)} style={{ marginBlockStart: 6 }}>Create a Budget</Button>
          </EmptyState>
        </Card>
      ) : (
        <>
          <SummaryCard />
          <div className="grid grid-auto-300">
            {data.budgets.map((b) => (
              <BudgetCard key={b.id} budget={b} onEdit={() => openEditor(b)} onDelete={() => setDeleting({ open: true, budget: b })} />
            ))}
          </div>
        </>
      )}

      {editor.n > 0 && (
        <BudgetEditorSheet
          key={editor.n}
          open={editor.open}
          budget={editor.budget}
          onClose={() => setEditor((e) => ({ ...e, open: false }))}
        />
      )}

      <ConfirmDialog
        open={deleting.open}
        title={deleting.budget ? `Delete the ${categoryMeta[deleting.budget.category].title} budget?` : 'Delete budget?'}
        message="Your transactions stay put — only the monthly limit is removed."
        confirmTitle="Delete Budget"
        onConfirm={() => { if (deleting.budget) deleteBudget(deleting.budget.id) }}
        onClose={() => setDeleting((d) => ({ ...d, open: false }))}
      />
    </Page>
  )
}

// ---------- Summary ----------

function SummaryCard() {
  const { data, now } = useStore()
  const dc = data.displayCurrency
  let totalBudgeted = 0
  let totalSpent = 0
  // Sum per-budget remainders so an overspent category can't "donate" its deficit to categories that still have room.
  let totalLeft = 0
  let overCount = 0
  for (const b of data.budgets) {
    const s = budgetStatus(data, b, now)
    totalBudgeted += inDisplay(data, b.limit, b.currency)
    totalSpent += inDisplay(data, s.spent, b.currency)
    totalLeft += inDisplay(data, s.remaining, b.currency)
    if (s.isOver) overCount += 1
  }
  const fraction = totalBudgeted > 0 ? totalSpent / totalBudgeted : 0
  const overPlan = totalSpent > totalBudgeted

  return (
    <Card>
      <div className="stack-tight" style={{ gap: 12 }}>
        <div className="row" style={{ justifyContent: 'space-between', minHeight: 26 }}>
          <span className="caption">Spent this month</span>
          {overCount > 0 && <span className="chip chip-expense">{overCount} over budget</span>}
        </div>
        <div className="row row-wrap" style={{ alignItems: 'baseline', gap: '2px 8px' }}>
          <span className="stat-number" style={{ overflowWrap: 'anywhere' }}>{money(totalSpent, dc)}</span>
          <span className="caption num">of {money(totalBudgeted, dc)} budgeted</span>
        </div>
        <ProgressBar fraction={fraction} label="Spent of total monthly budget" />
        {overPlan
          ? <span className="caption num semibold expense">{money(totalSpent - totalBudgeted, dc)} over the monthly plan</span>
          : <span className="caption num">{money(totalLeft, dc)} left to spend this month</span>}
      </div>
    </Card>
  )
}

// ---------- Budget card ----------

function BudgetCard({ budget, onEdit, onDelete }: { budget: Budget; onEdit: () => void; onDelete: () => void }) {
  const { data, now } = useStore()
  const s = budgetStatus(data, budget, now)
  const meta = categoryMeta[budget.category]

  return (
    <Card tint={s.isOver ? 'expense' : undefined}>
      <div className="stack-tight" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <CategoryBadge category={budget.category} />
          <h2 className="grow truncate" style={{ fontSize: 'var(--text-body)' }}>{meta.title}</h2>
          <Menu
            size="sm"
            label={`Options for ${meta.title}`}
            items={[
              { label: 'Edit Budget', icon: 'pencil', onSelect: onEdit },
              { label: 'Delete Budget', icon: 'trash', danger: true, onSelect: onDelete },
            ]}
          />
        </div>

        <div className="stat-number truncate">{money(s.spent, budget.currency)}</div>

        <ProgressBar fraction={s.fraction} tint={`var(--tint-${meta.tint})`} label={`${meta.title} budget`} />

        <div className="row row-wrap" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: '2px 12px' }}>
          <span className="caption num">of {money(s.limit, budget.currency)}</span>
          {s.isOver
            ? <span className="num semibold expense" style={{ fontSize: 'var(--text-caption)' }}>Over by {money(s.spent - s.limit, budget.currency)}</span>
            : <span className="caption num">{money(s.remaining, budget.currency)} left</span>}
        </div>
      </div>
    </Card>
  )
}

// ---------- Add / edit sheet ----------

function BudgetEditorSheet({ open, budget, onClose }: { open: boolean; budget: Budget | null; onClose: () => void }) {
  const { data, now, addBudget, updateBudget } = useStore()

  // Frozen at open: unbudgeted categories, plus the budget's own category when editing, in canonical order.
  const [categories] = useState<Category[]>(() => {
    const free = unbudgetedCategories(data)
    if (!budget) return free
    const allowed = new Set<Category>([...free, budget.category])
    return expenseCategories.filter((c) => allowed.has(c))
  })
  const [category, setCategory] = useState<Category>(budget?.category ?? categories[0] ?? 'other')
  const [limit, setLimit] = useState<number | null>(budget?.limit ?? null)
  const [currency, setCurrency] = useState<CurrencyCode>(budget?.currency ?? data.displayCurrency)

  const canSave = isValidAmount(limit)
  const spent = spentThisMonth(data, category, currency, now)

  const save = () => {
    if (!isValidAmount(limit)) return
    if (budget) updateBudget({ ...budget, category, limit, currency })
    else addBudget({ category, limit, currency })
  }

  return (
    <Sheet
      open={open}
      title={budget ? 'Edit Budget' : 'New Budget'}
      saveTitle={budget ? 'Save' : 'Add Budget'}
      canSave={canSave}
      onSave={save}
      onClose={onClose}
    >
      <SheetSection>
        <Field label="Category">
          {(id) => <CategorySelect id={id} value={category} onChange={setCategory} categories={categories} />}
        </Field>
        <AmountField label="Monthly limit" value={limit} onChange={setLimit} />
        <Field label="Currency" hint="Spending in other currencies counts toward the limit at your saved rates.">
          {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}
        </Field>
      </SheetSection>
      <SheetSection>
        <div className="row row-wrap" style={{ justifyContent: 'space-between', gap: '2px 12px' }}>
          <span className="caption" style={{ color: 'var(--text)' }}>Spent so far this month</span>
          <span className="caption num">{money(spent, currency)}</span>
        </div>
      </SheetSection>
    </Sheet>
  )
}
