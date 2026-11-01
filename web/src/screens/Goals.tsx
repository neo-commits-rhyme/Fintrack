import { useState } from 'react'
import { useStore } from '../state/store'
import {
  addMonths, convert, daysBetween, fromDateInputValue, goalFraction, goalIcons, goalIsComplete, goalRemaining, money,
  monthsBetween, parseISO, startOfDay, toDateInputValue, toISO, type CurrencyCode, type Goal,
} from '../core'
import {
  Button, Card, ConfirmDialog, CurrencySelect, EmptyState, Field, Icon, IconPicker, Menu, Page, Ring, Sheet, SheetSection,
  Switch, TextInput, iconName,
} from '../ui'
import { AmountField, isValidAmount } from './Budgets'

/** Incomplete goals first (closest deadline, then name); reached goals last. */
function sortedGoals(goals: Goal[]): Goal[] {
  const due = (g: Goal) => (g.deadline ? parseISO(g.deadline).getTime() : Number.POSITIVE_INFINITY)
  return [...goals].sort((a, b) => {
    const ac = goalIsComplete(a), bc = goalIsComplete(b)
    if (ac !== bc) return ac ? 1 : -1
    const ad = due(a), bd = due(b)
    if (ad !== bd) return ad < bd ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** "Overdue" / "Due today" / "N months left" / "N days left". Months only once a whole calendar month and ≥ 28 days remain. */
function deadlineInfo(deadline: string, now: Date): { label: string; overdue: boolean } {
  const today = startOfDay(now)
  const due = startOfDay(parseISO(deadline))
  if (due < today) return { label: 'Overdue', overdue: true }
  const days = daysBetween(today, due)
  if (days === 0) return { label: 'Due today', overdue: false }
  const months = monthsBetween(today, due)
  if (days >= 28 && months >= 1) return { label: months === 1 ? '1 month left' : `${months} months left`, overdue: false }
  return { label: days === 1 ? '1 day left' : `${days} days left`, overdue: false }
}

interface SheetState { open: boolean; goal: Goal | null; n: number }

export function GoalsScreen() {
  const { data, deleteGoal } = useStore()
  const [editor, setEditor] = useState<SheetState>({ open: false, goal: null, n: 0 })
  const [funding, setFunding] = useState<SheetState>({ open: false, goal: null, n: 0 })
  const [deleting, setDeleting] = useState<{ open: boolean; goal: Goal | null }>({ open: false, goal: null })

  const openEditor = (goal: Goal | null) => setEditor((e) => ({ open: true, goal, n: e.n + 1 }))
  const openFunding = (goal: Goal) => setFunding((f) => ({ open: true, goal, n: f.n + 1 }))

  return (
    <Page
      title="Goals"
      subtitle="Save toward what matters"
      actions={<Button variant="primary" icon="plus" onClick={() => openEditor(null)}>Add</Button>}
    >
      {data.goals.length === 0 ? (
        <Card>
          <EmptyState
            icon="target"
            title="No goals yet"
            message="Create a goal — a trip, a laptop, an emergency fund — then add funds whenever you set money aside."
          />
        </Card>
      ) : (
        <div className="grid grid-auto-320">
          {sortedGoals(data.goals).map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              onAddFunds={() => openFunding(g)}
              onEdit={() => openEditor(g)}
              onDelete={() => setDeleting({ open: true, goal: g })}
            />
          ))}
        </div>
      )}

      {editor.n > 0 && (
        <GoalEditorSheet key={`e${editor.n}`} open={editor.open} goal={editor.goal} onClose={() => setEditor((e) => ({ ...e, open: false }))} />
      )}
      {funding.n > 0 && funding.goal && (
        <GoalFundsSheet key={`f${funding.n}`} open={funding.open} goal={funding.goal} onClose={() => setFunding((f) => ({ ...f, open: false }))} />
      )}

      <ConfirmDialog
        open={deleting.open}
        title={deleting.goal ? `Delete “${deleting.goal.name}”?` : 'Delete goal?'}
        message={deleting.goal
          ? `This removes the goal and its ${money(deleting.goal.saved, deleting.goal.currency)} of tracked progress. Your transactions are not affected.`
          : ''}
        confirmTitle="Delete Goal"
        onConfirm={() => { if (deleting.goal) deleteGoal(deleting.goal.id) }}
        onClose={() => setDeleting((d) => ({ ...d, open: false }))}
      />
    </Page>
  )
}

// ---------- Goal card ----------

function GoalCard({ goal, onAddFunds, onEdit, onDelete }: { goal: Goal; onAddFunds: () => void; onEdit: () => void; onDelete: () => void }) {
  const { now } = useStore()
  const complete = goalIsComplete(goal)
  const deadline = !complete && goal.deadline ? deadlineInfo(goal.deadline, now) : null

  return (
    <Card className="stack">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <Ring fraction={goalFraction(goal)} color={complete ? 'var(--income)' : 'var(--accent)'} label={goal.name} />
        <div className="grow stack-tight" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 7 }}>
            <span className="muted" style={{ display: 'inline-flex', flex: 'none' }}>
              <Icon name={iconName(goal.icon)} size={15} strokeWidth={2} />
            </span>
            <h2 className="truncate" style={{ fontSize: 'var(--text-body)' }}>{goal.name}</h2>
          </div>
          <div className="stat-number truncate">{money(goal.saved, goal.currency)}</div>
          <span className="micro muted num">
            {complete
              ? `of ${money(goal.target, goal.currency)}`
              : `of ${money(goal.target, goal.currency)} · ${money(goalRemaining(goal), goal.currency)} to go`}
          </span>
          {complete && (
            <span className="chip chip-income" style={{ alignSelf: 'flex-start', marginBlockStart: 3 }}>
              <Icon name="check" size={13} strokeWidth={2} />Reached
            </span>
          )}
          {deadline && (
            <span className={`chip ${deadline.overdue ? 'chip-expense' : 'chip-neutral'}`} style={{ alignSelf: 'flex-start', marginBlockStart: 3 }}>
              {deadline.label}
            </span>
          )}
        </div>
      </div>

      {/* Footer pinned to the bottom so cards in a row line up regardless of chips or wrapping. */}
      <div className="row" style={{ justifyContent: 'space-between', marginBlockStart: 'auto' }}>
        {!complete && <Button size="sm" onClick={onAddFunds}>Add funds</Button>}
        <div style={{ marginInlineStart: 'auto' }}>
          <Menu
            size="sm"
            label={`Options for ${goal.name}`}
            items={[
              { label: 'Edit Goal', icon: 'pencil', onSelect: onEdit },
              { label: 'Delete Goal…', icon: 'trash', danger: true, onSelect: onDelete },
            ]}
          />
        </div>
      </div>
    </Card>
  )
}

// ---------- Add funds sheet ----------

function GoalFundsSheet({ open, goal: initial, onClose }: { open: boolean; goal: Goal; onClose: () => void }) {
  const { data, addFunds } = useStore()
  // Read the live goal so the footnote stays right if it changes underneath; fall back to the captured one.
  const goal = data.goals.find((g) => g.id === initial.id) ?? initial
  const [amount, setAmount] = useState<number | null>(null)
  const [currency, setCurrency] = useState<CurrencyCode>(goal.currency)

  const canSave = isValidAmount(amount)
  const converted = convert(data.rates, amount ?? 0, currency, goal.currency)

  return (
    <Sheet
      open={open}
      title={`Add funds to ${goal.name}`}
      saveTitle="Add"
      canSave={canSave}
      onSave={() => { if (isValidAmount(amount)) addFunds(goal.id, amount, currency) }}
      onClose={onClose}
      footnote={<span className="num">Currently {money(goal.saved, goal.currency)} of {money(goal.target, goal.currency)} saved.</span>}
    >
      <SheetSection>
        <AmountField label="Amount" value={amount} onChange={setAmount} />
        <Field label="Currency">
          {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} />}
        </Field>
        {currency !== goal.currency && (
          <p className="caption num">= {money(converted, goal.currency)} in {goal.currency}</p>
        )}
      </SheetSection>
    </Sheet>
  )
}

// ---------- Add / edit goal sheet ----------

function GoalEditorSheet({ open, goal, onClose }: { open: boolean; goal: Goal | null; onClose: () => void }) {
  const { data, now, addGoal, updateGoal } = useStore()
  const today = startOfDay(now)
  const originalDeadline = goal?.deadline ? toDateInputValue(parseISO(goal.deadline)) : null

  const [name, setName] = useState(goal?.name ?? '')
  const [icon, setIcon] = useState(goal ? iconName(goal.icon) : 'star')
  const [target, setTarget] = useState<number | null>(goal?.target ?? null)
  const [saved, setSaved] = useState<number | null>(goal?.saved ?? null)
  const [currency, setCurrency] = useState<CurrencyCode>(goal?.currency ?? data.displayCurrency)
  const [hasDeadline, setHasDeadline] = useState(goal?.deadline != null)
  const [dateText, setDateText] = useState(originalDeadline ?? toDateInputValue(addMonths(today, 3)))

  const trimmed = name.trim()
  const date = fromDateInputValue(dateText)
  // A new date must be today or later; an existing (possibly overdue) deadline may be kept as is.
  const dateError = !hasDeadline ? undefined
    : !date ? 'Pick a date.'
    : date < today && dateText !== originalDeadline ? 'Pick today or a later date.'
    : undefined
  const savedOK = goal == null || saved === null || isValidAmount(saved, true)
  const canSave = trimmed !== '' && isValidAmount(target) && savedOK && !dateError

  const changeCurrency = (next: CurrencyCode) => {
    // Editing: keep the amounts meaningful (2 400 USD becomes ~29M soʻm, not "2 400 soʻm").
    // Creating: leave what the user typed alone — they're choosing the unit for it.
    if (goal) {
      if (target !== null) setTarget(convert(data.rates, target, currency, next))
      if (saved !== null) setSaved(convert(data.rates, saved, currency, next))
    }
    setCurrency(next)
  }

  const save = () => {
    if (!canSave || !isValidAmount(target)) return
    const next: Omit<Goal, 'id'> = {
      name: trimmed,
      icon,
      target,
      saved: Math.max(0, saved ?? goal?.saved ?? 0),
      currency,
    }
    if (hasDeadline && date) next.deadline = toISO(startOfDay(date))
    if (goal) {
      const updated: Goal = { ...goal, ...next }
      if (!next.deadline) delete updated.deadline
      updateGoal(updated)
    } else {
      addGoal(next)
    }
  }

  return (
    <Sheet open={open} title={goal ? 'Edit Goal' : 'New Goal'} canSave={canSave} onSave={save} onClose={onClose}>
      <SheetSection>
        <Field label="Name">
          {(id) => (
            <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund" autoComplete="off" />
          )}
        </Field>
        <div className="field">
          <span className="field-label" aria-hidden="true">Icon</span>
          <IconPicker icons={goalIcons} value={icon} onChange={setIcon} label="Icon" />
        </div>
      </SheetSection>

      <SheetSection>
        <AmountField label="Target" value={target} onChange={setTarget} placeholder="Amount to save" />
        {goal && <AmountField label="Saved so far" value={saved} onChange={setSaved} allowZero />}
        <Field label="Currency">
          {(id) => <CurrencySelect id={id} value={currency} onChange={changeCurrency} />}
        </Field>
      </SheetSection>

      <SheetSection>
        <Switch checked={hasDeadline} onChange={setHasDeadline} label="Deadline" />
        {hasDeadline && (
          <Field label="Date" error={dateError}>
            {(id, describedBy) => (
              <TextInput
                id={id}
                type="date"
                value={dateText}
                min={toDateInputValue(today)}
                onChange={(e) => setDateText(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={dateError ? true : undefined}
              />
            )}
          </Field>
        )}
      </SheetSection>
    </Sheet>
  )
}
