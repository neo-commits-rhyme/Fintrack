import { useEffect, useId, useState } from 'react'
import { useStore } from '../state/store'
import { CURRENCIES, convert, currencyMeta, money, rateString, type CurrencyCode } from '../core'
import { AmountInput, Button, Card, ConfirmDialog, CurrencySelect, Field, Icon, Page, SectionHeader } from '../ui'

const editableCurrencies = CURRENCIES.filter((c) => c !== 'UZS')

/** A typed rate is accepted only when it is a sane positive number. */
function isValidRate(v: number | null): v is number {
  return v !== null && Number.isFinite(v) && v > 0 && v < 1e12
}

export function ConverterScreen() {
  const { data, resetRatesToDefaults, converter, setConverter } = useStore()
  const rates = data.rates

  // Input lives in the store so it survives switching screens.
  const amount = converter.amount
  const from = converter.from
  const to: CurrencyCode = converter.to ?? (data.displayCurrency === from ? 'UZS' : data.displayCurrency)
  const setAmount = (v: number | null) => setConverter({ amount: v })
  const setFrom = (v: CurrencyCode) => setConverter({ from: v })
  const setTo = (v: CurrencyCode) => setConverter({ to: v })
  const [swapTurns, setSwapTurns] = useState(0)
  const [confirmingReset, setConfirmingReset] = useState(false)

  // Never negative, never empty.
  const effective = Math.max(0, amount ?? 0)
  const converted = convert(rates, effective, from, to)

  // Picking the same currency on both sides swaps them, like the Mac app.
  const changeFrom = (next: CurrencyCode) => {
    if (next === to) setTo(from)
    setFrom(next)
  }
  const changeTo = (next: CurrencyCode) => {
    if (next === from) setFrom(to)
    setTo(next)
  }
  const swap = () => {
    setFrom(to)
    setTo(from)
    setSwapTurns((n) => n + 1)
  }

  const forward = rateString(convert(rates, 1, from, to), to)
  const backward = rateString(convert(rates, 1, to, from), from)

  return (
    <Page title="Converter" subtitle="Your rates, your rules">
      <Card>
        <div className="stack-tight" style={{ gap: 18, padding: 8 }}>
          <div className="row" style={{ gap: 'var(--grid-gap)' }}>
            <div className="grow">
              <Field label="Amount">
                {(id) => <AmountInput id={id} hero value={amount} onChange={setAmount} />}
              </Field>
            </div>
            <div style={{ flex: 'none' }}>
              <CurrencySelect value={from} onChange={changeFrom} inline ariaLabel="From currency" />
            </div>
          </div>

          <div className="row" style={{ gap: 14 }}>
            <hr className="divider grow" />
            <button type="button" className="btn btn-icon" onClick={swap} aria-label="Swap currencies" title="Swap currencies"
              style={{ borderRadius: '50%', flex: 'none' }}>
              <Icon name="arrow-up-down" size={16} strokeWidth={2}
                style={{ rotate: `${swapTurns * 180}deg`, transition: 'rotate var(--dur-base) var(--ease-out)' }} />
            </button>
            <hr className="divider grow" />
          </div>

          <div className="row" style={{ gap: 'var(--grid-gap)' }}>
            <div className="grow stack-tight" style={{ gap: 6 }}>
              <span className="field-label">Converted</span>
              <div className="hero-number num" style={{ fontSize: 'clamp(1.75rem, 7vw, var(--text-hero))' }}>{money(converted, to)}</div>
            </div>
            <div style={{ flex: 'none' }}>
              <CurrencySelect value={to} onChange={changeTo} inline ariaLabel="To currency" />
            </div>
          </div>

          <p className="caption num row row-wrap" style={{ gap: '2px 10px' }}>
            <span>1 {from} = {forward}</span>
            <span aria-hidden="true">·</span>
            <span>1 {to} = {backward}</span>
          </p>
        </div>
      </Card>

      <SectionHeader title="Everything at once" />
      <Card>
        <div className="grid grid-auto-150">
          {CURRENCIES.filter((c) => c !== from).map((code) => {
            const text = money(convert(rates, effective, from, code), code)
            return (
              <div key={code} className="stack-tight" style={{ gap: 6, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span aria-hidden="true">{currencyMeta[code].flag}</span>
                  <span className="caption">{code}</span>
                </div>
                <span className="num semibold truncate" style={{ fontSize: '1.0625rem' }} title={text}>{text}</span>
              </div>
            )
          })}
        </div>
      </Card>

      <SectionHeader title="Your exchange rates" subtitle="UZS per 1 unit — edit anytime" />
      <Card>
        <div className="list">
          {editableCurrencies.map((code) => <RateRow key={code} code={code} />)}
        </div>
        <div className="row row-wrap" style={{ justifyContent: 'space-between', paddingBlockStart: 14, marginBlockStart: 4, borderBlockStart: '1px solid var(--hairline)' }}>
          <span className="caption">All conversions cross through UZS.</span>
          <Button onClick={() => setConfirmingReset(true)}>Reset to defaults</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset exchange rates?"
        message="Every currency goes back to Fintrack’s built-in rate. Rates you’ve entered yourself will be replaced."
        confirmTitle="Reset to Defaults"
        onConfirm={resetRatesToDefaults}
        onClose={() => setConfirmingReset(false)}
      />
    </Page>
  )
}

/** One editable rate: flag, code, full name and a "1 XXX = ____ soʻm" field. */
function RateRow({ code }: { code: CurrencyCode }) {
  const { data, setRate } = useStore()
  const stored = data.rates[code]
  const meta = currencyMeta[code]
  const errorId = useId()
  const [draft, setDraft] = useState<number | null>(stored)

  // Follow outside changes (reset to defaults, import).
  useEffect(() => { setDraft(stored) }, [stored])

  const invalid = !isValidRate(draft)

  return (
    <div className="list-row row-wrap" style={{ paddingBlock: 10, columnGap: 12, rowGap: 8 }}>
      <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1, flex: 'none' }}>{meta.flag}</span>
      <div className="row-main" style={{ minWidth: 120 }}>
        <span className="row-title">{code}</span>
        <span className="row-detail truncate">{meta.name}</span>
      </div>
      <div className="row" style={{ gap: 8, flex: 'none', marginInlineStart: 'auto' }}>
        <span className="caption num" style={{ whiteSpace: 'nowrap' }}>1 {code} =</span>
        <AmountInput
          value={draft}
          placeholder="Rate"
          aria-label={`UZS per 1 ${code}`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          style={{ width: 120, textAlign: 'end' }}
          onChange={(v) => {
            setDraft(v)
            if (isValidRate(v)) setRate(v, code)
          }}
          onBlur={() => { if (!isValidRate(draft)) setDraft(stored) }}
        />
        <span className="caption">soʻm</span>
      </div>
      {invalid && (
        <span id={errorId} className="field-error" role="alert" style={{ flexBasis: '100%', justifyContent: 'flex-end' }}>
          <Icon name="alert-circle" size={14} />Enter a rate above 0
        </span>
      )}
    </div>
  )
}
