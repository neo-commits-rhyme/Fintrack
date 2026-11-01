import { useStore } from '../state/store'
import {
  balancesByCurrency, budgetStatus, categoryMeta, compactMoney, dailyExpenses, dayLabel, headlineBalance, inDisplay,
  isDebtPayment, isLoanReceived, money, monthExpense, monthIncome, monthName, monthSpendingByCategory, parseISO, type AppData, type Transaction,
} from '../core'
import { Card, CategoryBadge, DailyBarChart, Donut, EmptyState, Page, ProgressBar, SectionHeader, StatTile } from '../ui'

export function DashboardScreen() {
  const { data, now } = useStore()
  const dc = data.displayCurrency
  const income = monthIncome(data, now)
  const expense = monthExpense(data, now)
  const split = balancesByCurrency(data)
  const series = dailyExpenses(data, 30, now)
  const breakdown = monthSpendingByCategory(data, now)
  const top = breakdown.slice(0, 5)
  const recent = data.transactions.slice(0, 6)
  const savingsRate = income > 0 ? Math.round(((income - expense) / income) * 100) : null

  return (
    <Page title="Dashboard" subtitle="Your money at a glance">
      <Card>
        <div className="stack-tight">
          <span className="caption">Total balance</span>
          <div className="hero-number hero-split">
            {split.map((s, i) => (
              <span key={s.currency}>
                {i > 0 && <span className="hero-sep" aria-hidden="true">|</span>}
                <span className="nowrap">{money(s.amount, s.currency)}</span>
              </span>
            ))}
          </div>
          {split.length > 1 && <span className="micro faint num">≈ {money(headlineBalance(data), dc)} all together, at your rates</span>}
          <div className="row row-wrap" style={{ gap: 10, marginBlockStart: 4 }}>
            <span className="chip chip-income">↗ {income > 0 ? '+' : ''}{money(income, dc)}</span>
            <span className="chip chip-expense">↘ {expense > 0 ? '\u2212' : ''}{money(expense, dc)}</span>
            <span className="caption faint">this month</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-3">
        <StatTile title={`Income · ${monthName(now)}`} value={money(income, dc)} icon="arrow-up-right" tone="income" />
        <StatTile title={`Spending · ${monthName(now)}`} value={money(expense, dc)} icon="arrow-down-right" tone="expense" />
        <StatTile title="Savings rate" value={savingsRate === null ? '—' : savingsRate < 0 ? `−${Math.abs(savingsRate)}%` : `${savingsRate}%`} icon="percent" tone="accent" />
      </div>

      <SectionHeader title="Spending — last 30 days" />
      <Card>
        {series.some((d) => d.amount > 0)
          ? <DailyBarChart series={series} currency={dc} />
          : <EmptyState icon="bar-chart" title="No spending recorded" message="Add a few expenses and the last 30 days will take shape here." />}
      </Card>

      <div className="grid grid-2">
        <div>
          <SectionHeader title="Top categories" />
          <Card>
            {top.length === 0
              ? <EmptyState icon="chart-pie" title="Nothing spent this month" message="Your spending will break down by category here." />
              : (
                <div className="stack">
                  <Donut items={top} centerTitle={compactMoney(expense, dc)} centerSub="this month" />
                  <div className="stack-tight" style={{ gap: 12 }}>
                    {top.map((item) => (
                      <div key={item.category} className="row" style={{ gap: 10 }}>
                        <CategoryBadge category={item.category} size={26} />
                        <span className="grow truncate" style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{categoryMeta[item.category].title}</span>
                        <span className="num semibold" style={{ fontSize: 'var(--text-caption)' }}>{money(item.amount, dc)}</span>
                      </div>
                    ))}
                  </div>
                  {breakdown.length > top.length && (
                    <span className="micro faint">+ {breakdown.length - top.length} smaller {breakdown.length - top.length === 1 ? 'category' : 'categories'}</span>
                  )}
                </div>
              )}
          </Card>
        </div>
        <div>
          <SectionHeader title="Budgets" />
          <Card>
            {data.budgets.length === 0
              ? <EmptyState icon="gauge" title="No budgets yet" message="Set monthly limits in the Budgets tab to track them here." />
              : (
                <div className="stack" style={{ gap: 18 }}>
                  {/* Over-budget first, then the fullest: the four that need attention. */}
                  {[...data.budgets].sort((a, b) => budgetStatus(data, b, now).fraction - budgetStatus(data, a, now).fraction).slice(0, 4).map((b) => {
                    const s = budgetStatus(data, b, now)
                    const meta = categoryMeta[b.category]
                    return (
                      <div key={b.id} className="stack-tight" style={{ gap: 7 }}>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{meta.title}</span>
                          {s.isOver && <span className="expense micro semibold num">Over by {money(s.spent - s.limit, b.currency)}</span>}
                        </div>
                        <ProgressBar fraction={s.fraction} tint={`var(--tint-${meta.tint})`} label={`${meta.title} budget`} />
                        <span className="micro muted num">{money(s.spent, b.currency)} of {money(s.limit, b.currency)}</span>
                      </div>
                    )
                  })}
                </div>
              )}
          </Card>
        </div>
      </div>

      <SectionHeader title="Recent activity" />
      <Card>
        {recent.length === 0
          ? <EmptyState icon="list-checks" title="No activity yet" message="Transactions you add will show up here, newest first." />
          : (
            <div className="list">
              {recent.map((t) => <RecentRow key={t.id} t={t} />)}
            </div>
          )}
      </Card>
    </Page>
  )
}

function RecentRow({ t }: { t: Transaction }) {
  const { data, now } = useStore()
  const dc = data.displayCurrency
  const { text, tone } = signedDisplay(t, money(displayAmount(data, t), dc))
  return (
    <div className="list-row">
      <CategoryBadge category={t.category} size={34} />
      <div className="row-main">
        <span className="row-title truncate" style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{t.title}</span>
        <span className="row-detail">{dayLabel(parseISO(t.date), now)}</span>
      </div>
      <div className="row-amount">
        <span className={`primary ${tone}`} style={{ fontSize: 'var(--text-caption)' }}>{text}</span>
        {t.currency !== dc && <span className="secondary">{money(t.amount, t.currency)}</span>}
      </div>
    </div>
  )
}

/** The amount a row shows in the display currency: a transfer that fixed what arrived shows that, not today's re-pricing. */
export function displayAmount(data: AppData, t: Transaction): number {
  return t.toAmount != null && t.toCurrency ? inDisplay(data, t.toAmount, t.toCurrency) : inDisplay(data, t.amount, t.currency)
}

/** One sign rule shared by Dashboard and Transactions: income +, expense/debt payment −, loan + (neutral), transfer unsigned. */
export function signedDisplay(t: Transaction, formatted: string): { text: string; tone: '' | 'income' } {
  if (t.kind === 'income') return { text: `+${formatted}`, tone: 'income' }
  if (t.kind === 'expense' || isDebtPayment(t)) return { text: `−${formatted}`, tone: '' }
  if (isLoanReceived(t)) return { text: `+${formatted}`, tone: '' }
  return { text: formatted, tone: '' }
}
