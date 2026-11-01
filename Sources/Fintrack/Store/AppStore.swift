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

    /// Set by the File ▸ New Transaction command (⌘N) from any screen; the
    /// Transactions screen opens its sheet and clears it.
    var newTransactionRequested = false

    /// Converter input, kept across screen switches (not persisted).
    var converterAmount: Double? = 100
    var converterFrom: CurrencyCode = .usd
    var converterTo: CurrencyCode? = nil

    /// Set when writing the data file fails, so the UI can warn instead of
    /// silently losing edits at quit. Cleared on the next successful save.
    private(set) var saveError: String?

    func clearSaveError() { saveError = nil }

    /// Set when the data file exists but could not be read or decoded. While a
    /// read failure is unresolved, saving is blocked so the file is never
    /// overwritten with an empty store.
    private(set) var loadError: String?

    func clearLoadError() { loadError = nil }

    private var saveBlocked = false

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
            let cleaned = Self.sanitized(rates)
            if cleaned != rates { rates = cleaned; return }
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

    /// Read-side twin of AppData: one malformed row is dropped instead of
    /// making the whole file unreadable.
    private struct LossyAppData: Decodable {
        var transactions: [Lossy<Transaction>]
        var budgets: [Lossy<Budget>]?
        var goals: [Lossy<Goal>]?
        var displayCurrency: CurrencyCode?
        var rates: [String: Double]?
        var accounts: [AccountEntry]?
    }

    /// An element of the accounts array: a full account (current layout), a
    /// bare name (interim layout), or something unreadable that is dropped.
    private enum AccountEntry: Decodable {
        case account(Account)
        case name(String)
        case unreadable

        init(from decoder: Decoder) throws {
            if let account = try? Account(from: decoder) { self = .account(account); return }
            if let name = try? decoder.singleValueContainer().decode(String.self) { self = .name(name); return }
            self = .unreadable
        }
    }

    /// Decodes to nil instead of throwing, so arrays survive a bad element.
    private struct Lossy<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws {
            value = try? T(from: decoder)
        }
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

    /// Where the JSON store lives. Defaults to Application Support/Fintrack;
    /// the `FINTRACK_DATA_DIR` environment variable points it elsewhere so
    /// tests and side-by-side runs never touch the real file.
    static func defaultDataURL() -> URL {
        let dir: URL
        if let override = ProcessInfo.processInfo.environment["FINTRACK_DATA_DIR"], !override.isEmpty {
            dir = URL(fileURLWithPath: override, isDirectory: true)
        } else {
            let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            dir = base.appendingPathComponent("Fintrack", isDirectory: true)
        }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("fintrack.json")
    }

    let dataURL: URL

    private var isLoading = false

    init(dataURL: URL = AppStore.defaultDataURL()) {
        self.dataURL = dataURL
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
        decoder.dateDecodingStrategy = Self.dateDecoding

        guard FileManager.default.fileExists(atPath: dataURL.path) else {
            // First launch: start completely empty. Sample data is opt-in
            // via Settings → "Load sample data".
            isLoading = false
            save()
            return
        }

        guard let data = try? Data(contentsOf: dataURL) else {
            // The file is there but unreadable (permissions, I/O). Never treat
            // that as a first launch: block saving so nothing overwrites it.
            saveBlocked = true
            loadError = "Fintrack couldn't read its data file at \(dataURL.path). Changes won't be saved until the file is readable again."
            return
        }

        var loadedRates: [CurrencyCode: Double]
        var needsNameMigration = false
        if let decoded = try? decoder.decode(LossyAppData.self, from: data) {
            let txs = decoded.transactions.compactMap(\.value)
            let dropped = decoded.transactions.count - txs.count
            transactions = txs.sorted { $0.date > $1.date }
            budgets = (decoded.budgets ?? []).compactMap(\.value)
            goals = (decoded.goals ?? []).compactMap(\.value)
            displayCurrency = decoded.displayCurrency ?? .uzs
            var hadNames = false
            accounts = (decoded.accounts ?? []).compactMap { entry in
                switch entry {
                case .account(let a): return a
                case .name(let n):
                    hadNames = true
                    return Account(name: n, currency: displayCurrency)
                case .unreadable: return nil
                }
            }
            // Only pre-account files (no accounts array, or bare names) carry
            // name-only transfer endpoints that need resolving.
            needsNameMigration = decoded.accounts == nil || hadNames
            loadedRates = [:]
            for (key, value) in decoded.rates ?? [:] {
                if let code = CurrencyCode(rawValue: key) { loadedRates[code] = value }
            }
            if dropped > 0 {
                loadError = "\(dropped) \(dropped == 1 ? "entry" : "entries") in the data file couldn't be read and \(dropped == 1 ? "was" : "were") skipped."
            }
        } else if let v2 = try? decoder.decode(StringAccountsAppData.self, from: data) {
            needsNameMigration = true
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
            needsNameMigration = true
            transactions = legacy.transactions.sorted { $0.date > $1.date }
            budgets = legacy.budgets
            goals = legacy.goals
            displayCurrency = legacy.displayCurrency
            loadedRates = legacy.rates
        } else {
            // The file exists but can't be read. NEVER overwrite it — park it
            // next to the store so the data stays recoverable, then start fresh.
            let backup = dataURL.deletingLastPathComponent()
                .appendingPathComponent("fintrack-unreadable-\(Int(Date().timeIntervalSince1970 * 1000)).json")
            do {
                try FileManager.default.copyItem(at: dataURL, to: backup)
                loadError = "The data file couldn't be read, so Fintrack started empty. The original was kept at \(backup.path)."
            } catch {
                // No backup, so the original must stay untouched.
                saveBlocked = true
                loadError = "The data file at \(dataURL.path) couldn't be read or backed up. Changes won't be saved until it is fixed or moved away."
            }
            return
        }

        rates = Self.sanitized(loadedRates)

        if needsNameMigration { migrateTransferAccountNames() }
    }

    /// Fills gaps and replaces invalid (zero, negative, non-finite) rates with
    /// the defaults; UZS is always exactly 1.
    private static func sanitized(_ input: [CurrencyCode: Double]) -> [CurrencyCode: Double] {
        var out: [CurrencyCode: Double] = [:]
        for code in CurrencyCode.allCases {
            let value = input[code] ?? 0
            out[code] = (value.isFinite && value > 0) ? value : CurrencyCode.defaultRates[code]
        }
        out[.uzs] = 1
        return out
    }

    /// Dates are written with fractional seconds so sub-second ordering
    /// survives a round trip; files written without them still decode.
    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    private static let dateDecoding: JSONDecoder.DateDecodingStrategy = .custom { decoder in
        let text = try decoder.singleValueContainer().decode(String.self)
        if let d = isoFractional.date(from: text) ?? isoPlain.date(from: text) { return d }
        throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unrecognised date \(text)"))
    }
    private static let dateEncoding: JSONEncoder.DateEncodingStrategy = .custom { date, encoder in
        var c = encoder.singleValueContainer()
        try c.encode(isoFractional.string(from: date))
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
        if saveBlocked {
            saveError = loadError ?? "Saving is paused because the data file couldn't be read."
            return
        }
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
        encoder.dateEncodingStrategy = Self.dateEncoding
        do {
            let encoded = try encoder.encode(data)
            try encoded.write(to: dataURL, options: .atomic)
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
        let account = Account(name: trimmed.isEmpty ? "Account" : trimmed, currency: currency, kind: kind)
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
            if transactions[i].fromAccountID == id {
                transactions[i].fromAccountID = nil
                transactions[i].fromAccount = nil
            }
            if transactions[i].toAccountID == id {
                transactions[i].toAccountID = nil
                transactions[i].toAccount = nil
            }
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
                    // A fixed received amount beats re-pricing at today's rate.
                    if let received = t.toAmount, let receivedCurrency = t.toCurrency {
                        total += convert(received, from: receivedCurrency, to: account.currency)
                    } else {
                        total += convert(t.amount, from: t.currency, to: account.currency)
                    }
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
        guard currency != .uzs, FTFormat.isValidRate(uzsPerUnit) else { return }
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
        guard let fromRate = rates[from], let toRate = rates[to], fromRate > 0, toRate > 0 else { return 0 }
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

    /// One sign rule for every list: income "+", expense and debt payment "−",
    /// loan received "+" (money arrived, but it's borrowed), plain transfer unsigned.
    func signedDisplayAmount(_ t: Transaction) -> String {
        // A transfer that fixed what arrived shows that, not today's re-pricing.
        let formatted: String
        if let received = t.toAmount, let currency = t.toCurrency {
            formatted = formatInDisplay(received, from: currency)
        } else {
            formatted = formatInDisplay(t.amount, from: t.currency)
        }
        switch t.kind {
        case .income: return "+\(formatted)"
        case .expense: return "−\(formatted)"
        case .transfer where t.isDebtPayment: return "−\(formatted)"
        case .transfer where t.isLoanReceived: return "+\(formatted)"
        case .transfer: return formatted
        }
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

extension FormatStyle where Self == FTFormat.FlexibleNumber {
    /// Amount fields: `TextField("Amount", value: $amount, format: .amount)`.
    static var amount: FTFormat.FlexibleNumber { FTFormat.FlexibleNumber() }
}

enum FTFormat {

    /// Upper bound for any amount the app accepts — far beyond any real
    /// balance, well inside what Double and JSON handle cleanly.
    static let maxAmount: Double = 1e15

    /// A typed amount is usable when it is a finite, positive, sane number.
    static func isValidAmount(_ value: Double?) -> Bool {
        guard let value else { return false }
        return value.isFinite && value > 0 && value < maxAmount
    }

    /// Opening balances may be negative (overdrafts) but must still be finite and sane.
    static func isValidBalance(_ value: Double?) -> Bool {
        guard let value else { return true }
        return value.isFinite && abs(value) < maxAmount
    }

    static func isValidRate(_ value: Double) -> Bool {
        value.isFinite && value > 0 && value < 1e12
    }

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
        let rounded = (abs(amount) * 100).rounded(.toNearestOrAwayFromZero) / 100
        let hasFraction = currency.fractionDigits > 0
            && rounded.truncatingRemainder(dividingBy: 1) != 0
        formatter.minimumFractionDigits = hasFraction ? currency.fractionDigits : 0
        formatter.maximumFractionDigits = currency.fractionDigits
        formatter.roundingMode = .halfUp
        guard amount.isFinite else { return "—" }
        // Round ONCE, half away from zero, and format that value, so the sign
        // and the digits always agree: −0.001 soʻm is "0 soʻm", not "−0 soʻm".
        let scale = pow(10.0, Double(currency.fractionDigits))
        let roundedMagnitude = (abs(amount) * scale).rounded(.toNearestOrAwayFromZero) / scale
        let magnitude = formatter.string(from: NSNumber(value: roundedMagnitude)) ?? "0"
        let sign = (amount < 0 && roundedMagnitude > 0) ? "−" : ""
        return currency.symbolLeading
            ? "\(sign)\(currency.symbol)\(magnitude)"
            : "\(sign)\(magnitude)\u{00A0}\(currency.symbol)"
    }

    /// Compact money for chart axes and tight tiles: "12.4M soʻm", "$1.2K".
    static func compactMoney(_ amount: Double, currency: CurrencyCode) -> String {
        guard amount.isFinite else { return "—" }
        let sign = amount < 0 ? "−" : ""
        let value = abs(amount)
        let magnitude: String
        // Thresholds sit at x99.95 so rounding promotes to the next unit
        // ("999.97K" becomes "1M", never "1000K").
        switch value {
        case 999_950_000_000...: magnitude = trimmed(value / 1_000_000_000_000) + "T"
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
        // No Int conversion: it traps above ~9.2e18.
        return rounded == rounded.rounded()
            ? String(format: "%.0f", rounded)
            : String(format: "%.1f", rounded)
    }

    /// Number entry that accepts either decimal separator ("40.5" and "40,5"),
    /// ignores grouping spaces, and prints without grouping — so a typed "."
    /// is never silently dropped in locales whose decimal mark is ",".
    struct FlexibleNumber: ParseableFormatStyle {
        struct Strategy: ParseStrategy {
            func parse(_ value: String) throws -> Double {
                var s = value.trimmingCharacters(in: .whitespacesAndNewlines)
                s = s.replacingOccurrences(of: "\u{00A0}", with: "")
                    .replacingOccurrences(of: " ", with: "")
                    .replacingOccurrences(of: "'", with: "")
                let lastComma = s.lastIndex(of: ",")
                let lastDot = s.lastIndex(of: ".")
                if let lc = lastComma, let ld = lastDot {
                    // Both present: the later one is the decimal mark.
                    s = lc > ld
                        ? s.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
                        : s.replacingOccurrences(of: ",", with: "")
                } else if lastComma != nil {
                    let parts = s.split(separator: ",", omittingEmptySubsequences: false)
                    // "1,5" / "12,50" are decimals; "1,234" or "1,234,567" is grouping.
                    s = parts.count == 2 && (1...2).contains(parts[1].count)
                        ? parts.joined(separator: ".")
                        : s.replacingOccurrences(of: ",", with: "")
                }
                guard let d = Double(s), d.isFinite else {
                    throw DecodingError.dataCorrupted(.init(codingPath: [], debugDescription: "Not a number: \(value)"))
                }
                return d
            }
        }
        var parseStrategy: Strategy { Strategy() }
        func format(_ value: Double) -> String {
            guard value.isFinite else { return "" }
            let rounded = (value * 100).rounded(.toNearestOrAwayFromZero) / 100
            return rounded == rounded.rounded()
                ? String(format: "%.0f", rounded)
                : String(String(format: "%.2f", rounded).reversed().drop(while: { $0 == "0" }).reversed())
        }
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
