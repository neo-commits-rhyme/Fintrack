import Foundation

/// Three months of realistic, deterministic UZS-centric demo data.
/// Loaded on demand from Settings → "Load sample data" (or `--seed` at launch).
enum SampleData {

    /// Tiny deterministic LCG so the dataset is identical on every load.
    private struct Rand {
        var state: UInt64 = 0x5EED_F1A7
        mutating func next() -> UInt64 {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return state >> 33
        }
        mutating func int(_ range: ClosedRange<Int>) -> Int {
            range.lowerBound + Int(next() % UInt64(range.count))
        }
        mutating func pick<T>(_ items: [T]) -> T {
            items[int(0...(items.count - 1))]
        }
        mutating func chance(_ percent: Int) -> Bool {
            int(1...100) <= percent
        }
    }

    /// Accounts plus three months of transactions linked to them.
    /// Savings ships with "count in total" OFF and Car loan is a debt —
    /// so both headline-balance behaviors are visible out of the box.
    static func bundle() -> (accounts: [Account], transactions: [Transaction], budgets: [Budget], goals: [Goal]) {
        let cash = Account(name: "Cash", icon: "banknote.fill", currency: .uzs, openingBalance: 400_000)
        let humo = Account(name: "Humo card", icon: "creditcard.fill", currency: .uzs, openingBalance: 2_500_000)
        let savings = Account(name: "Savings", icon: "building.columns.fill", currency: .uzs, openingBalance: 9_000_000,
                              includeInTotal: false)
        let visa = Account(name: "Visa USD", icon: "dollarsign.circle.fill", currency: .usd, openingBalance: 180)
        let carLoan = Account(name: "Car loan", icon: "lock.fill", currency: .uzs, openingBalance: -5_000_000,
                              kind: .debt)
        var ts = transactions(cash: cash, humo: humo, savings: savings, visa: visa)
        // Monthly loan payment: transfer INTO the debt account pays it down.
        let cal = Calendar.current
        let today = Date().startOfDay
        for daysAgo in [5, 35, 65] {
            let day = cal.date(byAdding: .day, value: -daysAgo, to: today) ?? today
            ts.append(Transaction(
                title: "Car loan payment", amount: 1_000_000, currency: .uzs,
                category: .debtPayment, kind: .transfer,
                date: min(cal.date(bySettingHour: 11, minute: 30, second: 0, of: day) ?? day, Date().addingTimeInterval(-60)),
                fromAccountID: humo.id, toAccountID: carLoan.id,
                fromAccount: humo.name, toAccount: carLoan.name
            ))
        }
        ts.sort { $0.date > $1.date }
        return (
            [cash, humo, savings, visa, carLoan],
            ts,
            budgets(),
            goals()
        )
    }

    static func transactions(cash: Account, humo: Account, savings: Account, visa: Account) -> [Transaction] {
        var rand = Rand()
        let cal = Calendar.current
        let today = Date().startOfDay
        var ts: [Transaction] = []

        // A minute in the past so "today" entries are safely never in the
        // future, whichever clock reads them next.
        let now = Date().addingTimeInterval(-60)
        func date(daysAgo: Int, hour: Int, minute: Int) -> Date {
            let day = cal.date(byAdding: .day, value: -daysAgo, to: today) ?? today
            let stamped = cal.date(bySettingHour: hour, minute: minute, second: 0, of: day) ?? day
            // Today's entries must not land later than right now.
            return min(stamped, now)
        }
        func add(_ title: String, _ amount: Double, _ currency: CurrencyCode,
                 _ category: Category, _ kind: TransactionKind,
                 daysAgo: Int, hour: Int = 12, note: String = "", account: Account? = nil) {
            guard daysAgo >= 0 else { return }
            // USD activity happens on the Visa; everything else defaults to Humo.
            let resolved = account ?? (currency == .usd ? visa : humo)
            ts.append(Transaction(
                title: title, amount: amount, currency: currency,
                category: category, kind: kind,
                date: date(daysAgo: daysAgo, hour: hour, minute: (daysAgo * 13) % 60),
                note: note,
                accountID: resolved.id
            ))
        }

        let groceryStores = ["Korzinka", "Makro", "Havas", "Baraka Market"]
        let eateries = [("Coffee", 30_000...48_000), ("Lunch", 55_000...95_000),
                        ("Plov at Besh Qozon", 85_000...120_000), ("Dinner with friends", 180_000...320_000),
                        ("Burger", 45_000...75_000), ("Somsa & tea", 25_000...40_000)]
        let entertainment = [("Cinema", 100_000...160_000), ("Bowling", 150_000...250_000),
                             ("Concert", 200_000...400_000), ("PlayStation night", 80_000...120_000)]

        // ~92 days back, month anchored events + weekly rhythms.
        for daysAgo in 0...92 {
            let day = cal.date(byAdding: .day, value: -daysAgo, to: today) ?? today
            let dayOfMonth = cal.component(.day, from: day)
            let weekday = cal.component(.weekday, from: day)

            // Monthly anchors
            if dayOfMonth == 1 {
                add("Salary", 14_500_000, .uzs, .salary, .income, daysAgo: daysAgo, hour: 9)
            }
            if dayOfMonth == 2 {
                add("Rent", 4_200_000, .uzs, .housing, .expense, daysAgo: daysAgo, hour: 10)
            }
            if dayOfMonth == 5 {
                add("Electricity", Double(rand.int(150_000...220_000)), .uzs, .utilities, .expense, daysAgo: daysAgo)
                add("Internet", 210_000, .uzs, .utilities, .expense, daysAgo: daysAgo)
            }
            if dayOfMonth == 6 {
                add("Water & gas", Double(rand.int(60_000...95_000)), .uzs, .utilities, .expense, daysAgo: daysAgo)
            }
            if dayOfMonth == 8 {
                add("iCloud+", 2.99, .usd, .subscriptions, .expense, daysAgo: daysAgo)
            }
            if dayOfMonth == 12 {
                add("Spotify", 5.99, .usd, .subscriptions, .expense, daysAgo: daysAgo)
            }
            if dayOfMonth == 15 {
                add("Netflix", 11.99, .usd, .subscriptions, .expense, daysAgo: daysAgo)
                add("Metro card top-up", 50_000, .uzs, .transport, .expense, daysAgo: daysAgo)
            }
            if dayOfMonth == 20 {
                add("Fuel", Double(rand.int(350_000...450_000)), .uzs, .transport, .expense, daysAgo: daysAgo, hour: 18)
            }

            // Groceries every ~3 days
            if daysAgo % 3 == 0 {
                add(rand.pick(groceryStores), Double(rand.int(150_000...450_000)), .uzs, .groceries, .expense,
                    daysAgo: daysAgo, hour: rand.int(17...20))
            }

            // Eating out ~2×/week
            if weekday == 4 || weekday == 7 {
                let (name, range) = rand.pick(eateries)
                add(name, Double(rand.int(range)), .uzs, .eatingOut, .expense, daysAgo: daysAgo, hour: rand.int(12...21))
            }

            // Taxi ~2×/week — sometimes paid in cash
            if weekday == 2 || weekday == 6 {
                add("Yandex Go", Double(rand.int(18_000...60_000)), .uzs, .transport, .expense,
                    daysAgo: daysAgo, hour: rand.int(8...22),
                    account: rand.chance(40) ? cash : humo)
            }

            // Entertainment ~every 12 days
            if daysAgo % 12 == 5 {
                let (name, range) = rand.pick(entertainment)
                add(name, Double(rand.int(range)), .uzs, .entertainment, .expense, daysAgo: daysAgo, hour: 20)
            }
        }

        // Irregular one-offs spread across the three months
        add("Freelance project", 350, .usd, .business, .income, daysAgo: 9, hour: 15, note: "Landing page for a client")
        add("Freelance project", 280, .usd, .business, .income, daysAgo: 38, hour: 16, note: "Bug-fix sprint")
        add("Freelance project", 420, .usd, .business, .income, daysAgo: 71, hour: 14, note: "Dashboard redesign")
        add("Birthday gift", 500_000, .uzs, .gifts, .income, daysAgo: 23, hour: 19)
        add("Sold old iPad", 210, .usd, .other, .income, daysAgo: 55, hour: 17)

        add("Sneakers", 850_000, .uzs, .shopping, .expense, daysAgo: 18, hour: 16)
        add("Winter jacket", 1_250_000, .uzs, .shopping, .expense, daysAgo: 47, hour: 15)
        add("AirPods case", 19.99, .usd, .shopping, .expense, daysAgo: 62)
        add("Gift for mom", 420_000, .uzs, .gifts, .expense, daysAgo: 33, hour: 13)

        add("Pharmacy", 85_000, .uzs, .health, .expense, daysAgo: 9)
        add("Dentist check-up", 600_000, .uzs, .health, .expense, daysAgo: 41, hour: 11)
        add("Vitamins", 160_000, .uzs, .health, .expense, daysAgo: 66)

        add("Books", 160_000, .uzs, .education, .expense, daysAgo: 21)
        add("Coursera course", 49, .usd, .education, .expense, daysAgo: 52, note: "SwiftUI masterclass")
        add("English club", 300_000, .uzs, .education, .expense, daysAgo: 80)

        // Transfers between own accounts (net zero for the balance)
        ts.append(Transaction(title: "To savings", amount: 3_000_000, currency: .uzs, category: .transfer, kind: .transfer,
                              date: date(daysAgo: 2, hour: 10, minute: 15),
                              fromAccountID: humo.id, toAccountID: savings.id))
        ts.append(Transaction(title: "Card top-up", amount: 150, currency: .usd, category: .transfer, kind: .transfer,
                              date: date(daysAgo: 31, hour: 12, minute: 40),
                              fromAccountID: savings.id, toAccountID: visa.id))
        ts.append(Transaction(title: "Cash withdrawal", amount: 600_000, currency: .uzs, category: .transfer, kind: .transfer,
                              date: date(daysAgo: 12, hour: 9, minute: 5),
                              fromAccountID: humo.id, toAccountID: cash.id))

        add("Train to Samarkand", 240_000, .uzs, .travel, .expense, daysAgo: 58, hour: 7)
        add("Hotel in Samarkand", 90, .usd, .travel, .expense, daysAgo: 57, note: "2 nights")
        add("Museum tickets", 100_000, .uzs, .travel, .expense, daysAgo: 57, hour: 14)

        return ts.sorted { $0.date > $1.date }
    }

    static func budgets() -> [Budget] {
        [
            Budget(category: .groceries, limit: 3_500_000, currency: .uzs),
            Budget(category: .eatingOut, limit: 1_200_000, currency: .uzs),
            Budget(category: .transport, limit: 900_000, currency: .uzs),
            Budget(category: .entertainment, limit: 500_000, currency: .uzs),
            Budget(category: .shopping, limit: 1_500_000, currency: .uzs),
            Budget(category: .health, limit: 700_000, currency: .uzs),
            Budget(category: .subscriptions, limit: 25, currency: .usd),
        ]
    }

    static func goals() -> [Goal] {
        let cal = Calendar.current
        let today = Date()
        return [
            Goal(name: "MacBook Pro", icon: "laptopcomputer", target: 2_400, saved: 1_150, currency: .usd),
            Goal(name: "Emergency fund", icon: "shield.fill", target: 30_000_000, saved: 12_500_000, currency: .uzs,
                 deadline: cal.date(byAdding: .month, value: 6, to: today)),
            Goal(name: "Trip to Tokyo", icon: "airplane", target: 400_000, saved: 96_000, currency: .jpy,
                 deadline: cal.date(byAdding: .month, value: 10, to: today)),
            Goal(name: "New camera", icon: "camera.fill", target: 1_100, saved: 1_100, currency: .eur),
        ]
    }
}
