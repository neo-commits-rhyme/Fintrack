import { useStore } from '../state/store'
import {
  balancesByCurrency, budgetStatus, categoryMeta, compactMoney, dailyExpenses, dayLabel, headlineBalance, inDisplay,
  isDebtPayment, isLoanReceived, money, monthExpense, monthIncome, monthName, monthSpendingByCategory, parseISO, type AppData, type Transaction,
} from '../core'
import { BalanceSplit, Card, CategoryBadge, Donut, EmptyState, Icon, Page, ProgressBar, SectionHeader, SpendingAreaChart, StatTile } from '../ui'
import { t } from '../i18n'
import { categoryLabel, transactionTitle } from '../i18n/labels'

const shortcuts = [
  { href: '#/accounts', title: 'Accounts', icon: 'credit-card' },
  { href: '#/budgets', title: 'Budgets', icon: 'chart-pie' },
  { href: '#/goals', title: 'Goals', icon: 'target' },
]

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
  const net = income - expense
  // A brand-new user gets one clear first step instead of a stack of empty sections.
  const isNew = data.accounts.length === 0 && data.transactions.length === 0
  const savingsRate = income > 0 ? Math.round(((income - expense) / income) * 100) : null

  return (
    <Page title={t('Dashboard')} actions={
      // Phones have no Settings tab in the dock; the desktop sidebar keeps its own link.
      <a href="#/settings" className="btn btn-ghost btn-icon compact-only" aria-label={t('Settings')} title={t('Settings')}>
        <Icon name="settings" size={20} strokeWidth={1.75} />
      </a>
    }>
      <section className="home-hero" aria-label={t('Total balance')}>
        <span className="caption">{t('Total balance')}</span>
        <BalanceSplit items={split} display={dc} convertTo={(amount, from) => inDisplay(data, amount, from)} />
        {split.length > 1 && <span className="micro faint num">{t('≈ {amount} at your rates', { amount: money(headlineBalance(data), dc) })}</span>}
        <nav className="home-shortcuts" aria-label={t('Sections')}>
          {shortcuts.map((s) => (
            <a key={s.href} href={s.href} className="home-shortcut">
              <span className="home-shortcut-icon"><Icon name={s.icon} size={24} strokeWidth={1.75} /></span>
              <span>{t(s.title)}</span>
            </a>
          ))}
        </nav>
      </section>

      <a href="#/transactions" className="monitoring-link">
        <span className="home-shortcut-icon" aria-hidden="true"><Icon name="list-checks" size={20} strokeWidth={1.75} /></span>
        <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <span className="row-title">{t('Monitoring')}</span>
          <span className="row-detail num">{t('{amount} net this month', { amount: `${net > 0 ? '+' : ''}${money(net, dc)}` })}</span>
        </span>
        <Icon name="chevron-right" size={18} strokeWidth={2} />
      </a>

      {isNew ? (
        <Card>
          <EmptyState icon="credit-card" title={t('Start with your accounts')}
            message={t('Add the cash, cards and savings you have, then tap + whenever you spend or get paid.')}>
            <a href="#/accounts" className="btn btn-primary" style={{ marginBlockStart: 6 }}>
              <Icon name="plus" size={17} strokeWidth={2} />{t('New account')}
            </a>
          </EmptyState>
        </Card>
      ) : (
      <>
      <div className="grid grid-3">
        <StatTile title={t('Income · {month}', { month: monthName(now) })} value={money(income, dc)} icon="arrow-up-right" tone="income" />
        <StatTile title={t('Spending · {month}', { month: monthName(now) })} value={money(expense, dc)} icon="arrow-down-right" tone="expense" />
        <StatTile title={t('Savings rate')} value={savingsRate === null ? '—' : savingsRate < 0 ? `−${Math.abs(savingsRate)}%` : `${savingsRate}%`} icon="percent" tone="accent" />
      </div>

      <SectionHeader title={t('Spending, last 30 days')} />
      <Card>
        {series.some((d) => d.amount > 0)
          ? <SpendingAreaChart series={series} currency={dc} />
          : <EmptyState icon="bar-chart" title={t('No spending recorded')} message={t('Add expenses to see your spending here.')} />}
      </Card>

      <div className="grid grid-2">
        <div>
          <SectionHeader title={t('Top categories')} />
          <Card>
            {top.length === 0
              ? <EmptyState icon="chart-pie" title={t('Nothing spent this month')} message={t('Add an expense to see it here by category.')} />
              : (
                <div className="stack">
                  <Donut items={top} centerTitle={compactMoney(expense, dc)} centerSub={t('this month')} />
                  <div className="stack-tight" style={{ gap: 12 }}>
                    {top.map((item) => (
                      <div key={item.category} className="row" style={{ gap: 10 }}>
                        <CategoryBadge category={item.category} size={26} />
                        <span className="grow truncate" style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{categoryLabel(item.category)}</span>
                        <span className="num semibold" style={{ fontSize: 'var(--text-caption)' }}>{money(item.amount, dc)}</span>
                      </div>
                    ))}
                  </div>
                  {breakdown.length > top.length && (
                    <span className="micro faint">{t('+ {n} smaller category|+ {n} smaller categories', { n: breakdown.length - top.length })}</span>
                  )}
                </div>
              )}
          </Card>
        </div>
        <div>
          <SectionHeader title={t('Budgets')} />
          <Card>
            {data.budgets.length === 0
              ? <EmptyState icon="gauge" title={t('No budgets yet')} message={t('Set monthly limits in Budgets to track them here.')} />
              : (
                <div className="stack" style={{ gap: 18 }}>
                  {/* Over-budget first, then the fullest: the four that need attention. */}
                  {[...data.budgets].sort((a, b) => budgetStatus(data, b, now).fraction - budgetStatus(data, a, now).fraction).slice(0, 4).map((b) => {
                    const s = budgetStatus(data, b, now)
                    const meta = categoryMeta[b.category]
                    return (
                      <div key={b.id} className="stack-tight" style={{ gap: 7 }}>
                        <div className="row" style={{ justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{categoryLabel(b.category)}</span>
                          {s.isOver && <span className="expense micro semibold num">{t('Over by {amount}', { amount: money(s.spent - s.limit, b.currency) })}</span>}
                        </div>
                        <ProgressBar fraction={s.fraction} tint={`var(--tint-${meta.tint})`} label={t('{category} budget', { category: categoryLabel(b.category) })} />
                        <span className="micro muted num">{t('{spent} of {limit}', { spent: money(s.spent, b.currency), limit: money(s.limit, b.currency) })}</span>
                      </div>
                    )
                  })}
                </div>
              )}
          </Card>
        </div>
      </div>

      <SectionHeader title={t('Recent activity')}><a href="#/transactions" className="link-quiet">{t('Show all')}</a></SectionHeader>
      <Card>
        {recent.length === 0
          ? <EmptyState icon="list-checks" title={t('No activity yet')} message={t('Transactions you add will show up here, newest first.')} />
          : (
            <div className="list">
              {recent.map((tx) => <RecentRow key={tx.id} tx={tx} />)}
            </div>
          )}
      </Card>
      </>
      )}
    </Page>
  )
}

function RecentRow({ tx }: { tx: Transaction }) {
  const { data, now } = useStore()
  const dc = data.displayCurrency
  const { text, tone } = signedDisplay(tx, money(displayAmount(data, tx), dc))
  return (
    <div className="list-row">
      <CategoryBadge category={tx.category} size={34} />
      <div className="row-main">
        <span className="row-title truncate" style={{ fontWeight: 500, fontSize: 'var(--text-caption)' }}>{transactionTitle(tx)}</span>
        <span className="row-detail">{dayLabel(parseISO(tx.date), now)}</span>
      </div>
      <div className="row-amount">
        <span className={`primary ${tone}`} style={{ fontSize: 'var(--text-caption)' }}>{text}</span>
        {tx.currency !== dc && <span className="secondary">{money(tx.amount, tx.currency)}</span>}
      </div>
    </div>
  )
}

/** The amount a row shows in the display currency: a transfer that fixed what arrived shows that, not today's re-pricing. */
export function displayAmount(data: AppData, tx: Transaction): number {
  return tx.toAmount != null && tx.toCurrency ? inDisplay(data, tx.toAmount, tx.toCurrency) : inDisplay(data, tx.amount, tx.currency)
}

/** One sign rule shared by Dashboard and Transactions: income +, expense/debt payment −, loan + (neutral), transfer unsigned. */
export function signedDisplay(tx: Transaction, formatted: string): { text: string; tone: '' | 'income' } {
  if (tx.kind === 'income') return { text: `+${formatted}`, tone: 'income' }
  if (tx.kind === 'expense' || isDebtPayment(tx)) return { text: `−${formatted}`, tone: '' }
  if (isLoanReceived(tx)) return { text: `+${formatted}`, tone: '' }
  return { text: formatted, tone: '' }
}
