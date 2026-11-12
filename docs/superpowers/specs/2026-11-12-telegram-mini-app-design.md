# Fintrack as a Telegram Mini App — design

Date: 2026-11-12. Approved by the user in chat.

## Goal

Run Fintrack inside Telegram as a Mini App with the same screens, rules and
`fintrack.json` format as the Mac app, with data synced between the user's
Telegram clients.

## Approach

The existing web app (`web/`) becomes the Mini App. A Telegram layer switches
on only when the page is launched from Telegram; the plain browser version
behaves exactly as before and loads nothing from the network.

No server and no bot code. The bot is created by the user in @BotFather and
pointed at the GitHub Pages URL.

## Units

### `web/src/core/cloudSync.ts` (pure, unit-tested)

Mirrors `AppData` into a key-value store with Telegram CloudStorage limits
(1024 keys, values up to 4096 characters, keys `[A-Za-z0-9_-]`).

Layout — every value is ASCII-only JSON (non-ASCII escaped) of at most 4000
characters:

- `ft_meta` — `{ v, n, rev, dev, sum }`: format version, bucket count, revision
  (ms timestamp of the write), writing device, checksum of every other key.
- `ft_h_<i>` — everything except transactions, split sequentially.
- `ft_t_<b>_<j>` — transactions whose id hashes to bucket `b` (of `n`), split
  sequentially. `n` is a power of two that only grows, so one edit normally
  rewrites one bucket, the meta key and nothing else.

Writes are diffed against the last known cloud contents: changed data keys
first, then `ft_meta`, then stale keys are removed. A reader that catches a
write halfway sees a checksum mismatch and reports `busy` (try again later).

Reconciliation (`sync`), whole-file last write wins:

| Cloud | Local | Result |
| --- | --- | --- |
| empty | has data or unsynced edits | push |
| same revision as last sync | unsynced edits | push |
| same revision as last sync | clean | nothing |
| newer revision | clean | pull |
| newer revision | unsynced edits | later timestamp wins |
| has data, never synced here | anything | pull (local copy is parked first) |

Local sync state (`rev`, `dirtyAt`, `n`) is injected, so the engine is tested
against an in-memory store.

### `web/src/telegram/` (thin wrapper over `window.Telegram.WebApp`)

- `boot()` — detects a Telegram launch (launch params in the URL hash or the
  SDK's session copy), injects `telegram-web-app.js` and waits for it **before
  React renders**, because the app's hash router would otherwise overwrite the
  launch params. Then `ready()`, `expand()`, `disableVerticalSwipes()`.
- theme — Telegram's `colorScheme` drives the "System" appearance; header,
  background and bottom bar are coloured to Fintrack's canvas.
- back button — a handler stack: an open sheet closes first, otherwise a
  non-Dashboard section returns to Dashboard.
- haptics — light impact on every saved change, selection tick on tab change.
- `cloudKV()` — promise wrapper over `CloudStorage`, or `null` on clients
  older than Bot API 6.9 (device-only fallback).
- dev-only mock (`?tgmock`, never bundled in production) with CloudStorage
  backed by `localStorage`, used to verify in a normal browser.

### Store and UI changes

- `StoreProvider` runs the sync: on launch, on return to the app, and about a
  second after each change. Pulled data replaces local data without being
  marked as a local edit. Exposes `sync` status and `syncNow()`.
- Settings: a "Telegram sync" card (status, last synced, Sync now); inside
  Telegram, Export becomes "Copy JSON" because webview downloads are
  unreliable; storage captions describe where data lives.
- CSS: Telegram safe-area variables added to the tab bar, main area and sheets.

## Errors

- CloudStorage call fails → status "Couldn't sync", local data untouched,
  retried on the next change, on return to the app, or by "Sync now".
- Cloud copy unreadable → not adopted; status shows the error.
- More data than fits in 1000 keys → push refused with a clear message.

## Testing

- Vitest: layout round-trip, value limits, minimal-diff writes, every row of
  the reconciliation table, interrupted write, failure retry.
- Browser pane at phone size with the mock: two tabs sharing the mock cloud.

## Out of scope

Bot commands, reminders, record-level merge, server-side storage.
