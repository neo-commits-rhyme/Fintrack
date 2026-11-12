import type { CloudKV } from '../core/cloudSync'

/**
 * Thin wrapper over window.Telegram.WebApp. Everything here is a no-op in a plain browser:
 * Telegram's script is only loaded when the page was launched from Telegram.
 */

type Callback<T> = (error: unknown, value?: T) => void

interface TgCloudStorage {
  setItem(key: string, value: string, cb?: Callback<boolean>): void
  getItems(keys: string[], cb: Callback<Record<string, string>>): void
  removeItems(keys: string[], cb?: Callback<boolean>): void
  getKeys(cb: Callback<string[]>): void
}

export interface TgWebApp {
  initData: string
  platform: string
  colorScheme: 'light' | 'dark'
  isVersionAtLeast(version: string): boolean
  ready(): void
  expand(): void
  disableVerticalSwipes?(): void
  setHeaderColor?(color: string): void
  setBackgroundColor?(color: string): void
  setBottomBarColor?(color: string): void
  onEvent(event: string, handler: () => void): void
  offEvent(event: string, handler: () => void): void
  BackButton?: { show(): void; hide(): void; onClick(handler: () => void): void }
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void
    notificationOccurred(type: 'success' | 'warning' | 'error'): void
    selectionChanged(): void
  }
  CloudStorage?: TgCloudStorage
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
    TelegramWebviewProxy?: unknown
  }
}

const SCRIPT_URL = 'https://telegram.org/js/telegram-web-app.js'
const SCRIPT_TIMEOUT_MS = 5000
/** Fintrack's canvas colours, as #RRGGBB for Telegram's header, background and bottom bar. */
const CANVAS = { dark: '#060a0c', light: '#f5f5f7' } as const

let app: TgWebApp | null = null
const backHandlers: (() => void)[] = []

function launchedFromTelegram(): boolean {
  // Launch params arrive in the URL hash; the clients also inject a proxy object, and Telegram's
  // script keeps a session copy of the params so a reload inside Telegram still counts.
  if (/tgWebApp(Data|Version|Platform)=/.test(location.hash)) return true
  if (window.TelegramWebviewProxy) return true
  try { return sessionStorage.getItem('__telegram__initParams') !== null } catch { return false }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = SCRIPT_URL
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Telegram script failed to load'))
    document.head.appendChild(el)
    window.setTimeout(() => reject(new Error('Telegram script timed out')), SCRIPT_TIMEOUT_MS)
  })
}

/**
 * Must finish before the app renders: the hash router would otherwise replace the launch params
 * in the URL before Telegram's script has read them.
 */
export async function bootTelegram(): Promise<void> {
  try {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('tgmock')) {
      (await import('./mock')).installTelegramMock()
    } else if (launchedFromTelegram()) {
      await loadScript()
    } else {
      return
    }
  } catch {
    return
  }
  const tg = window.Telegram?.WebApp
  if (!tg || (!tg.initData && tg.platform === 'unknown')) return
  app = tg
  document.documentElement.classList.add('tg')
  quiet(() => tg.ready())
  quiet(() => tg.expand())
  // Sheets scroll vertically; without this a downward drag closes the Mini App.
  if (tg.isVersionAtLeast('7.7')) quiet(() => tg.disableVerticalSwipes?.())
  quiet(() => tg.BackButton?.onClick(() => backHandlers[backHandlers.length - 1]?.()))
}

function quiet(fn: () => void) {
  try { fn() } catch { /* an older client without this method */ }
}

function promisify<T>(call: (cb: Callback<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    call((error, value) => {
      if (error) reject(new Error(typeof error === 'string' ? error : 'Telegram cloud storage failed'))
      else resolve(value as T)
    })
  })
}

export const telegram = {
  active: (): boolean => app !== null,

  colorScheme: (): 'light' | 'dark' | null => app?.colorScheme ?? null,

  onThemeChanged(handler: () => void): () => void {
    if (!app) return () => {}
    const tg = app
    tg.onEvent('themeChanged', handler)
    return () => tg.offEvent('themeChanged', handler)
  },

  /** Colours Telegram's own chrome to match the app. */
  setChrome(scheme: 'light' | 'dark') {
    if (!app) return
    const tg = app
    const color = CANVAS[scheme]
    if (tg.isVersionAtLeast('6.9')) quiet(() => tg.setHeaderColor?.(color))
    quiet(() => tg.setBackgroundColor?.(color))
    if (tg.isVersionAtLeast('7.10')) quiet(() => tg.setBottomBarColor?.(color))
  },

  /** Shows Telegram's Back button while at least one handler is registered; the newest one handles the tap. */
  pushBack(handler: () => void): () => void {
    if (!app) return () => {}
    const tg = app
    backHandlers.push(handler)
    quiet(() => tg.BackButton?.show())
    return () => {
      const i = backHandlers.lastIndexOf(handler)
      if (i >= 0) backHandlers.splice(i, 1)
      if (backHandlers.length === 0) quiet(() => tg.BackButton?.hide())
    }
  },

  haptic(kind: 'impact' | 'select' | 'success' | 'warning') {
    const h = app?.HapticFeedback
    if (!h) return
    quiet(() => {
      if (kind === 'impact') h.impactOccurred('light')
      else if (kind === 'select') h.selectionChanged()
      else h.notificationOccurred(kind)
    })
  },

  /** Telegram CloudStorage as a promise-based store, or null when this client has none. */
  cloudKV(): CloudKV | null {
    const cs = app?.CloudStorage
    if (!app || !cs || !app.isVersionAtLeast('6.9')) return null
    return {
      getItems: (keys) => (keys.length === 0 ? Promise.resolve({}) : promisify<Record<string, string>>((cb) => cs.getItems(keys, cb)).then((v) => v ?? {})),
      setItem: (key, value) => promisify<boolean>((cb) => cs.setItem(key, value, cb)).then(() => undefined),
      removeItems: (keys) => (keys.length === 0 ? Promise.resolve() : promisify<boolean>((cb) => cs.removeItems(keys, cb)).then(() => undefined)),
      getKeys: () => promisify<string[]>((cb) => cs.getKeys(cb)).then((v) => v ?? []),
    }
  },
}
