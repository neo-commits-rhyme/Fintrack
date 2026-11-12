import { useEffect, useState } from 'react'
import { StoreProvider, useStore, type Section } from './state/store'
import { BrandMark, Icon } from './ui'
import { telegram } from './telegram'
import { DashboardScreen } from './screens/Dashboard'
import { TransactionsScreen } from './screens/Transactions'
import { AccountsScreen } from './screens/Accounts'
import { BudgetsScreen } from './screens/Budgets'
import { GoalsScreen } from './screens/Goals'
import { ConverterScreen } from './screens/Converter'
import { SettingsScreen } from './screens/Settings'

const sections: { id: Section; title: string; icon: string }[] = [
  { id: 'dashboard', title: 'Dashboard', icon: 'layout-grid' },
  { id: 'transactions', title: 'Transactions', icon: 'list-checks' },
  { id: 'accounts', title: 'Accounts', icon: 'credit-card' },
  { id: 'budgets', title: 'Budgets', icon: 'chart-pie' },
  { id: 'goals', title: 'Goals', icon: 'target' },
  { id: 'converter', title: 'Converter', icon: 'arrow-left-right' },
  { id: 'settings', title: 'Settings', icon: 'settings' },
]

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

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // ⌘1–7 / Ctrl+1–7 jump between sections, like the Mac app's Go menu;
  // ⌘N / Ctrl+N opens a new transaction from any screen (browsers may reserve it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= sections.length) {
        e.preventDefault()
        location.hash = `#/${sections[n - 1].id}`
      } else if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        location.hash = '#/transactions'
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

  // Inside Telegram: its Back button returns to the Dashboard, and tab changes tick.
  useEffect(() => {
    if (section === 'dashboard') return
    return telegram.pushBack(() => { location.hash = '#/dashboard' })
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
          <div>
            <div className="app-mark-title">Fintrack</div>
            <div className="app-mark-sub">Personal finance</div>
          </div>
        </div>
        <nav className="nav" aria-label="Sections">
          {sections.filter((s) => s.id !== 'settings').map((s, i) => <NavLink key={s.id} s={s} index={i + 1} active={section === s.id} />)}
          <div className="nav-spacer" style={{ minHeight: 12 }} />
          <NavLink s={sections[6]} index={7} active={section === 'settings'} />
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
      <nav className="tabbar" aria-label="Sections">
        {sections.map((s) => (
          <a key={s.id} href={`#/${s.id}`} className="tab-link" aria-current={section === s.id ? 'page' : undefined}>
            <Icon name={s.icon} size={20} strokeWidth={section === s.id ? 2 : 1.75} />
            <span>{s.title}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}

function NavLink({ s, index, active }: { s: { id: Section; title: string; icon: string }; index: number; active: boolean }) {
  return (
    <a href={`#/${s.id}`} className="nav-link" aria-current={active ? 'page' : undefined}>
      <Icon name={s.icon} size={18} strokeWidth={active ? 2 : 1.75} />
      <span>{s.title}</span>
      <span className="nav-kbd" aria-hidden="true">⌘{index}</span>
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
