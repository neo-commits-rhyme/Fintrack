import {
  CloudBusyError, CloudSync, initialSyncState, type AppData, type CloudKV, type SyncState, type SyncStateStore,
} from '../core'

/** Decides *when* to sync; core/cloudSync decides *what* a sync does. */

export interface SyncStatus {
  /** Whether this session can sync at all (inside Telegram, on a client with cloud storage). */
  available: boolean
  phase: 'idle' | 'syncing' | 'error'
  lastSyncedAt: number | null
  error: string | null
  /** The cloud copy stayed unreadable after several tries; offer to upload this device's data over it. */
  incomplete: boolean
}

export const syncOff: SyncStatus = { available: false, phase: 'idle', lastSyncedAt: null, error: null, incomplete: false }

export interface SyncRunner {
  /** Call after every local edit. */
  changed(): void
  syncNow(force?: 'push'): void
  dispose(): void
}

const STATE_KEY = 'fintrack.sync'
const DEVICE_KEY = 'fintrack.device'
const PUSH_DELAY_MS = 1200
const BUSY_RETRY_MS = 3000
const BUSY_RETRIES = 3

const localState: SyncStateStore = {
  load(): SyncState {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as Partial<SyncState> | null
      if (s && typeof s.n === 'number') {
        return { rev: typeof s.rev === 'number' ? s.rev : null, dirtyAt: typeof s.dirtyAt === 'number' ? s.dirtyAt : null, n: s.n }
      }
    } catch { /* fall through */ }
    return { ...initialSyncState }
  },
  save(state) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
  },
}

function deviceID(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID().slice(0, 8)
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return 'device'
  }
}

export function createSyncRunner(opts: {
  kv: CloudKV
  getLocal(): AppData
  /** Replace local data with the cloud copy. `keepCopy`: local data held something that never reached the cloud. */
  applyRemote(data: AppData, keepCopy: boolean): void
  onStatus(status: SyncStatus): void
}): SyncRunner {
  const engine = new CloudSync(opts.kv, localState, deviceID())
  let status: SyncStatus = { ...syncOff, available: true }
  let running = false
  let again: { force?: 'push' } | null = null
  let pushTimer: number | undefined
  let retryTimer: number | undefined
  let busyCount = 0
  let disposed = false

  const set = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch }
    if (!disposed) opts.onStatus(status)
  }

  const run = async (force?: 'push') => {
    if (disposed) return
    if (running) { again = { force: force ?? again?.force }; return }
    running = true
    window.clearTimeout(pushTimer); pushTimer = undefined
    window.clearTimeout(retryTimer); retryTimer = undefined
    set({ phase: 'syncing' })
    try {
      const result = await engine.sync(opts.getLocal, force)
      if (disposed) return
      if (result.action === 'pulled') opts.applyRemote(result.data, result.replacedUnsynced)
      busyCount = 0
      set({ phase: 'idle', lastSyncedAt: Date.now(), error: null, incomplete: false })
    } catch (e) {
      if (e instanceof CloudBusyError && ++busyCount <= BUSY_RETRIES) {
        // Probably another device mid-save: look again shortly.
        retryTimer = window.setTimeout(() => void run(), BUSY_RETRY_MS)
      } else {
        const incomplete = e instanceof CloudBusyError
        busyCount = 0
        set({ phase: 'error', incomplete, error: e instanceof Error ? e.message : 'Sync failed.' })
      }
    } finally {
      running = false
      if (again) { const next = again; again = null; void run(next.force) }
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') void run()
    // Leaving with a save still queued: send it now rather than when (if) the timer fires.
    else if (pushTimer !== undefined) void run()
  }
  document.addEventListener('visibilitychange', onVisibility)
  void run()

  return {
    changed() {
      engine.markDirty()
      window.clearTimeout(pushTimer)
      pushTimer = window.setTimeout(() => void run(), PUSH_DELAY_MS)
    },
    syncNow: (force) => void run(force),
    dispose() {
      disposed = true
      window.clearTimeout(pushTimer)
      window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
