# Fintrack: test pass, fixes, and a web version

Date: 2026-11-01

## Goal

1. Find and fix every bug in the macOS app (Swift 6.2, SwiftUI, macOS 26).
2. Ship a browser version of the same app that works anywhere, with the
   same data model so a `fintrack.json` moves between the two.
3. Polish the web UI with the interface skills, commit and push to GitHub.

## Testing approach

- `AppStore` takes a `dataURL` (or `FINTRACK_DATA_DIR`), so tests and demo
  runs never touch `~/Library/Application Support/Fintrack/fintrack.json`.
- `Tests/FintrackTests` (swift-testing) covers the store: balances,
  conversion, month/day analytics, budgets, goals, migration of old file
  layouts, persistence round-trips, formatting.
- Three parallel Opus agents: unit tests, runtime/UI drive of the built app
  with screenshots, and adversarial source review. Findings are fixed in
  one pass, re-verified by the test suite and a rebuild.

## Web version

- `web/`: Vite + React + TypeScript, no backend. Data lives in
  `localStorage` under one key, same JSON shape as the Mac file
  (`transactions`, `budgets`, `goals`, `accounts`, `displayCurrency`,
  `rates` keyed by code). Import/Export JSON in Settings.
- Same seven screens: Dashboard, Transactions, Accounts, Budgets, Goals,
  Converter, Settings. Same rules: debt payments and loans are transfers;
  spending = expense + debt payment; conversions cross through UZS.
- Core logic (`web/src/core/`) is a direct port of `AppStore` + `FTFormat`,
  covered by Vitest tests mirroring the Swift suite.
- Charts drawn as inline SVG (bar series, donut, rings) — no chart library.
- Deployed to GitHub Pages by a workflow on push to `main`.

## Out of scope

Sync between devices, accounts/login, rate fetching, custom categories.
