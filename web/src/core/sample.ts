import type { Account, AppData, Budget, Goal, Transaction } from './models'
import { newID } from './models'
import { addDays, addMonths, startOfDay, toISO } from './dates'
import { sortAccounts, sortTransactions } from './analytics'
import { defaultRates } from './currency'

/** Tiny deterministic LCG (64-bit, same constants as the Mac app) so the dataset is identical on every load. */
class Rand {
  private state = 0x5eed_f1a7n
  private static readonly MASK = (1n << 64n) - 1n
  next(): bigint {
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & Rand.MASK
    return this.state >> 33n
  }
  int(lo: number, hi: number): number {
    const count = BigInt(hi - lo + 1)
    return lo + Number(this.next() % count)
  }
  pick<T>(items: T[]): T {
    return items[this.int(0, items.length - 1)]
  }
  chance(percent: number): boolean {
    return this.int(1, 100) <= percent
  }
}

function at(today: Date, daysAgo: number, hour: number, minute: number, latest: Date): string {
  const day = addDays(today, -daysAgo)
  day.setHours(hour, minute, 0, 0)
  // Today's entries must never land later than now (a minute of slack keeps every clock happy).
  return toISO(day > latest ? latest : day)
}

/** Three months of realistic, deterministic UZS-centric demo data. */
export function sampleData(now = new Date()): Pick<AppData, 'accounts' | 'transactions' | 'budgets' | 'goals'> {
  const today = startOfDay(now)
  const latest = new Date(now.getTime() - 60_000)
  const cash: Account = { id: newID(), name: 'Cash', icon: 'banknote', currency: 'UZS', openingBalance: 400_000, kind: 'regular', includeInTotal: true }
  const humo: Account = { id: newID(), name: 'Humo card', icon: 'credit-card', currency: 'UZS', openingBalance: 2_500_000, kind: 'regular', includeInTotal: true }
  const savings: Account = { id: newID(), name: 'Savings', icon: 'landmark', currency: 'UZS', openingBalance: 9_000_000, kind: 'regular', includeInTotal: false }
  const visa: Account = { id: newID(), name: 'Visa USD', icon: 'circle-dollar-sign', currency: 'USD', openingBalance: 180, kind: 'regular', includeInTotal: true }
  const carLoan: Account = { id: newID(), name: 'Car loan', icon: 'lock', currency: 'UZS', openingBalance: -5_000_000, kind: 'debt', includeInTotal: true }

  const rand = new Rand()
  const ts: Transaction[] = []

  const add = (
    title: string, amount: number, currency: Transaction['currency'], category: Transaction['category'],
    kind: Transaction['kind'], daysAgo: number, hour = 12, note = '', account?: Account,
  ) => {
    if (daysAgo < 0) return
    const resolved = account ?? (currency === 'USD' ? visa : humo)
    ts.push({
      id: newID(), title, amount, currency, category, kind,
      date: at(today, daysAgo, hour, (daysAgo * 13) % 60, latest), note, accountID: resolved.id,
    })
  }
  const transfer = (title: string, amount: number, currency: Transaction['currency'], category: Transaction['category'], daysAgo: number, hour: number, minute: number, from: Account, to: Account) => {
    ts.push({
      id: newID(), title, amount, currency, category, kind: 'transfer',
      date: at(today, daysAgo, hour, minute, latest), note: '', fromAccountID: from.id, toAccountID: to.id, fromAccount: from.name, toAccount: to.name,
    })
  }

  const groceryStores = ['Korzinka', 'Makro', 'Havas', 'Baraka Market']
  const eateries: [string, [number, number]][] = [
    ['Coffee', [30_000, 48_000]], ['Lunch', [55_000, 95_000]], ['Plov at Besh Qozon', [85_000, 120_000]],
    ['Dinner with friends', [180_000, 320_000]], ['Burger', [45_000, 75_000]], ['Somsa & tea', [25_000, 40_000]],
  ]
  const entertainment: [string, [number, number]][] = [
    ['Cinema', [100_000, 160_000]], ['Bowling', [150_000, 250_000]], ['Concert', [200_000, 400_000]], ['PlayStation night', [80_000, 120_000]],
  ]

  for (let daysAgo = 0; daysAgo <= 92; daysAgo++) {
    const day = addDays(today, -daysAgo)
    const dayOfMonth = day.getDate()
    const weekday = day.getDay() + 1 // Calendar.component(.weekday): 1 = Sunday

    if (dayOfMonth === 1) add('Salary', 14_500_000, 'UZS', 'salary', 'income', daysAgo, 9)
    if (dayOfMonth === 2) add('Rent', 4_200_000, 'UZS', 'housing', 'expense', daysAgo, 10)
    if (dayOfMonth === 5) {
      add('Electricity', rand.int(150_000, 220_000), 'UZS', 'utilities', 'expense', daysAgo)
      add('Internet', 210_000, 'UZS', 'utilities', 'expense', daysAgo)
    }
    if (dayOfMonth === 6) add('Water & gas', rand.int(60_000, 95_000), 'UZS', 'utilities', 'expense', daysAgo)
    if (dayOfMonth === 8) add('iCloud+', 2.99, 'USD', 'subscriptions', 'expense', daysAgo)
    if (dayOfMonth === 12) add('Spotify', 5.99, 'USD', 'subscriptions', 'expense', daysAgo)
    if (dayOfMonth === 15) {
      add('Netflix', 11.99, 'USD', 'subscriptions', 'expense', daysAgo)
      add('Metro card top-up', 50_000, 'UZS', 'transport', 'expense', daysAgo)
    }
    if (dayOfMonth === 20) add('Fuel', rand.int(350_000, 450_000), 'UZS', 'transport', 'expense', daysAgo, 18)

    if (daysAgo % 3 === 0) add(rand.pick(groceryStores), rand.int(150_000, 450_000), 'UZS', 'groceries', 'expense', daysAgo, rand.int(17, 20))
    if (weekday === 4 || weekday === 7) {
      const [name, [lo, hi]] = rand.pick(eateries)
      add(name, rand.int(lo, hi), 'UZS', 'eatingOut', 'expense', daysAgo, rand.int(12, 21))
    }
    if (weekday === 2 || weekday === 6) {
      add('Yandex Go', rand.int(18_000, 60_000), 'UZS', 'transport', 'expense', daysAgo, rand.int(8, 22), '', rand.chance(40) ? cash : humo)
    }
    if (daysAgo % 12 === 5) {
      const [name, [lo, hi]] = rand.pick(entertainment)
      add(name, rand.int(lo, hi), 'UZS', 'entertainment', 'expense', daysAgo, 20)
    }
  }

  add('Freelance project', 350, 'USD', 'business', 'income', 9, 15, 'Landing page for a client')
  add('Freelance project', 280, 'USD', 'business', 'income', 38, 16, 'Bug-fix sprint')
  add('Freelance project', 420, 'USD', 'business', 'income', 71, 14, 'Dashboard redesign')
  add('Birthday gift', 500_000, 'UZS', 'gifts', 'income', 23, 19)
  add('Sold old iPad', 210, 'USD', 'other', 'income', 55, 17)

  add('Sneakers', 850_000, 'UZS', 'shopping', 'expense', 18, 16)
  add('Winter jacket', 1_250_000, 'UZS', 'shopping', 'expense', 47, 15)
  add('AirPods case', 19.99, 'USD', 'shopping', 'expense', 62)
  add('Gift for mom', 420_000, 'UZS', 'gifts', 'expense', 33, 13)

  add('Pharmacy', 85_000, 'UZS', 'health', 'expense', 9)
  add('Dentist check-up', 600_000, 'UZS', 'health', 'expense', 41, 11)
  add('Vitamins', 160_000, 'UZS', 'health', 'expense', 66)

  add('Books', 160_000, 'UZS', 'education', 'expense', 21)
  add('Coursera course', 49, 'USD', 'education', 'expense', 52, 12, 'SwiftUI masterclass')
  add('English club', 300_000, 'UZS', 'education', 'expense', 80)

  transfer('To savings', 3_000_000, 'UZS', 'transfer', 2, 10, 15, humo, savings)
  transfer('Card top-up', 150, 'USD', 'transfer', 31, 12, 40, savings, visa)
  transfer('Cash withdrawal', 600_000, 'UZS', 'transfer', 12, 9, 5, humo, cash)

  add('Train to Samarkand', 240_000, 'UZS', 'travel', 'expense', 58, 7)
  add('Hotel in Samarkand', 90, 'USD', 'travel', 'expense', 57, 12, '2 nights')
  add('Museum tickets', 100_000, 'UZS', 'travel', 'expense', 57, 14)

  for (const daysAgo of [5, 35, 65]) transfer('Car loan payment', 1_000_000, 'UZS', 'debtPayment', daysAgo, 11, 30, humo, carLoan)

  const budgets: Budget[] = [
    { id: newID(), category: 'groceries', limit: 3_500_000, currency: 'UZS' },
    { id: newID(), category: 'eatingOut', limit: 1_200_000, currency: 'UZS' },
    { id: newID(), category: 'transport', limit: 900_000, currency: 'UZS' },
    { id: newID(), category: 'entertainment', limit: 500_000, currency: 'UZS' },
    { id: newID(), category: 'shopping', limit: 1_500_000, currency: 'UZS' },
    { id: newID(), category: 'health', limit: 700_000, currency: 'UZS' },
    { id: newID(), category: 'subscriptions', limit: 25, currency: 'USD' },
  ]

  const goals: Goal[] = [
    { id: newID(), name: 'MacBook Pro', icon: 'laptop', target: 2_400, saved: 1_150, currency: 'USD' },
    { id: newID(), name: 'Emergency fund', icon: 'shield', target: 30_000_000, saved: 12_500_000, currency: 'UZS', deadline: toISO(addMonths(now, 6)) },
    { id: newID(), name: 'Trip to Tokyo', icon: 'plane', target: 400_000, saved: 96_000, currency: 'JPY', deadline: toISO(addMonths(now, 10)) },
    { id: newID(), name: 'New camera', icon: 'camera', target: 1_100, saved: 1_100, currency: 'EUR' },
  ]

  return {
    accounts: sortAccounts([cash, humo, savings, visa, carLoan]),
    transactions: sortTransactions(ts),
    budgets,
    goals,
  }
}

export function sampleAppData(now = new Date()): AppData {
  return { ...sampleData(now), displayCurrency: 'UZS', rates: { ...defaultRates } }
}
