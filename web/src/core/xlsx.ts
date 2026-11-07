/**
 * Minimal, dependency-free .xlsx reader: enough to read a bank export.
 * Unzips with the platform's DecompressionStream, scans the sheet XML with
 * regular expressions (works in the browser and in Node tests alike), and
 * returns the first worksheet as rows of strings, with empty cells kept in
 * their column positions.
 */

export class XlsxError extends Error {}

interface ZipEntry { name: string; method: number; compressedSize: number; localOffset: number }

function u16(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8) }
function u32(b: Uint8Array, o: number) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

function listZip(data: Uint8Array): ZipEntry[] {
  // End-of-central-directory record: scan back past an optional comment.
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65_535); i--) {
    if (u32(data, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError('Not an .xlsx file (no zip directory found).')
  const count = u16(data, eocd + 10)
  let p = u32(data, eocd + 16)
  const dec = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (u32(data, p) !== 0x02014b50) throw new XlsxError('Corrupt .xlsx file (bad zip entry).')
    const nameLen = u16(data, p + 28), extraLen = u16(data, p + 30), commentLen = u16(data, p + 32)
    entries.push({
      name: dec.decode(data.subarray(p + 46, p + 46 + nameLen)),
      method: u16(data, p + 10),
      compressedSize: u32(data, p + 20),
      localOffset: u32(data, p + 42),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function readEntry(data: Uint8Array, e: ZipEntry): Promise<string> {
  const h = e.localOffset
  if (u32(data, h) !== 0x04034b50) throw new XlsxError('Corrupt .xlsx file (bad local header).')
  const start = h + 30 + u16(data, h + 26) + u16(data, h + 28)
  const raw = data.slice(start, start + e.compressedSize)
  let bytes: Uint8Array
  if (e.method === 0) bytes = raw
  else if (e.method === 8) {
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  } else throw new XlsxError(`Unsupported compression in .xlsx (method ${e.method}).`)
  return new TextDecoder().decode(bytes)
}

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ent: string) => {
    if (ent[0] === '#') return String.fromCodePoint(ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10))
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[ent]
  })
}

/** Concatenated text of every <t> run in a fragment (rich text included). */
function textRuns(fragment: string): string {
  let out = ''
  for (const m of fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1])
  return out
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function parseSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]))
}

export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = []
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const type = /\bt="(\w+)"/.exec(attrs)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1]
      let value = ''
      if (type === 's' && v != null) value = shared[Number(v)] ?? ''
      else if (type === 'inlineStr') value = textRuns(body)
      else if (v != null) value = decodeXml(v)
      const idx = ref ? columnIndex(ref) : row.length
      while (row.length < idx) row.push('')
      row[idx] = value
    }
    rows.push(row)
  }
  return rows
}

/** Rows of the first worksheet. */
export async function readXlsxRows(data: Uint8Array): Promise<string[][]> {
  const entries = listZip(data)
  const sheets = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(/\d+/.exec(a.name.slice(14))?.[0]) - Number(/\d+/.exec(b.name.slice(14))?.[0]))
  if (sheets.length === 0) throw new XlsxError('This file has no worksheet.')
  const sst = entries.find((e) => e.name === 'xl/sharedStrings.xml')
  const shared = sst ? parseSharedStrings(await readEntry(data, sst)) : []
  return parseSheet(await readEntry(data, sheets[0]), shared)
}
