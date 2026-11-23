import { useEffect, useState } from 'react'
import { StoreProvider, useStore, type Section } from './state/store'
import { BrandMark, Icon } from './ui'
import { telegram } from './telegram'
import { DashboardScreen } from './screens/Dashboard'
import { TransactionEditorSheet, TransactionsScreen, useSheetSession } from './screens/Transactions'
import { AccountsScreen } from './screens/Accounts'
import { BudgetsScreen } from './screens/Budgets'
import { GoalsScreen } from './screens/Goals'
import { ConverterScreen } from './screens/Converter'
import { SettingsScreen } from './screens/Settings'

const sections: { id: Section; title: string; icon: string }[] = [
  { id: 'dashboard', title: 'Dashboard', icon: 'layout-grid' },
  // The transaction list; the route keeps its old name so saved links still work.
  { id: 'transactions', title: 'Monitoring', icon: 'list-checks' },
  { id: 'accounts', title: 'Accounts', icon: 'credit-card' },
  { id: 'budgets', title: 'Budgets', icon: 'chart-pie' },
  { id: 'goals', title: 'Goals', icon: 'target' },
  // On phones every screen opens from the Dashboard; on desktop the sidebar lists them.
  { id: 'settings', title: 'Settings', icon: 'settings' },
  { id: 'converter', title: 'Converter', icon: 'arrow-left-right' },
]
/** The five sections in the desktop sidebar, reachable with ⌘1–5. */
const navSections = sections.filter((s) => s.id !== 'settings' && s.id !== 'converter')
const settingsSection = sections.find((s) => s.id === 'settings')!

function sectionFromHash(): Section {
  const h = location.hash.replace('#/', '').replace('#', '') as Section
  return sections.some((s) => s.id === h) ? h : 'dashboard'
}

export function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const store = useStore()
  const [section, setSection] = useState<Section>(sectionFromHash)
  // One "new transaction" sheet for the whole app: the add button, ⌘N and Monitoring's Add button all open it here.
  const adder = useSheetSession<null>()
  const { newTransactionRequested, requestNewTransaction } = store
  const showAdder = adder.show
  useEffect(() => {
    if (!newTransactionRequested) return
    requestNewTransaction(false)
    showAdder(null)
  }, [newTransactionRequested, requestNewTransaction, showAdder])

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // ⌘1–5 / Ctrl+1–5 jump between sections and ⌘, opens Settings, like the Mac app;
  // ⌘N / Ctrl+N opens a new transaction from any screen (browsers may reserve it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= navSections.length) {
        e.preventDefault()
        location.hash = `#/${navSections[n - 1].id}`
      } else if (e.key === ',') {
        e.preventDefault()
        location.hash = '#/settings'
      } else if (e.key.toLowerCase() === 'n') {
        const active = document.activeElement as HTMLElement | null
        if (active && (active.matches('input, textarea, select') || active.isContentEditable)) return
        if (document.querySelector('dialog[open]')) return
        e.preventDefault()
        store.requestNewTransaction(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  useEffect(() => {
    document.title = section === 'dashboard' ? 'Fintrack' : `${sections.find((s) => s.id === section)?.title} · Fintrack`
    window.scrollTo({ top: 0 })
  }, [section])

  // Inside Telegram: its Back button returns to the Dashboard (Converter: to Settings), and tab changes tick.
  useEffect(() => {
    if (section === 'dashboard') return
    return telegram.pushBack(() => { location.hash = section === 'converter' ? '#/settings' : '#/dashboard' })
  }, [section])
  useEffect(() => {
    const onHash = () => telegram.haptic('select')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="shell">
      <div className="backdrop" aria-hidden="true" />
      <a href="#main" className="sr-only" style={{ position: 'absolute' }}>Skip to content</a>
      <aside className="sidebar">
        <div className="app-mark">
          <BrandMark size={32} />
          <div className="app-mark-title">Fintrack</div>
        </div>
        <nav className="nav" aria-label="Sections">
          {navSections.map((s, i) => <NavLink key={s.id} s={s} shortcut={String(i + 1)} active={section === s.id} />)}
          <div className="nav-spacer" style={{ minHeight: 12 }} />
          <NavLink s={settingsSection} shortcut="," active={section === 'settings' || section === 'converter'} />
        </nav>
      </aside>
      <main id="main" className="main">
        {store.loadError && (
          <div className="page" style={{ paddingBlockEnd: 0 }}>
            <div className="banner" role="alert">
              <Icon name="alert-circle" size={16} />
              <span className="grow">Saved data could not be read, so Fintrack started empty. A copy was kept in this {store.inTelegram ? 'device' : 'browser'}’s storage.</span>
              <button className="btn btn-sm" type="button" onClick={store.clearLoadError}>Dismiss</button>
            </div>
          </div>
        )}
        {store.saveError && (
          <div className="page" style={{ paddingBlockEnd: 0 }}>
            <div className="banner" role="alert">
              <Icon name="alert-circle" size={16} />
              <span className="grow">Couldn’t save your data: {store.saveError}</span>
              <button className="btn btn-sm" type="button" onClick={store.clearSaveError}>Dismiss</button>
            </div>
          </div>
        )}
        <Screen section={section} />
      </main>
      {/* Phones: one big button to add a transaction. Screens open from the Dashboard. */}
      <div className="add-dock">
        <button type="button" className="add-dock-btn" aria-label="Add transaction" aria-keyshortcuts="Meta+N"
          onClick={() => store.requestNewTransaction(true)}>
          <Icon name="plus" size={26} strokeWidth={2.25} />
        </button>
      </div>
      {adder.key > 0 && <TransactionEditorSheet key={adder.key} open={adder.open} editing={null} onClose={adder.hide} />}
    </div>
  )
}

function NavLink({ s, shortcut, active }: { s: { id: Section; title: string; icon: string }; shortcut: string; active: boolean }) {
  return (
    <a href={`#/${s.id}`} className="nav-link" aria-current={active ? 'page' : undefined}>
      <Icon name={s.icon} size={18} strokeWidth={active ? 2 : 1.75} />
      <span>{s.title}</span>
      <span className="nav-kbd" aria-hidden="true">⌘{shortcut}</span>
    </a>
  )
}

function Screen({ section }: { section: Section }) {
  switch (section) {
    case 'dashboard': return <DashboardScreen />
    case 'transactions': return <TransactionsScreen />
    case 'accounts': return <AccountsScreen />
    case 'budgets': return <BudgetsScreen />
    case 'goals': return <GoalsScreen />
    case 'converter': return <ConverterScreen />
    case 'settings': return <SettingsScreen />
  }
}
