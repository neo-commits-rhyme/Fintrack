import type { TgWebApp } from './index'

/**
 * Development stand-in for Telegram's script, enabled with ?tgmock (or ?tgmock=light) on the dev server.
 * CloudStorage is backed by localStorage under MOCK_CLOUD_KEY and enforces Telegram's limits.
 * Calls that change Telegram's chrome are recorded on window.__tgmock for inspection.
 */

const MOCK_CLOUD_KEY = 'tgmock.cloud'

interface MockLog {
  calls: string[]
  backVisible: boolean
  /** Simulates a tap on Telegram's Back button. */
  tapBack(): void
  /** Simulates the user switching Telegram's theme. */
  setScheme(scheme: 'light' | 'dark'): void
}

declare global {
  interface Window { __tgmock?: MockLog }
}

export function installTelegramMock() {
  const readCloud = (): Record<string, string> => {
    try { return JSON.parse(localStorage.getItem(MOCK_CLOUD_KEY) ?? '{}') as Record<string, string> } catch { return {} }
  }
  const writeCloud = (c: Record<string, string>) => localStorage.setItem(MOCK_CLOUD_KEY, JSON.stringify(c))
  const later = (fn: () => void) => window.setTimeout(fn, 15)

  const events = new Map<string, Set<() => void>>()
  let backHandler: (() => void) | null = null
  const log: MockLog = {
    calls: [],
    backVisible: false,
    tapBack: () => backHandler?.(),
    setScheme: (scheme) => {
      mock.colorScheme = scheme
      events.get('themeChanged')?.forEach((h) => h())
    },
  }
  const note = (text: string) => { log.calls.push(text) }

  const mock: TgWebApp = {
    initData: 'mock',
    platform: 'mock',
    colorScheme: new URLSearchParams(location.search).get('tgmock') === 'light' ? 'light' : 'dark',
    isVersionAtLeast: () => true,
    ready: () => note('ready'),
    expand: () => note('expand'),
    disableVerticalSwipes: () => note('disableVerticalSwipes'),
    setHeaderColor: (c) => note(`header ${c}`),
    setBackgroundColor: (c) => note(`background ${c}`),
    setBottomBarColor: (c) => note(`bottomBar ${c}`),
    onEvent: (event, handler) => {
      if (!events.has(event)) events.set(event, new Set())
      events.get(event)!.add(handler)
    },
    offEvent: (event, handler) => { events.get(event)?.delete(handler) },
    BackButton: {
      show: () => { log.backVisible = true },
      hide: () => { log.backVisible = false },
      onClick: (handler) => { backHandler = handler },
    },
    HapticFeedback: {
      impactOccurred: (s) => note(`haptic impact ${s}`),
      notificationOccurred: (t) => note(`haptic ${t}`),
      selectionChanged: () => note('haptic select'),
    },
    CloudStorage: {
      setItem: (key, value, cb) => later(() => {
        const cloud = readCloud()
        const bad = !/^[A-Za-z0-9_-]{1,128}$/.test(key) || value.length > 4096 || (!(key in cloud) && Object.keys(cloud).length >= 1024)
        if (bad) { cb?.('CLOUD_STORAGE_LIMIT'); return }
        cloud[key] = value
        writeCloud(cloud)
        cb?.(null, true)
      }),
      getItems: (keys, cb) => later(() => {
        const cloud = readCloud()
        cb(null, Object.fromEntries(keys.map((k) => [k, cloud[k] ?? ''])))
      }),
      removeItems: (keys, cb) => later(() => {
        const cloud = readCloud()
        for (const k of keys) delete cloud[k]
        writeCloud(cloud)
        cb?.(null, true)
      }),
      getKeys: (cb) => later(() => cb(null, Object.keys(readCloud()))),
    },
  }

  window.__tgmock = log
  window.Telegram = { WebApp: mock }
}
