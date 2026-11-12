import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useStore, type Appearance } from '../state/store'
import type { SyncStatus } from '../state/syncRunner'
import {
  CURRENCIES, DataFormatError, currencyMeta, headlineBalance, money, parseAppData, serializeAppData,
  type AppData, type CurrencyCode,
} from '../core'
import {
  BrandMark, Button, Card, ConfirmDialog, Field, Icon, Page, Segmented, Select, iconName, toSFSymbol } from '../ui'

const appearanceOptions: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="card-title">{children}</h2>
}

export function SettingsScreen() {
  const { data, appearance, setAppearance, setDisplayCurrency, resetToSampleData, eraseAll, replaceAll, inTelegram, sync, syncNow } = useStore()
  const dc = data.displayCurrency

  const [confirmingSample, setConfirmingSample] = useState(false)
  const [confirmingErase, setConfirmingErase] = useState(false)
  const [confirmingUpload, setConfirmingUpload] = useState(false)
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // The Mac app stores SF Symbol names, so write those back.
  const exportText = () => serializeAppData({
    ...data,
    accounts: data.accounts.map((a) => ({ ...a, icon: toSFSymbol(a.icon) })),
    goals: data.goals.map((g) => ({ ...g, icon: toSFSymbol(g.icon) })),
  })

  // Telegram's in-app browser does not reliably save downloads, so there the file's text is copied instead.
  const copyJSON = async () => {
    setImportError(null)
    try {
      await navigator.clipboard.writeText(exportText())
      setNotice('Copied. Paste it into a file named fintrack.json to use it in the Mac app.')
    } catch {
      setNotice(null)
      setImportError('Couldn’t copy to the clipboard.')
    }
  }

  const exportJSON = () => {
    const blob = new Blob([exportText()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fintrack.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Clear so picking the same file again still fires a change.
    e.target.value = ''
    if (!file) return
    setImportError(null)
    setNotice(null)
    try {
      const parsed = parseAppData(JSON.parse(await file.text()))
      setPendingImport({
        ...parsed,
        accounts: parsed.accounts.map((a) => ({ ...a, icon: iconName(a.icon) })),
        goals: parsed.goals.map((g) => ({ ...g, icon: iconName(g.icon) })),
      })
    } catch (err) {
      if (err instanceof DataFormatError || err instanceof SyntaxError) setImportError('That file isn’t a Fintrack data file.')
      else setImportError('That file couldn’t be read.')
    }
  }

  const importSummary = pendingImport
    ? [
        plural(pendingImport.transactions.length, 'transaction'),
        plural(pendingImport.accounts.length, 'account'),
        plural(pendingImport.budgets.length, 'budget'),
        plural(pendingImport.goals.length, 'goal'),
      ].join(', ')
    : ''

  const countsLine = [
    plural(data.transactions.length, 'transaction'),
    plural(data.budgets.length, 'budget'),
    plural(data.goals.length, 'goal'),
    plural(data.accounts.length, 'account'),
  ].join(' · ')

  return (
    <Page title="Settings" subtitle="Currency, rates and data">
      <div className="stack" style={{ maxWidth: 680, width: '100%' }}>
        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>Display currency</CardTitle>
            <p className="caption">Every total in Fintrack is shown in this currency, converted with your rates.</p>
            <Field label="Show totals in">
              {(id) => (
                <Select id={id} value={dc} onChange={(e) => setDisplayCurrency(e.target.value as CurrencyCode)}
                  className="select-inline" style={{ maxWidth: '100%', alignSelf: 'flex-start' }}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{currencyMeta[c].flag} {c} — {currencyMeta[c].name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="caption">
              Example: your balance is <span className="semibold num" style={{ color: 'var(--text)' }}>{money(headlineBalance(data), dc)}</span>
            </p>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>Appearance</CardTitle>
            <p className="caption">{inTelegram ? 'Follow Telegram’s theme, or pick a look for this device.' : 'Follow your system setting, or pick a look for this browser.'}</p>
            <div>
              <Segmented label="Appearance" options={appearanceOptions} value={appearance} onChange={setAppearance} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>Exchange rates</CardTitle>
            <p className="caption">Fintrack never fetches rates from the internet — every conversion uses the rates you set yourself.</p>
            <div className="stack-tight" style={{ paddingBlock: 2 }}>
              {(['USD', 'EUR'] as const).map((code) => (
                <div key={code} className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span><span aria-hidden="true">{currencyMeta[code].flag} </span>1 {code}</span>
                  <span className="semibold num">= {money(data.rates[code], 'UZS')}</span>
                </div>
              ))}
            </div>
            <div>
              <Button variant="link" icon="arrow-left-right" onClick={() => { location.hash = '#/converter' }}
                style={{ whiteSpace: 'normal', textAlign: 'start', justifyContent: 'flex-start' }}>
                Edit any rate in Converter → Your exchange rates.
              </Button>
            </div>
          </div>
        </Card>

        {inTelegram && (
          <Card>
            <div className="stack-tight" style={{ gap: 12 }}>
              <CardTitle>Telegram sync</CardTitle>
              {sync.available ? (
                <>
                  <p className="caption">
                    Your data is saved on this device and mirrored to your Telegram account’s cloud storage, so it follows you to Telegram on your other devices.
                    If two devices change it while one is offline, the later change wins.
                  </p>
                  <div className="row row-wrap" style={{ alignItems: 'center', columnGap: 12, rowGap: 8 }}>
                    <Button icon="refresh-cw" disabled={sync.phase === 'syncing'} onClick={() => syncNow()}>Sync now</Button>
                    <span className="caption num" role="status" style={{ color: sync.phase === 'error' ? 'var(--expense)' : undefined }}>
                      {syncLine(sync)}
                    </span>
                  </div>
                  {sync.incomplete && (
                    <DataRow action={<Button onClick={() => setConfirmingUpload(true)}>Upload this device’s data</Button>}>
                      Another device may have stopped halfway through saving. If this keeps happening, replace the cloud copy with what is on this device.
                    </DataRow>
                  )}
                </>
              ) : (
                <p className="caption">This version of Telegram has no cloud storage, so your data stays on this device. Update Telegram to sync between devices.</p>
              )}
            </div>
          </Card>
        )}

        <Card>
          <div className="stack-tight" style={{ gap: 14 }}>
            <CardTitle>Data</CardTitle>
            <DataRow action={<Button onClick={() => setConfirmingSample(true)}>Load sample data</Button>}>
              Replaces your transactions, budgets, goals and accounts with a demo dataset — handy for a quick tour.
            </DataRow>
            <DataRow action={<Button variant="danger" onClick={() => setConfirmingErase(true)}>Erase all data</Button>}>
              Removes every transaction, budget, goal and account. This cannot be undone.
            </DataRow>

            <hr className="divider" />

            {inTelegram ? (
              <DataRow action={<Button icon="copy" onClick={copyJSON}>Copy JSON</Button>}>
                Copies everything as the text of a fintrack.json file.
              </DataRow>
            ) : (
              <DataRow action={<Button icon="download" onClick={exportJSON}>Export JSON</Button>}>
                Saves everything to a fintrack.json file.
              </DataRow>
            )}
            <DataRow action={<Button icon="upload" onClick={() => fileInput.current?.click()}>Import JSON</Button>}>
              Replaces your data with a fintrack.json file.
            </DataRow>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />

            {importError && (
              <div className="banner" role="alert">
                <Icon name="alert-circle" size={16} />
                <span className="grow">{importError}</span>
                <Button variant="ghost" size="sm" iconOnly icon="x" onClick={() => setImportError(null)}>Dismiss</Button>
              </div>
            )}
            {notice && (
              <div className="banner banner-neutral" role="status">
                <Icon name="check" size={16} />
                <span className="grow">{notice}</span>
                <Button variant="ghost" size="sm" iconOnly icon="x" onClick={() => setNotice(null)}>Dismiss</Button>
              </div>
            )}

            <p className="caption">
              {inTelegram
                ? 'To move data between the Mac app and Telegram, use the same file: the Mac app keeps it at'
                : 'Your data lives only in this browser’s storage (localStorage) — export a copy to back it up. To move data between the Mac app and the browser, use the same file: the Mac app keeps it at'}{' '}
              <code style={{ overflowWrap: 'anywhere' }}>~/Library/Application Support/Fintrack/fintrack.json</code>.
              Import that file here, or export from here and put it in that folder while the Mac app is closed.
            </p>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <BrandMark size={44} />
              <div className="stack-tight" style={{ gap: 1 }}>
                <h2 className="semibold" style={{ fontSize: '1.0625rem' }}>Fintrack 1.1</h2>
                <span className="caption">{inTelegram ? 'Personal finance, in Telegram' : 'Personal finance, in your browser'}</span>
              </div>
            </div>
            <p className="caption">
              Budgets, goals, accounts and a converter that trusts your rates — the web companion to Fintrack for macOS.
            </p>
            <p className="caption faint num">{countsLine}</p>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmingSample}
        title="Load sample data?"
        message="Your transactions, budgets, goals and accounts will be replaced with a demo dataset. Your display currency and exchange rates are kept."
        confirmTitle="Load Sample Data"
        destructive={false}
        onConfirm={resetToSampleData}
        onClose={() => setConfirmingSample(false)}
      />
      <ConfirmDialog
        open={confirmingErase}
        title="Erase all data?"
        message="Every transaction, budget, goal and account will be permanently deleted. This cannot be undone."
        confirmTitle="Erase Everything"
        onConfirm={eraseAll}
        onClose={() => setConfirmingErase(false)}
      />
      <ConfirmDialog
        open={confirmingUpload}
        title="Replace the cloud copy?"
        message="What is on this device will be uploaded and will replace your data in Telegram on every other device."
        confirmTitle="Upload"
        onConfirm={() => syncNow('push')}
        onClose={() => setConfirmingUpload(false)}
      />
      <ConfirmDialog
        open={pendingImport !== null}
        title="Replace your data with this file?"
        message={`The file has ${importSummary}. Everything ${inTelegram ? 'here' : 'in this browser'}, including your display currency and exchange rates, will be replaced.`}
        confirmTitle="Replace Data"
        onConfirm={() => {
          if (!pendingImport) return
          replaceAll(pendingImport)
          setNotice(`Imported ${importSummary}.`)
        }}
        onClose={() => setPendingImport(null)}
      />
    </Page>
  )
}

function syncLine(sync: SyncStatus): string {
  if (sync.phase === 'syncing') return 'Syncing…'
  if (sync.phase === 'error') return `Couldn’t sync: ${sync.error ?? 'unknown error'}`
  if (sync.lastSyncedAt === null) return 'Not synced yet'
  return `Synced at ${new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

function DataRow({ action, children }: { action: ReactNode; children: ReactNode }) {
  return (
    <div className="row row-wrap" style={{ alignItems: 'center', columnGap: 12, rowGap: 6 }}>
      <span style={{ flex: 'none' }}>{action}</span>
      <span className="caption" style={{ flex: '1 1 220px', minWidth: 0 }}>{children}</span>
    </div>
  )
}
