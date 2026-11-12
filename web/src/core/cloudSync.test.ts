import { describe, expect, it } from 'vitest'
import {
  CLOUD_META_KEY, CloudBusyError, CloudFullError, CloudSync, decodeCloud, encodeCloud, initialSyncState, parseCloudMeta,
  type CloudKV, type SyncState, type SyncStateStore,
} from './cloudSync'
import { emptyData } from './persistence'
import { sampleData } from './sample'
import { sortTransactions } from './analytics'
import { newID, type AppData, type Transaction } from './models'

// ---- fakes ------------------------------------------------------------------------------------

/** In-memory store that enforces Telegram CloudStorage's limits and records every write. */
class FakeKV implements CloudKV {
  items = new Map<string, string>()
  writes: string[] = []
  removed: string[] = []
  /** Throw on the Nth setItem from now (1-based); 0 = never. */
  failOnWrite = 0

  async getItems(keys: string[]) {
    const out: Record<string, string> = {}
    for (const k of keys) out[k] = this.items.get(k) ?? ''
    return out
  }
  async setItem(key: string, value: string) {
    if (this.failOnWrite > 0 && --this.failOnWrite === 0) throw new Error('network')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw new Error(`bad key ${key}`)
    if (value.length > 4096 || /[^\x00-\x7e]/.test(value)) throw new Error(`bad value for ${key}`)
    this.items.set(key, value)
    this.writes.push(key)
    if (this.items.size > 1024) throw new Error('too many keys')
  }
  async removeItems(keys: string[]) {
    for (const k of keys) { this.items.delete(k); this.removed.push(k) }
  }
  async getKeys() { return [...this.items.keys()] }
}

function memoryState(initial: SyncState = initialSyncState): SyncStateStore & { current: SyncState } {
  const box = {
    current: { ...initial },
    load: () => ({ ...box.current }),
    save: (s: SyncState) => { box.current = { ...s } },
  }
  return box
}

function tx(title: string, extra: Partial<Transaction> = {}): Transaction {
  return { id: newID(), title, amount: 10, currency: 'UZS', category: 'groceries', kind: 'expense', date: '2026-11-01T09:00:00Z', note: '', ...extra }
}

function withTx(data: AppData, ...list: Transaction[]): AppData {
  return { ...data, transactions: sortTransactions([...data.transactions, ...list]) }
}

function sample(): AppData {
  return { ...emptyData(), ...sampleData() }
}

/** A device: its own local data, sync state and clock, sharing one cloud. */
function device(kv: FakeKV, name: string, clock: { t: number }, data: AppData = emptyData()) {
  const state = memoryState()
  const engine = new CloudSync(kv, state, name, () => clock.t)
  const d = {
    data,
    state,
    engine,
    edit(next: AppData) { d.data = next; engine.markDirty() },
    async sync(force?: 'push') {
      const r = await engine.sync(() => d.data, force)
      if (r.action === 'pulled') d.data = r.data
      return r
    },
  }
  return d
}

/** Entries sharing a timestamp may come back in a different order; compare without that. */
function canon(d: AppData): AppData {
  return { ...d, transactions: [...d.transactions].sort((x, y) => (x.date === y.date ? x.id.localeCompare(y.id) : y.date.localeCompare(x.date))) }
}

async function metaOf(kv: FakeKV) {
  return parseCloudMeta(kv.items.get(CLOUD_META_KEY))!
}

// ---- layout -----------------------------------------------------------------------------------

describe('cloud layout', () => {
  it('round-trips the sample dataset', () => {
    const data = sample()
    const { entries, n, h, t } = encodeCloud(data)
    const kv = new FakeKV()
    const d = device(kv, 'a', { t: 1 }, data)
    expect(n).toBeGreaterThan(1)
    expect(h).toBeGreaterThan(0)
    expect(t.length).toBe(n)
    return d.sync('push').then(async () => {
      const meta = await metaOf(kv)
      expect(canon(decodeCloud(meta, Object.fromEntries(kv.items)))).toEqual(canon(data))
      expect(Object.keys(entries).sort()).toEqual([...kv.items.keys()].filter((k) => k !== CLOUD_META_KEY).sort())
    })
  })

  it('keeps every value ASCII and within the size limit, including non-ASCII text and oversized notes', async () => {
    const big = tx('Кофе “Oʻzbek” ☕️', { note: 'ж'.repeat(9000) })
    const data = withTx(emptyData(), big, tx('soʻm'))
    const kv = new FakeKV()
    const d = device(kv, 'a', { t: 1 }, data)
    await d.sync('push')
    const other = device(kv, 'b', { t: 2 })
    await other.sync()
    expect(canon(other.data)).toEqual(canon(data))
  })

  it('rejects a damaged copy', async () => {
    const kv = new FakeKV()
    await device(kv, 'a', { t: 1 }, sample()).sync('push')
    const meta = await metaOf(kv)
    const entries = Object.fromEntries(kv.items)
    const victim = Object.keys(entries).find((k) => k.startsWith('ft_t_'))!
    entries[victim] = entries[victim].slice(0, -3)
    expect(() => decodeCloud(meta, entries)).toThrow(CloudBusyError)
  })

  it('refuses data that needs more keys than the store has', async () => {
    const data = withTx(emptyData(), ...Array.from({ length: 1100 }, (_, i) => tx(`t${i}`, { note: 'x'.repeat(4000) })))
    const d = device(new FakeKV(), 'a', { t: 1 }, data)
    await expect(d.sync('push')).rejects.toBeInstanceOf(CloudFullError)
  })
})

// ---- reconciliation ---------------------------------------------------------------------------

describe('sync', () => {
  it('does nothing when both sides are empty', async () => {
    const kv = new FakeKV()
    const a = device(kv, 'a', { t: 1 })
    expect(await a.sync()).toEqual({ action: 'none' })
    expect(kv.items.size).toBe(0)
  })

  it('pushes local data to an empty cloud, then is clean', async () => {
    const kv = new FakeKV()
    const a = device(kv, 'a', { t: 100 }, sample())
    expect((await a.sync()).action).toBe('pushed')
    expect(a.state.current).toMatchObject({ rev: 100, dirtyAt: null })
    expect((await a.sync()).action).toBe('none')
  })

  it('a second device pulls what the first pushed', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    const r = await b.sync()
    expect(r).toMatchObject({ action: 'pulled', replacedUnsynced: false })
    expect(canon(b.data)).toEqual(canon(a.data))
    expect((await b.sync()).action).toBe('none')
  })

  it('carries edits back and forth between two devices', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    b.edit(withTx(b.data, tx('from b')))
    expect((await b.sync()).action).toBe('pushed')
    expect((await a.sync()).action).toBe('pulled')
    expect(canon(a.data)).toEqual(canon(b.data))

    clock.t = 300
    a.edit({ ...a.data, transactions: a.data.transactions.slice(1) })
    await a.sync()
    await b.sync()
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('one edit rewrites one bucket and the meta key, not the whole file', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const total = kv.items.size
    expect(total).toBeGreaterThan(4)
    kv.writes = []
    clock.t = 200
    a.edit(withTx(a.data, tx('one more')))
    await a.sync()
    expect(kv.writes.length).toBeLessThanOrEqual(3)
    expect(kv.writes.at(-1)).toBe(CLOUD_META_KEY)
  })

  it('when both changed, the later edit wins and the loser is flagged', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    a.edit(withTx(a.data, tx('older, from a')))
    clock.t = 300
    b.edit(withTx(b.data, tx('newer, from b')))
    await b.sync()                       // cloud rev 300
    const r = await a.sync()             // a's edit (200) is older than the cloud (300)
    expect(r).toMatchObject({ action: 'pulled', replacedUnsynced: true })
    expect(canon(a.data)).toEqual(canon(b.data))

    clock.t = 400
    b.edit(withTx(b.data, tx('b at 400')))
    clock.t = 500
    a.edit(withTx(a.data, tx('a at 500')))
    await b.sync()                       // cloud rev ≥ 400… b pushes at clock 500
    clock.t = 600
    a.edit(withTx(a.data, tx('a at 600')))
    expect((await a.sync()).action).toBe('pushed')
    await b.sync()
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('a device that never synced adopts the cloud and flags its own data', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    clock.t = 900
    const b = device(kv, 'b', clock, withTx(emptyData(), tx('local only')))
    b.engine.markDirty()
    const r = await b.sync()
    expect(r).toMatchObject({ action: 'pulled', replacedUnsynced: true })
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('erasing everything propagates', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()
    clock.t = 200
    a.edit({ ...emptyData(), rates: a.data.rates })
    await a.sync()
    expect([...kv.items.keys()].filter((k) => k.startsWith('ft_t_'))).toEqual([])
    await b.sync()
    expect(b.data.transactions).toEqual([])
    expect(b.data.accounts).toEqual([])
  })

  it('a reader that catches a write halfway is told to retry, and succeeds afterwards', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const b = device(kv, 'b', clock)
    await b.sync()

    clock.t = 200
    a.edit(withTx(a.data, tx('interrupted')))
    kv.failOnWrite = 2                   // the data piece lands, the meta key does not
    await expect(a.sync()).rejects.toThrow('network')
    expect(a.state.current.dirtyAt).toBe(200)

    const c = device(kv, 'c', clock)
    await expect(c.sync()).rejects.toBeInstanceOf(CloudBusyError)
    expect(c.data).toEqual(emptyData())

    expect((await a.sync()).action).toBe('pushed')
    await c.sync()
    await b.sync()
    expect(canon(c.data)).toEqual(canon(a.data))
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('an edit made while a push is in flight stays dirty and goes out next time', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    a.engine.markDirty()
    const original = kv.setItem.bind(kv)
    let once = true
    kv.setItem = async (k, v) => {
      if (once) { once = false; clock.t = 150; a.edit(withTx(a.data, tx('during push'))) }
      return original(k, v)
    }
    await a.sync()
    expect(a.state.current.dirtyAt).toBe(150)
    clock.t = 200
    expect((await a.sync()).action).toBe('pushed')
    const b = device(kv, 'b', clock)
    await b.sync()
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('force push repairs a damaged cloud copy', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, sample())
    await a.sync()
    const victim = [...kv.items.keys()].find((k) => k.startsWith('ft_t_'))!
    kv.items.set(victim, '[]')
    const b = device(kv, 'b', clock)
    await expect(b.sync()).rejects.toBeInstanceOf(CloudBusyError)
    clock.t = 200
    const fresh = device(kv, 'a2', clock, a.data)
    expect((await fresh.sync('push')).action).toBe('pushed')
    await b.sync()
    expect(canon(b.data)).toEqual(canon(a.data))
  })

  it('removes pieces that are no longer used', async () => {
    const kv = new FakeKV()
    const clock = { t: 100 }
    const a = device(kv, 'a', clock, withTx(emptyData(), tx('big', { note: 'x'.repeat(9000) })))
    await a.sync()
    const before = kv.items.size
    clock.t = 200
    a.edit(withTx(emptyData(), tx('small')))
    await a.sync()
    expect(kv.items.size).toBeLessThan(before)
    expect(kv.removed.length).toBeGreaterThan(0)
  })
})
