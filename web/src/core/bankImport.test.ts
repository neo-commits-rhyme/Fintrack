import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { readXlsxRows, parseSharedStrings, parseSheet } from './xlsx'
import {
  buildTransactions, cleanMerchantName, fnv1a64, parseStatement, REASONS, StatementFormatError, suggest,
} from './bankImport'
import { parseAppData, serializeAppData, emptyData } from './persistence'

const FIXTURE = new URL('../../../fixtures/bank-statement-sample.xlsx', import.meta.url)
const EXPECTED = new URL('../../../fixtures/bank-statement-sample.expected.json', import.meta.url)

async function fixtureDrafts(hasCashSource = false, existing = new Set<string>()) {
  const rows = parseStatement(await readXlsxRows(new Uint8Array(fs.readFileSync(FIXTURE))))
  return suggest(rows, { existingImportIDs: existing, hasCashSource })
}

/** The shape both apps must agree on (Swift checks the same JSON). */
function summary(d: Awaited<ReturnType<typeof fixtureDrafts>>) {
  return d.map((x) => ({
    line: x.row.line, localDate: x.row.localDate, credit: x.row.credit, amount: x.row.amount,
    importID: x.row.importID, include: x.include, kind: x.kind, category: x.category, title: x.title,
    reason: x.reason ?? null, needsAttention: x.needsAttention, waitsForCashSource: x.waitsForCashSource,
  }))
}

describe('xlsx reader', () => {
  it('reads shared strings, inline strings, numbers and keeps sparse columns in place', async () => {
    const rows = await readXlsxRows(new Uint8Array(fs.readFileSync(FIXTURE)))
    expect(rows[0][5]).toBe('Сумма платежа')
    expect(rows[1].slice(0, 3)).toEqual(['07-11-2026', '22:23:59', 'Списание'])
    expect(rows[2][3]).toBe('OOO YANDEXGO UB') // inline string cell
    expect(rows[1][7]).toBe('') // omitted empty cell stays a blank in its column
    expect(rows[1][15]).toBe('50420\t')
  })
  it('decodes entities and rich-text runs', () => {
    const shared = parseSharedStrings('<sst><si><t>A &amp; B</t></si><si><r><t>Мульти</t></r><r><t xml:space="preserve"> строка</t></r></si></sst>')
    expect(shared).toEqual(['A & B', 'Мульти строка'])
    expect(parseSheet('<sheetData><row r="1"><c r="C1" t="s"><v>1</v></c></row></sheetData>', shared)).toEqual([['', '', 'Мульти строка']])
  })
  it('rejects a file that is not a zip', async () => {
    await expect(readXlsxRows(new TextEncoder().encode('hello'))).rejects.toThrow(/xlsx/i)
  })
})

describe('statement parsing', () => {
  it('parses every data row with clean fields', async () => {
    const d = await fixtureDrafts()
    expect(d).toHaveLength(17)
    const transfer = d.find((x) => x.row.party === 'Testova A.')!
    expect(transfer.row.cardLast4).toBe('1111')
    expect(transfer.row.localDate).toBe('06-11-2026 22:06:40')
    const local = new Date(transfer.row.date)
    expect([local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()]).toEqual([6, 22, 6, 40])
  })
  it('refuses a sheet without the amount column', () => {
    expect(() => parseStatement([['a', 'b'], ['1', '2']])).toThrow(StatementFormatError)
  })
  it('import ids are stable and distinct', async () => {
    const a = await fixtureDrafts(), b = await fixtureDrafts()
    expect(a.map((x) => x.row.importID)).toEqual(b.map((x) => x.row.importID))
    expect(new Set(a.map((x) => x.row.importID)).size).toBe(a.length)
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
  })
  it('cleans merchant names', () => {
    expect(cleanMerchantName('OOO INTERNATIONAL FOODCHAIN')).toBe('International Foodchain')
    expect(cleanMerchantName('EDEN SEUL MCHJ XK')).toBe('Eden Seul')
    expect(cleanMerchantName('ELNUR ZIYO BIZNES N777 MCHJ')).toBe('Elnur Ziyo Biznes N777')
    expect(cleanMerchantName('ИП ООО «ANGLESEY FOOD»')).toBe('Anglesey Food')
  })
})

describe('suggestions', () => {
  it('match the shared expected fixture (the Mac app checks the same file)', async () => {
    const actual = summary(await fixtureDrafts())
    if (process.env.UPDATE_FIXTURE) fs.writeFileSync(EXPECTED, JSON.stringify(actual, null, 2) + '\n')
    expect(actual).toEqual(JSON.parse(fs.readFileSync(EXPECTED, 'utf8')))
  })
  it('a picked cash source turns cash deposits on', async () => {
    const d = await fixtureDrafts(true)
    const cash = d.find((x) => x.waitsForCashSource)!
    expect(cash.include).toBe(true)
    expect(cash.reason).toBeUndefined()
  })
  it('rows already imported are switched off', async () => {
    const first = await fixtureDrafts()
    const again = await fixtureDrafts(false, new Set(first.map((x) => x.row.importID)))
    expect(again.every((x) => !x.include && x.reason === REASONS.duplicate || x.reason === REASONS.notCompleted)).toBe(true)
  })
})

describe('building transactions', () => {
  it('creates expenses and income on the card, cash deposits as transfers, and round-trips importID', async () => {
    const drafts = await fixtureDrafts(true)
    const txs = buildTransactions(drafts, { accountID: 'CARD', cashSourceID: 'CASH' })
    expect(txs).toHaveLength(drafts.filter((d) => d.include).length)
    const deposit = txs.find((t) => t.title === 'Cash deposit')!
    expect(deposit).toMatchObject({ kind: 'transfer', fromAccountID: 'CASH', toAccountID: 'CARD', amount: 8_000_000 })
    const taxi = txs.find((t) => t.category === 'taxi')!
    expect(taxi).toMatchObject({ kind: 'expense', accountID: 'CARD', currency: 'UZS', title: 'Yandex Go' })
    expect(txs.every((t) => t.importID)).toBe(true)
    const data = { ...emptyData(), transactions: txs }
    const back = parseAppData(JSON.parse(serializeAppData(data)))
    expect(back.transactions.map((t) => t.importID).sort()).toEqual(txs.map((t) => t.importID).sort())
  })
  it('skips cash deposits when no source account is given', async () => {
    const drafts = (await fixtureDrafts(true))
    const txs = buildTransactions(drafts, { accountID: 'CARD' })
    expect(txs.some((t) => t.kind === 'transfer')).toBe(false)
  })
})
