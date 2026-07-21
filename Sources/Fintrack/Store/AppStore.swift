import SwiftUI
import Observation

/// One point on a daily-spending series.
struct DailyAmount: Identifiable {
    var date: Date
    var amount: Double
    var id: Date { date }
}

/// Central observable state + JSON persistence.
///
/// All mutations must go through the methods below so data is saved.
/// `displayCurrency` and `rates` may be bound directly — they save on change.
@Observable
final class AppStore {

    // MARK: State

    /// Currently visible screen (not persisted). Drives sidebar + ⌘1–6 shortcuts.
    var activeSection: AppSection = .dashboard

    /// True while the window is in full screen. The window toolbar paints an
    /// opaque strip there, so screens render their actions inline instead.
    var isFullscreen = false

    /// Set when writing the data file fails, so the UI can warn instead of
    /// silently losing edits at quit. Cleared on the next successful save.
    private(set) var saveError: String?

    func clearSaveError() { saveError = nil }

    /// Newest first.
    private(set) var transactions: [Transaction] = []
    private(set) var budgets: [Budget] = []
    private(set) var goals: [Goal] = []

    /// Bank accounts / cards with balances. Sorted by name.
    private(set) var accounts: [Account] = []

    /// Currency every aggregate number in the app is shown in. Defaults to UZS.
    var displayCurrency: CurrencyCode = .uzs {
        didSet { save() }
    }

    /// User-editable exchange rates: UZS per 1 unit of each currency. UZS is always 1.
    var rates: [CurrencyCode: Double] = CurrencyCode.defaultRates {
        didSet {
            // Guard the re-assignment or this didSet recurses forever.
            if rates[.uzs] != 1 { rates[.uzs] = 1 }
            save()
        }
    }

    // MARK: Persistence

    private struct AppData: Codable {
        var transactions: [Transaction]
        var budgets: [Budget]
        var goals: [Goal]
        var displayCurrency: CurrencyCode
        /// String-keyed so the JSON stays a readable {"USD": 12110, ...} object
        /// (enum-keyed dictionaries encode as a flat array).
        var rates: [String: Double]
        /// Optional so files written before accounts existed still decode.
        var accounts: [Account]?
    }

    /// Interim layout where accounts were plain name strings.
    private struct StringAccountsAppData: Codable {
        var transactions: [Transaction]
        var budgets: [Budget]
        var goals: [Goal]
        var displayCurrency: CurrencyCode
        var rates: [String: Double]
        var accounts: [String]?
    }

    /// Pre-1.0 layout where rates were enum-keyed (encoded as a flat array).
    private struct LegacyAppData: Codable {
        var transactions: [Transaction]
        var budgets: [Budget]
        var goals: [Goal]
        var displayCurrency: CurrencyCode
        var rates: [CurrencyCode: Double]
    }

    private static var dataURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("Fintrack", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fintrack.json")
    }

    private var isLoading = false

    init() {
        load()
        // Test hook: `swift run Fintrack --seed` starts with the demo dataset.
        if CommandLine.arguments.contains("--seed") {
            resetToSampleData()
        }
    }

    private func load() {
        isLoading = true
        defer { isLoading = false }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        guard let data = try? Data(contentsOf: Self.dataURL) else {
            // First launch: start completely empty. Sample data is opt-in
            // via Settings → "Load sample data".
            isLoading = false
            save()
            return
        }

        var loadedRates: [CurrencyCode: Double]
        if let decoded = try? decoder.decode(AppData.self, from: data) {
            transactions = decoded.transactions.sorted { $0.date > $1.date }
            budgets = decoded.budgets
            goals = decoded.goals
            displayCurrency = decoded.displayCurrency
            accounts = decoded.accounts ?? []
            loadedRates = [:]
            for (key, value) in decoded.rates {
                if let code = CurrencyCode(rawValue: key) { loadedRates[code] = value }
            }
        } else if let v2 = try? decoder.decode(StringAccountsAppData.self, from: data) {
            transactions = v2.transactions.sorted { $0.date > $1.date }
            budgets = v2.budgets
            goals = v2.goals
            displayCurrency = v2.displayCurrency
            accounts = (v2.accounts ?? []).map {
                Account(name: $0, currency: v2.displayCurrency)
            }
            loadedRates = [:]
            for (key, value) in v2.rates {
                if let code = CurrencyCode(rawValue: key) { loadedRates[code] = value }
            }
        } else if let legacy = try? decoder.decode(LegacyAppData.self, from: data) {
            transactions = legacy.transactions.sorted { $0.date > $1.date }
            budgets = legacy.budgets
            goals = legacy.goals
            displayCurrency = legacy.displayCurrency
            loadedRates = legacy.rates
        } else {
            // The file exists but can't be read. NEVER overwrite it — park it
            // next to the store so the data stays recoverable, then start fresh.
            let backup = Self.dataURL.deletingLastPathComponent()
                .appendingPathComponent("fintrack-unreadable-\(Int(Date().timeIntervalSince1970)).json")
            try? FileManager.default.copyItem(at: Self.dataURL, to: backup)
            isLoading = false
            return
        }

        // Fill gaps and drop invalid (zero/negative) saved rates.
        for code in CurrencyCode.allCases {
            let value = loadedRates[code] ?? 0
            if value <= 0 { loadedRates[code] = CurrencyCode.defaultRates[code] }
        }
        loadedRates[.uzs] = 1
        rates = loadedRates

        migrateTransferAccountNames()
    }

    /// Pre-account files stored transfer endpoints as free-text names.
    /// Resolve each name to an Account (creating it if needed) and link by ID.
    private func migrateTransferAccountNames() {
        for i in transactions.indices where transactions[i].kind == .transfer {
            if transactions[i].fromAccountID == nil, let name = transactions[i].fromAccount, !name.isEmpty {
                transactions[i].fromAccountID = findOrCreateAccount(named: name).id
            }
            if transactions[i].toAccountID == nil, let name = transactions[i].toAccount, !name.isEmpty {
                transactions[i].toAccountID = findOrCreateAccount(named: name).id
            }
        }
        sortAccounts()
    }

    private func findOrCreateAccount(named name: String) -> Account {
        if let existing = accounts.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) {
            return existing
        }
        let account = Account(name: name, currency: displayCurrency)
        accounts.append(account)
        return account
    }

    private func sortAccounts() {
        accounts.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func save() {
        guard !isLoading else { return }
        let data = AppData(
            transactions: transactions,
            budgets: budgets,
            goals: goals,
            displayCurrency: displayCurrency,
            rates: Dictionary(uniqueKeysWithValues: rates.map { ($0.key.rawValue, $0.value) }),
            accounts: accounts
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        do {
            let encoded = try encoder.encode(data)
            try encoded.write(to: Self.dataURL, options: .atomic)
            saveError = nil
        } catch {
            saveError = error.localizedDescription
        }
    }

    // MARK: Transactions

    func addTransaction(_ t: Transaction) {
        transactions.append(t)
        transactions.sort { $0.date > $1.date }
        save()
    }

    func updateTransaction(_ t: Transaction) {
        guard let i = transactions.firstIndex(where: { $0.id == t.id }) else { return }
        transactions[i] = t
        transactions.sort { $0.date > $1.date }
        save()
    }

    func deleteTransaction(id: UUID) {
        transactions.removeAll { $0.id == id }
        save()
    }

    func deleteTransactions(ids: Set<UUID>) {
        transactions.removeAll { ids.contains($0.id) }
        save()
    }

    // MARK: Budgets

    func addBudget(_ b: Budget) {
        budgets.append(b)
        save()
    }

    func updateBudget(_ b: Budget) {
        guard let i = budgets.firstIndex(where: { $0.id == b.id }) else { return }
        budgets[i] = b
        save()
    }

    func deleteBudget(id: UUID) {
        budgets.removeAll { $0.id == id }
        save()
    }

    // MARK: Goals

    func addGoal(_ g: Goal) {
        goals.append(g)
        save()
    }

    func updateGoal(_ g: Goal) {
        guard let i = goals.firstIndex(where: { $0.id == g.id }) else { return }
        goals[i] = g
        save()
    }

    func deleteGoal(id: UUID) {
        goals.removeAll { $0.id == id }
        save()
    }

    /// Adds money to a goal, converting from `currency` into the goal's currency.
    func addFunds(toGoal id: UUID, amount: Double, currency: CurrencyCode) {
        guard let i = goals.firstIndex(where: { $0.id == id }) else { return }
        goals[i].saved += convert(amount, from: currency, to: goals[i].currency)
        save()
    }

    // MARK: Accounts

    func addAccount(_ account: Account) {
        accounts.append(account)
        sortAccounts()
        save()
    }

    /// Creates and registers an account from just a name (used by the inline
    /// "New Account…" flow). Returns the existing account when the name matches.
    @discardableResult
    func createAccount(named name: String, currency: CurrencyCode, kind: AccountKind = .regular) -> Account {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let existing = accounts.first(where: { $0.name.caseInsensitiveCompare(trimmed) == .orderedSame }) {
            return existing
        }
        let account = Account(name: trimmed, currency: currency, kind: kind)
        accounts.append(account)
        sortAccounts()
        save()
        return account
    }

    func updateAccount(_ account: Account) {
        guard let i = accounts.firstIndex(where: { $0.id == account.id }) else { return }
        accounts[i] = account
        sortAccounts()
        save()
    }

    /// Deletes an account and unlinks every transaction that referenced it —
    /// the transactions themselves are kept.
    func deleteAccount(id: UUID) {
        accounts.removeAll { $0.id == id }
        for i in transactions.indices {
            if transactions[i].accountID == id { transactions[i].accountID = nil }
            if transactions[i].fromAccountID == id { transactions[i].fromAccountID = nil }
            if transactions[i].toAccountID == id { transactions[i].toAccountID = nil }
        }
        save()
    }

    func account(_ id: UUID?) -> Account? {
        guard let id else { return nil }
        return accounts.first { $0.id == id }
    }

    /// Current balance in the account's own currency: opening balance plus all
    /// linked income, minus linked expenses, adjusted by transfers in and out.
    func balance(of account: Account) -> Double {
        var total = account.openingBalance
        for t in transactions {
            switch t.kind {
            case .income where t.accountID == account.id:
                total += convert(t.amount, from: t.currency, to: account.currency)
            case .expense where t.accountID == account.id:
                total -= convert(t.amount, from: t.currency, to: account.currency)
            case .transfer:
                if t.fromAccountID == account.id {
                    total -= convert(t.amount, from: t.currency, to: account.currency)
                }
                if t.toAccountID == account.id {
                    total += convert(t.amount, from: t.currency, to: account.currency)
                }
            default:
                break
            }
        }
        return total
    }

    /// Counted accounts' balances summed in the display currency. Accounts
    /// with the "count in total" toggle off are skipped; debts included here
    /// carry negative balances and pull the total down.
    var totalAccountsBalance: Double {
        accounts
            .filter(\.includeInTotal)
            .reduce(0) { $0 + inDisplay(balance(of: $1), from: $1.currency) }
    }

    /// The headline balance split per currency — no conversion, money stays in
    /// the currency it actually sits in ("34 456 990 soʻm | $560").
    /// Display currency first, then by converted size, zero balances dropped.
    var balancesByCurrency: [(currency: CurrencyCode, amount: Double)] {
        var totals: [CurrencyCode: Double] = [:]
        if accounts.isEmpty {
            for t in transactions where t.kind != .transfer {
                totals[t.currency, default: 0] += t.signedAmount
            }
        } else {
            for a in accounts where a.includeInTotal {
                totals[a.currency, default: 0] += balance(of: a)
            }
            for t in transactions where t.kind != .transfer && t.accountID == nil {
                totals[t.currency, default: 0] += t.signedAmount
            }
        }
        let nonZero = totals.filter { abs($0.value) >= 0.005 }
        guard !nonZero.isEmpty else { return [(displayCurrency, 0)] }
        return nonZero
            .map { (currency: $0.key, amount: $0.value) }
            .sorted {
                if $0.currency == displayCurrency { return true }
                if $1.currency == displayCurrency { return false }
                return abs(inDisplay($0.amount, from: $0.currency)) > abs(inDisplay($1.amount, from: $1.currency))
            }
    }

    /// "34 456 990 soʻm | $560" — the per-currency split as one line.
    var balanceSplitText: String {
        balancesByCurrency
            .map { FTFormat.money($0.amount, currency: $0.currency) }
            .joined(separator: "  |  ")
    }

    // MARK: Rates

    /// Sets how many UZS one unit of `currency` is worth.
    func setRate(_ uzsPerUnit: Double, for currency: CurrencyCode) {
        guard currency != .uzs, uzsPerUnit > 0 else { return }
        rates[currency] = uzsPerUnit
    }

    func resetRatesToDefaults() {
        rates = CurrencyCode.defaultRates
    }

    // MARK: Data management

    func resetToSampleData() {
        let bundle = SampleData.bundle()
        accounts = bundle.accounts
        transactions = bundle.transactions
        budgets = bundle.budgets
        goals = bundle.goals
        sortAccounts()
        save()
    }

    func eraseAll() {
        transactions = []
        budgets = []
        goals = []
        accounts = []
        save()
    }

    // MARK: Conversion & formatting

    func convert(_ amount: Double, from: CurrencyCode, to: CurrencyCode) -> Double {
        guard from != to else { return amount }
        let fromRate = rates[from] ?? 1
        let toRate = rates[to] ?? 1
        guard toRate > 0 else { return 0 }
        return amount * fromRate / toRate
    }

    /// Converts into the current display currency.
    func inDisplay(_ amount: Double, from currency: CurrencyCode) -> Double {
        convert(amount, from: currency, to: displayCurrency)
    }

    /// "125 400 soʻm", "$1,234.50", "−45 000 soʻm".
    func format(_ amount: Double, in currency: CurrencyCode) -> String {
        FTFormat.money(amount, currency: currency)
    }

    /// Converts from `currency` into the display currency, then formats.
    func formatInDisplay(_ amount: Double, from currency: CurrencyCode) -> String {
        FTFormat.money(inDisplay(amount, from: currency), currency: displayCurrency)
    }

    // MARK: Analytics (all in display currency unless stated otherwise)

    /// The headline balance. With accounts set up it is the sum of all account
    /// balances (opening + linked activity) plus any income/expense not linked
    /// to an account, so untracked entries never silently disappear. Without
    /// accounts it falls back to the plain all-time ledger.
    var balance: Double {
        guard !accounts.isEmpty else {
            return transactions.reduce(0) { $0 + inDisplay($1.signedAmount, from: $1.currency) }
        }
        let unlinked = transactions
            .filter { $0.kind != .transfer && $0.accountID == nil }
            .reduce(0) { $0 + inDisplay($1.signedAmount, from: $1.currency) }
        return totalAccountsBalance + unlinked
    }

    var monthIncome: Double {
        let now = Date()
        return transactions
            .filter { $0.kind == .income && $0.date.isSameMonth(as: now) }
            .reduce(0) { $0 + inDisplay($1.amount, from: $1.currency) }
    }

    var monthExpense: Double {
        let now = Date()
        return transactions
            .filter { $0.isSpending && $0.date.isSameMonth(as: now) }
            .reduce(0) { $0 + inDisplay($1.amount, from: $1.currency) }
    }

    /// Current-month spending in one category, in the display currency.
    func spentThisMonth(in category: Category) -> Double {
        spentThisMonth(in: category, convertedTo: displayCurrency)
    }

    /// Current-month spending in one category, converted to an arbitrary currency.
    func spentThisMonth(in category: Category, convertedTo currency: CurrencyCode) -> Double {
        let now = Date()
        return transactions
            .filter { $0.isSpending && $0.category == category && $0.date.isSameMonth(as: now) }
            .reduce(0) { $0 + convert($1.amount, from: $1.currency, to: currency) }
    }

    /// Current-month expense totals per category, sorted highest first. Display currency.
    var monthSpendingByCategory: [(category: Category, amount: Double)] {
        let now = Date()
        var totals: [Category: Double] = [:]
        for t in transactions where t.isSpending && t.date.isSameMonth(as: now) {
            totals[t.category, default: 0] += inDisplay(t.amount, from: t.currency)
        }
        return totals
            .map { (category: $0.key, amount: $0.value) }
            .sorted { $0.amount > $1.amount }
    }

    /// Expense total per day for the last `lastDays` days (including today), display currency.
    /// Days with no spending are included with amount 0, oldest first.
    func dailyExpenses(lastDays: Int) -> [DailyAmount] {
        let cal = Calendar.current
        let today = Date().startOfDay
        var series: [DailyAmount] = []
        for offset in stride(from: lastDays - 1, through: 0, by: -1) {
            guard let day = cal.date(byAdding: .day, value: -offset, to: today) else { continue }
            let total = transactions
                .filter { $0.isSpending && $0.date.isSameDay(as: day) }
                .reduce(0) { $0 + inDisplay($1.amount, from: $1.currency) }
            series.append(DailyAmount(date: day, amount: total))
        }
        return series
    }

    /// Monthly state for a budget; all amounts in the budget's own currency.
    func status(of budget: Budget) -> BudgetStatus {
        BudgetStatus(
            spent: spentThisMonth(in: budget.category, convertedTo: budget.currency),
            limit: budget.limit
        )
    }

    /// Categories that don't have a budget yet.
    var unbudgetedCategories: [Category] {
        let used = Set(budgets.map(\.category))
        return Category.expenseCategories.filter { !used.contains($0) }
    }
}

// MARK: - Formatting

enum FTFormat {

    /// Full money string with grouping and the currency's symbol placement.
    /// Uses U+00A0 no-break space as the grouping separator for suffix currencies —
    /// wide enough that "23 380 412" reads as grouped at semibold display sizes.
    static func money(_ amount: Double, currency: CurrencyCode) -> String {
        let formatter = NumberFormatter()
        // Locale-independent: prefix currencies read "$1,234.50",
        // suffix currencies read "1 234,5 ₽" / "12 110 soʻm".
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true  // POSIX locale turns this off
        formatter.groupingSeparator = currency.symbolLeading ? "," : "\u{00A0}"
        formatter.decimalSeparator = currency.symbolLeading ? "." : ","
        // Whole amounts stay clean ("$350"); fractional ones get the full
        // precision ("$1,368.10", never "$1,368.1").
        let rounded = (abs(amount) * 100).rounded() / 100
        let hasFraction = currency.fractionDigits > 0
            && rounded.truncatingRemainder(dividingBy: 1) != 0
        formatter.minimumFractionDigits = hasFraction ? currency.fractionDigits : 0
        formatter.maximumFractionDigits = currency.fractionDigits
        let magnitude = formatter.string(from: NSNumber(value: abs(amount))) ?? "0"
        // Sign follows the ROUNDED magnitude so -0.001 soʻm never prints "−0 soʻm".
        let sign = (amount < 0 && magnitude != "0") ? "−" : ""
        return currency.symbolLeading
            ? "\(sign)\(currency.symbol)\(magnitude)"
            : "\(sign)\(magnitude)\u{00A0}\(currency.symbol)"
    }

    /// Compact money for chart axes and tight tiles: "12.4M soʻm", "$1.2K".
    static func compactMoney(_ amount: Double, currency: CurrencyCode) -> String {
        let sign = amount < 0 ? "−" : ""
        let value = abs(amount)
        let magnitude: String
        // Thresholds sit at x99.95 so rounding promotes to the next unit
        // ("999.97K" becomes "1M", never "1000K").
        switch value {
        case 999_950_000...: magnitude = trimmed(value / 1_000_000_000) + "B"
        case 999_950...: magnitude = trimmed(value / 1_000_000) + "M"
        case 10_000...: magnitude = trimmed(value / 1_000) + "K"
        default: return money(amount, currency: currency)
        }
        return currency.symbolLeading
            ? "\(sign)\(currency.symbol)\(magnitude)"
            : "\(sign)\(magnitude)\u{00A0}\(currency.symbol)"
    }

    private static func trimmed(_ value: Double) -> String {
        let rounded = (value * 10).rounded() / 10
        return rounded == rounded.rounded()
            ? String(Int(rounded))
            : String(format: "%.1f", rounded)
    }

    /// "Today", "Yesterday", or "12 July".
    static func dayLabel(_ date: Date) -> String {
        if date.isSameDay(as: Date()) { return "Today" }
        if let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()),
           date.isSameDay(as: yesterday) { return "Yesterday" }
        let formatter = DateFormatter()
        formatter.dateFormat = date.isSameMonth(as: Date()) || Calendar.current.component(.year, from: date) == Calendar.current.component(.year, from: Date())
            ? "d MMMM"
            : "d MMMM yyyy"
        return formatter.string(from: date)
    }
}
