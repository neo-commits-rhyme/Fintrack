import { parseAppData } from './persistence'
import type { AppData, Transaction } from './models'

/**
 * Mirrors AppData into a small key-value store with Telegram CloudStorage limits:
 * 1024 keys, values of at most 4096 characters, keys made of [A-Za-z0-9_-].
 *
 * Layout (every value is ASCII-only JSON text, cut into pieces of at most CHUNK characters):
 *   ft_meta       { v, n, rev, dev, h, t, sum } — see CloudMeta
 *   ft_h_<i>      everything except transactions
 *   ft_t_<b>_<j>  the transactions whose id hashes to bucket b of n
 *
 * Buckets keep one edit from rewriting the whole file: it normally touches one bucket and the meta key.
 */

export interface CloudKV {
  /** Missing keys come back as '' or are absent. */
  getItems(keys: string[]): Promise<Record<string, string>>
  setItem(key: string, value: string): Promise<void>
  removeItems(keys: string[]): Promise<void>
  getKeys(): Promise<string[]>
}

export const CLOUD_META_KEY = 'ft_meta'
export const CLOUD_PREFIX = 'ft_'
export const CLOUD_CHUNK = 4000
export const CLOUD_MAX_KEYS = 1000
const MAX_BUCKETS = 256
/** Grow the bucket count once buckets average more than this, so most stay within one value. */
const BUCKET_TARGET = 2400
const READ_BATCH = 100
const WRITE_PARALLEL = 6

export interface CloudMeta {
  v: 1
  /** Number of transaction buckets (a power of two that only grows while there are transactions). */
  n: number
  /** Revision: the millisecond timestamp of the write, strictly increasing. */
  rev: number
  /** Device that wrote this revision. */
  dev: string
  /** Number of ft_h_ pieces. */
  h: number
  /** Number of pieces per bucket. */
  t: number[]
  /** Checksum of every piece named by h and t. */
  sum: string
}

/** The cloud copy is mid-write or damaged: nothing was adopted. */
export class CloudBusyError extends Error {}
/** The data does not fit into the cloud store. */
export class CloudFullError extends Error {}

function fnv1a(text: string, seed = 0x811c9dc5): number {
  let h = seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** JSON with every non-ASCII character escaped, so characters and bytes are the same count. */
function asciiJSON(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

function pieces(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += CLOUD_CHUNK) out.push(text.slice(i, i + CLOUD_CHUNK))
  return out
}

const headKey = (i: number) => `ft_h_${i}`
const bucketKey = (b: number, j: number) => `ft_t_${b}_${j}`

function dataKeys(meta: Pick<CloudMeta, 'h' | 't'>): string[] {
  const keys: string[] = []
  for (let i = 0; i < meta.h; i++) keys.push(headKey(i))
  meta.t.forEach((count, b) => { for (let j = 0; j < count; j++) keys.push(bucketKey(b, j)) })
  return keys
}

function checksum(keys: string[], entries: Record<string, string | undefined>): string {
  let h = 0x811c9dc5
  for (const k of keys) h = fnv1a(`${k}=${entries[k] ?? ''}\n`, h)
  return h.toString(16).padStart(8, '0')
}

export function isEmptyData(d: AppData): boolean {
  return d.transactions.length === 0 && d.budgets.length === 0 && d.goals.length === 0 && d.accounts.length === 0
}

/** Lays the data out as cloud entries (without the meta key). `prevN` keeps the bucket count stable between writes. */
export function encodeCloud(data: AppData, prevN = 1): { entries: Record<string, string>; n: number; h: number; t: number[] } {
  const entries: Record<string, string> = {}
  const { transactions, ...head } = data
  const headPieces = pieces(asciiJSON(head))
  headPieces.forEach((p, i) => { entries[headKey(i)] = p })

  const encoded = transactions.map((tx) => ({ id: tx.id, json: asciiJSON(tx) }))
  let n = 1
  if (encoded.length > 0) {
    const total = encoded.reduce((sum, e) => sum + e.json.length + 1, 0)
    n = Math.max(1, prevN)
    while (n < MAX_BUCKETS && total / n > BUCKET_TARGET) n *= 2
  }
  const buckets: string[][] = Array.from({ length: n }, () => [])
  for (const e of encoded) buckets[fnv1a(e.id) % n].push(e.json)
  const t = buckets.map((items, b) => {
    if (items.length === 0) return 0
    const parts = pieces(`[${items.join(',')}]`)
    parts.forEach((p, j) => { entries[bucketKey(b, j)] = p })
    return parts.length
  })
  return { entries, n, h: headPieces.length, t }
}

export function parseCloudMeta(raw: string | undefined): CloudMeta | null {
  if (!raw) return null
  let m: unknown
  try { m = JSON.parse(raw) } catch { throw new CloudBusyError('The cloud copy could not be read.') }
  const o = m as Partial<CloudMeta> | null
  if (!o || o.v !== 1 || typeof o.rev !== 'number' || typeof o.n !== 'number' || typeof o.h !== 'number'
    || !Array.isArray(o.t) || typeof o.sum !== 'string') {
    throw new CloudBusyError('The cloud copy was written by a newer version of Fintrack.')
  }
  return o as CloudMeta
}

/** Rebuilds AppData from cloud entries. Throws CloudBusyError when the pieces do not match the meta checksum. */
export function decodeCloud(meta: CloudMeta, entries: Record<string, string | undefined>): AppData {
  if (checksum(dataKeys(meta), entries) !== meta.sum) throw new CloudBusyError('The cloud copy is incomplete.')
  try {
    let headText = ''
    for (let i = 0; i < meta.h; i++) headText += entries[headKey(i)] ?? ''
    const transactions: Transaction[] = []
    meta.t.forEach((count, b) => {
      if (count === 0) return
      let text = ''
      for (let j = 0; j < count; j++) text += entries[bucketKey(b, j)] ?? ''
      transactions.push(...(JSON.parse(text) as Transaction[]))
    })
    return parseAppData({ ...(JSON.parse(headText) as object), transactions })
  } catch {
    throw new CloudBusyError('The cloud copy could not be read.')
  }
}

// ---- sync engine ------------------------------------------------------------------------------

export interface SyncState {
  /** Cloud revision this device last pushed or pulled; null = never synced. */
  rev: number | null
  /** Timestamp of the latest local edit that has not reached the cloud; null = clean. */
  dirtyAt: number | null
  /** Bucket count last seen. */
  n: number
}

export const initialSyncState: SyncState = { rev: null, dirtyAt: null, n: 1 }

export interface SyncStateStore {
  load(): SyncState
  save(state: SyncState): void
}

export type SyncResult =
  | { action: 'none' | 'pushed' }
  /** `replacedUnsynced`: the local data had content that never reached the cloud — keep a copy before replacing it. */
  | { action: 'pulled'; data: AppData; replacedUnsynced: boolean }

export class CloudSync {
  /** Cloud contents as last seen; undefined values mean "exists, content unknown". */
  private known: Record<string, string | undefined> | null = null
  /** The cloud revision `known` describes; another device's write makes it stale. */
  private knownRev: number | null = null

  constructor(
    private kv: CloudKV,
    private state: SyncStateStore,
    private device: string,
    private now: () => number = Date.now,
  ) {}

  /** Call on every local edit. */
  markDirty(): void {
    this.state.save({ ...this.state.load(), dirtyAt: this.now() })
  }

  /**
   * Reconciles local data with the cloud: whole-file, last write wins.
   * `force: 'push'` uploads this device's data no matter what the cloud holds.
   * Throws CloudBusyError (cloud mid-write: try again shortly), CloudFullError, or the store's own error.
   */
  async sync(getLocal: () => AppData, force?: 'push'): Promise<SyncResult> {
    let meta: CloudMeta | null
    try {
      meta = parseCloudMeta((await this.kv.getItems([CLOUD_META_KEY]))[CLOUD_META_KEY])
    } catch (e) {
      if (force === 'push' && e instanceof CloudBusyError) meta = null
      else throw e
    }
    if (force === 'push') return this.push(getLocal(), meta)

    const st = this.state.load()
    if (!meta) {
      if (isEmptyData(getLocal()) && st.dirtyAt === null) return { action: 'none' }
      return this.push(getLocal(), null)
    }
    if (meta.rev === st.rev) return st.dirtyAt === null ? { action: 'none' } : this.push(getLocal(), meta)
    if (localWins(st, meta)) return this.push(getLocal(), meta)

    // The cloud is ahead: fetch it, then decide again in case an edit landed while fetching.
    const keys = dataKeys(meta)
    const entries: Record<string, string | undefined> = {}
    for (let i = 0; i < keys.length; i += READ_BATCH) Object.assign(entries, await this.kv.getItems(keys.slice(i, i + READ_BATCH)))
    const data = decodeCloud(meta, entries)
    const after = this.state.load()
    if (localWins(after, meta)) return this.push(getLocal(), meta)

    this.known = { ...entries, [CLOUD_META_KEY]: undefined }
    this.knownRev = meta.rev
    const replacedUnsynced = !isEmptyData(getLocal()) && (after.rev === null || after.dirtyAt !== null)
    this.state.save({ rev: meta.rev, dirtyAt: null, n: meta.n })
    return { action: 'pulled', data, replacedUnsynced }
  }

  private async push(local: AppData, meta: CloudMeta | null): Promise<SyncResult> {
    const before = this.state.load()
    const { entries, n, h, t } = encodeCloud(local, Math.max(before.n, meta?.n ?? 1))
    const keys = Object.keys(entries)
    if (keys.length > CLOUD_MAX_KEYS) throw new CloudFullError('There is more data than Telegram cloud storage can hold.')

    if (!this.known || this.knownRev !== (meta?.rev ?? null)) {
      this.known = {}
      for (const k of await this.kv.getKeys()) if (k.startsWith(CLOUD_PREFIX)) this.known[k] = undefined
    }
    const known = this.known
    const changed = keys.filter((k) => known[k] !== entries[k])
    // Until the meta key lands, what we know about the cloud is unreliable.
    this.known = null
    for (let i = 0; i < changed.length; i += WRITE_PARALLEL) {
      await Promise.all(changed.slice(i, i + WRITE_PARALLEL).map((k) => this.kv.setItem(k, entries[k])))
    }
    const rev = Math.max(this.now(), (meta?.rev ?? 0) + 1, (before.rev ?? 0) + 1)
    const next: CloudMeta = { v: 1, n, rev, dev: this.device, h, t, sum: checksum(dataKeys({ h, t }), entries) }
    const metaText = asciiJSON(next)
    await this.kv.setItem(CLOUD_META_KEY, metaText)

    const after = this.state.load()
    this.state.save({ rev, n, dirtyAt: after.dirtyAt === before.dirtyAt ? null : after.dirtyAt })

    const stale = Object.keys(known).filter((k) => k !== CLOUD_META_KEY && !(k in entries))
    this.known = { ...entries, [CLOUD_META_KEY]: metaText }
    this.knownRev = rev
    if (stale.length > 0) {
      // Leftovers are harmless (the meta names every piece in use); remember them so a later push retries.
      try { await this.kv.removeItems(stale) } catch { for (const k of stale) this.known[k] = undefined }
    }
    return { action: 'pushed' }
  }
}

/** Unsynced local edits beat a cloud revision only when this device has synced before and edited later. */
function localWins(st: SyncState, meta: CloudMeta): boolean {
  return st.rev !== null && st.dirtyAt !== null && st.dirtyAt > meta.rev
}
