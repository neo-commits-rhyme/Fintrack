import { useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useStore, type Appearance } from '../state/store'
import type { SyncStatus } from '../state/syncRunner'
import {
  CURRENCIES, DataFormatError, headlineBalance, money, parseAppData, serializeAppData,
  type AppData, type CurrencyCode,
} from '../core'
import {
  BrandMark, Button, Card, ConfirmDialog, Field, Icon, Page, Segmented, Select, iconName, toSFSymbol } from '../ui'
import { LANGUAGES, t } from '../i18n'
import { currencyName } from '../i18n/labels'

const appearanceOptions: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Renders a translated sentence with a piece of markup in place of its `{slot}` placeholder. */
function withSlot(text: string, slot: string, node: ReactNode): ReactNode {
  const at = text.indexOf(`{${slot}}`)
  if (at < 0) return text
  return <>{text.slice(0, at)}{node}{text.slice(at + slot.length + 2)}</>
}

function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="card-title">{children}</h2>
}

export function SettingsScreen() {
  const { data, appearance, setAppearance, language, setLanguage, setDisplayCurrency, resetToSampleData, eraseAll, replaceAll, inTelegram, sync, syncNow } = useStore()
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
      setNotice(t('Copied. Paste it into a file named fintrack.json to use it in the Mac app.'))
    } catch {
      setNotice(null)
      setImportError(t('Couldn’t copy to the clipboard.'))
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
      if (err instanceof DataFormatError || err instanceof SyntaxError) setImportError(t('That file isn’t a Fintrack data file.'))
      else setImportError(t('That file couldn’t be read.'))
    }
  }

  const importSummary = pendingImport
    ? [
        t('{n} transaction|{n} transactions', { n: pendingImport.transactions.length }),
        t('{n} account|{n} accounts', { n: pendingImport.accounts.length }),
        t('{n} budget|{n} budgets', { n: pendingImport.budgets.length }),
        t('{n} goal|{n} goals', { n: pendingImport.goals.length }),
      ].join(', ')
    : ''

  return (
    <Page title={t('Settings')}>
      <div className="stack" style={{ maxWidth: 680, width: '100%' }}>
        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>{t('Display currency')}</CardTitle>
            <Field label={t('Show totals in')}>
              {(id) => (
                <Select id={id} value={dc} onChange={(e) => setDisplayCurrency(e.target.value as CurrencyCode)}
                  className="select-inline" style={{ maxWidth: '100%', alignSelf: 'flex-start' }}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c} ({currencyName(c)})</option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="caption">
              {withSlot(t('Example: your balance is {amount}'), 'amount',
                <span className="semibold num" style={{ color: 'var(--text)' }}>{money(headlineBalance(data), dc)}</span>)}
            </p>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>{t('Language')}</CardTitle>
            <div>
              {/* Each language is written in itself, so it can be found whatever is showing now. */}
              <Segmented label={t('Language')} options={LANGUAGES} value={language} onChange={setLanguage} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>{t('Appearance')}</CardTitle>
            <div>
              <Segmented label={t('Appearance')} options={appearanceOptions.map((o) => ({ ...o, label: t(o.label) }))} value={appearance} onChange={setAppearance} />
            </div>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <CardTitle>{t('Exchange rates')}</CardTitle>
            <p className="caption">{t('Fintrack never fetches rates from the internet. Every conversion uses the rates you set.')}</p>
            <div className="stack-tight" style={{ paddingBlock: 2 }}>
              {(['USD', 'EUR'] as const).map((code) => (
                <div key={code} className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>1 {code}</span>
                  <span className="semibold num">= {money(data.rates[code], 'UZS')}</span>
                </div>
              ))}
            </div>
            <div>
              <Button icon="arrow-left-right" onClick={() => { location.hash = '#/converter' }}>
                {t('Edit rates in Converter')}
              </Button>
            </div>
          </div>
        </Card>

        {inTelegram && (
          <Card>
            <div className="stack-tight" style={{ gap: 12 }}>
              <CardTitle>{t('Telegram sync')}</CardTitle>
              {sync.available ? (
                <>
                  <p className="caption">
                    {t('Your data is saved on this device and mirrored to your Telegram account’s cloud storage, so it follows you to Telegram on your other devices. If two devices change it while one is offline, the later change wins.')}
                  </p>
                  <div className="row row-wrap" style={{ alignItems: 'center', columnGap: 12, rowGap: 8 }}>
                    <Button icon="refresh-cw" disabled={sync.phase === 'syncing'} onClick={() => syncNow()}>{t('Sync now')}</Button>
                    <span className="caption num" role="status" style={{ color: sync.phase === 'error' ? 'var(--expense)' : undefined }}>
                      {syncLine(sync)}
                    </span>
                  </div>
                  {sync.incomplete && (
                    <DataRow action={<Button onClick={() => setConfirmingUpload(true)}>{t('Upload this device’s data')}</Button>}>
                      {t('Another device may have stopped halfway through saving. If this keeps happening, replace the cloud copy with what is on this device.')}
                    </DataRow>
                  )}
                </>
              ) : (
                <p className="caption">{t('This version of Telegram has no cloud storage, so your data stays on this device. Update Telegram to sync between devices.')}</p>
              )}
            </div>
          </Card>
        )}

        <Card>
          <div className="stack-tight" style={{ gap: 14 }}>
            <CardTitle>{t('Data')}</CardTitle>
            <DataRow action={<Button onClick={() => setConfirmingSample(true)}>{t('Load sample data')}</Button>}>
              {t('Replaces your transactions, budgets, goals and accounts with a demo dataset.')}
            </DataRow>
            <DataRow action={<Button variant="danger" onClick={() => setConfirmingErase(true)}>{t('Erase all data')}</Button>}>
              {t('Removes every transaction, budget, goal and account. This cannot be undone.')}
            </DataRow>

            <hr className="divider" />

            {inTelegram ? (
              <DataRow action={<Button icon="copy" onClick={copyJSON}>{t('Copy JSON')}</Button>}>
                {t('Copies everything as the text of a fintrack.json file.')}
              </DataRow>
            ) : (
              <DataRow action={<Button icon="download" onClick={exportJSON}>{t('Export JSON')}</Button>}>
                {t('Saves everything to a fintrack.json file.')}
              </DataRow>
            )}
            <DataRow action={<Button icon="upload" onClick={() => fileInput.current?.click()}>{t('Import JSON')}</Button>}>
              {t('Replaces your data with a fintrack.json file.')}
            </DataRow>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={onFile} />

            {importError && (
              <div className="banner" role="alert">
                <Icon name="alert-circle" size={16} />
                <span className="grow">{importError}</span>
                <Button variant="ghost" size="sm" iconOnly icon="x" onClick={() => setImportError(null)}>{t('Dismiss')}</Button>
              </div>
            )}
            {notice && (
              <div className="banner banner-neutral" role="status">
                <Icon name="check" size={16} />
                <span className="grow">{notice}</span>
                <Button variant="ghost" size="sm" iconOnly icon="x" onClick={() => setNotice(null)}>{t('Dismiss')}</Button>
              </div>
            )}

            <p className="caption">
              {withSlot(
                inTelegram
                  ? t('To move data between the Mac app and Telegram, use the same file: the Mac app keeps it at {path}. Import that file here, or export from here and put it in that folder while the Mac app is closed.')
                  : t('Your data lives only in this browser. Export a copy to back it up. To move data between the Mac app and the browser, use the same file: the Mac app keeps it at {path}. Import that file here, or export from here and put it in that folder while the Mac app is closed.'),
                'path',
                <code style={{ overflowWrap: 'anywhere' }}>~/Library/Application Support/Fintrack/fintrack.json</code>,
              )}
            </p>
          </div>
        </Card>

        <Card>
          <div className="stack-tight" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 12 }}>
              <BrandMark size={44} />
              <div className="stack-tight" style={{ gap: 1 }}>
                <h2 className="semibold" style={{ fontSize: '1.0625rem' }}>Fintrack 1.1</h2>
                <span className="caption">{inTelegram ? t('Personal finance, in Telegram') : t('Personal finance, in your browser')}</span>
              </div>
            </div>
            <p className="caption">{t('The web version of Fintrack for macOS.')}</p>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmingSample}
        title={t('Load sample data?')}
        message={t('Your transactions, budgets, goals and accounts will be replaced with a demo dataset. Your display currency and exchange rates are kept.')}
        confirmTitle={t('Load sample data')}
        destructive={false}
        onConfirm={resetToSampleData}
        onClose={() => setConfirmingSample(false)}
      />
      <ConfirmDialog
        open={confirmingErase}
        title={t('Erase all data?')}
        message={t('Every transaction, budget, goal and account will be permanently deleted. This cannot be undone.')}
        confirmTitle={t('Erase everything')}
        onConfirm={eraseAll}
        onClose={() => setConfirmingErase(false)}
      />
      <ConfirmDialog
        open={confirmingUpload}
        title={t('Replace the cloud copy?')}
        message={t('What is on this device will be uploaded and will replace your data in Telegram on every other device.')}
        confirmTitle={t('Upload')}
        onConfirm={() => syncNow('push')}
        onClose={() => setConfirmingUpload(false)}
      />
      <ConfirmDialog
        open={pendingImport !== null}
        title={t('Replace your data with this file?')}
        message={inTelegram
          ? t('The file has {summary}. Everything here, including your display currency and exchange rates, will be replaced.', { summary: importSummary })
          : t('The file has {summary}. Everything in this browser, including your display currency and exchange rates, will be replaced.', { summary: importSummary })}
        confirmTitle={t('Replace data')}
        onConfirm={() => {
          if (!pendingImport) return
          replaceAll(pendingImport)
          setNotice(t('Imported {summary}.', { summary: importSummary }))
        }}
        onClose={() => setPendingImport(null)}
      />
    </Page>
  )
}

function syncLine(sync: SyncStatus): string {
  if (sync.phase === 'syncing') return t('Syncing…')
  if (sync.phase === 'error') return t('Couldn’t sync: {error}', { error: sync.error ?? t('unknown error') })
  if (sync.lastSyncedAt === null) return t('Not synced yet')
  return t('Synced at {time}', { time: new Date(sync.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
}

function DataRow({ action, children }: { action: ReactNode; children: ReactNode }) {
  return (
    <div className="row row-wrap" style={{ alignItems: 'center', columnGap: 12, rowGap: 6 }}>
      <span style={{ flex: 'none' }}>{action}</span>
      <span className="caption" style={{ flex: '1 1 220px', minWidth: 0 }}>{children}</span>
    </div>
  )
}
