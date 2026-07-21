# Fintrack

Personal finance for macOS — budgets, savings goals, transaction tracking and a
currency converter that trusts *your* rates. Built with SwiftUI and the native
macOS 26 **Liquid Glass** design language.

## Features

- **Dashboard** — total balance, monthly income/expense, 30-day spending chart,
  category breakdown, budget glance, recent activity.
- **Transactions** — add/edit/delete, search, filter by kind and category,
  grouped by day, multi-currency entries.
- **Budgets** — monthly per-category limits with live progress and
  over-budget warnings.
- **Goals** — savings goals with progress rings, deadlines and quick
  "add funds" in any currency.
- **Converter** — the signature feature. All rates are user-defined
  ("1 USD = 12 110 soʻm") and editable anytime; conversions cross through UZS.
- **Currencies** — UZS (default), KZT, RUB, USD, JPY, GBP, EUR. The display
  currency for the whole app is switchable in Settings.

## Requirements

- macOS 26 (Tahoe) or later
- Xcode 26 / Swift 6.2+ toolchain

## Run

Installed app: **/Applications/Fintrack.app** (Launchpad / Spotlight → "Fintrack").

From source:

```sh
cd Fintrack
swift run                 # debug run
./scripts/make-app.sh     # rebuild dist/Fintrack.app (release + icon + codesign)
```

Or open `Package.swift` in Xcode and hit Run.
`--seed` launch argument loads the 3-month demo dataset.

## Data

Everything is stored locally as JSON at
`~/Library/Application Support/Fintrack/fintrack.json`.
First launch seeds a small demo dataset; reset or erase it in **Settings → Data**.
