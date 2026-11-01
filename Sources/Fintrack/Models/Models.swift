import SwiftUI

// MARK: - Currency

enum CurrencyCode: String, Codable, CaseIterable, Identifiable, Hashable {
    case uzs = "UZS"
    case kzt = "KZT"
    case rub = "RUB"
    case usd = "USD"
    case jpy = "JPY"
    case gbp = "GBP"
    case eur = "EUR"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .uzs: "soʻm"
        case .kzt: "₸"
        case .rub: "₽"
        case .usd: "$"
        case .jpy: "¥"
        case .gbp: "£"
        case .eur: "€"
        }
    }

    var displayName: String {
        switch self {
        case .uzs: "Uzbek soʻm"
        case .kzt: "Kazakhstani tenge"
        case .rub: "Russian ruble"
        case .usd: "US dollar"
        case .jpy: "Japanese yen"
        case .gbp: "British pound"
        case .eur: "Euro"
        }
    }

    var flag: String {
        switch self {
        case .uzs: "🇺🇿"
        case .kzt: "🇰🇿"
        case .rub: "🇷🇺"
        case .usd: "🇺🇸"
        case .jpy: "🇯🇵"
        case .gbp: "🇬🇧"
        case .eur: "🇪🇺"
        }
    }

    /// Whether the symbol is written before the amount ($12) or after (12 soʻm).
    var symbolLeading: Bool {
        switch self {
        case .usd, .gbp, .eur, .jpy: true
        case .uzs, .kzt, .rub: false
        }
    }

    var fractionDigits: Int {
        switch self {
        case .uzs, .jpy, .kzt: 0
        case .rub, .usd, .gbp, .eur: 2
        }
    }

    /// Default exchange rates, expressed as UZS per 1 unit of the currency.
    static let defaultRates: [CurrencyCode: Double] = [
        .uzs: 1,
        .usd: 12_110,
        .eur: 14_150,
        .gbp: 16_320,
        .rub: 155,
        .kzt: 23.5,
        .jpy: 82,
    ]
}

// MARK: - Category

enum Category: String, Codable, CaseIterable, Identifiable, Hashable {
    case salary
    case business
    case gifts
    case groceries
    case eatingOut
    case transport
    case housing
    case utilities
    case health
    case entertainment
    case shopping
    case education
    case travel
    case subscriptions
    case transfer
    case debtPayment
    case loanReceived
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .salary: "Salary"
        case .business: "Business"
        case .gifts: "Gifts"
        case .groceries: "Groceries"
        case .eatingOut: "Eating Out"
        case .transport: "Transport"
        case .housing: "Housing"
        case .utilities: "Utilities"
        case .health: "Health"
        case .entertainment: "Entertainment"
        case .shopping: "Shopping"
        case .education: "Education"
        case .travel: "Travel"
        case .subscriptions: "Subscriptions"
        case .transfer: "Transfer"
        case .debtPayment: "Debt payment"
        case .loanReceived: "Loan received"
        case .other: "Other"
        }
    }

    var icon: String {
        switch self {
        case .salary: "banknote.fill"
        case .business: "briefcase.fill"
        case .gifts: "gift.fill"
        case .groceries: "cart.fill"
        case .eatingOut: "fork.knife"
        case .transport: "car.fill"
        case .housing: "house.fill"
        case .utilities: "bolt.fill"
        case .health: "cross.case.fill"
        case .entertainment: "gamecontroller.fill"
        case .shopping: "bag.fill"
        case .education: "graduationcap.fill"
        case .travel: "airplane"
        case .subscriptions: "arrow.triangle.2.circlepath"
        case .transfer: "arrow.left.arrow.right"
        case .debtPayment: "creditcard.trianglebadge.exclamationmark"
        case .loanReceived: "arrow.down.circle.fill"
        case .other: "ellipsis.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .salary: .green
        case .business: .mint
        case .gifts: .pink
        case .groceries: .orange
        case .eatingOut: .red
        case .transport: .blue
        case .housing: .brown
        case .utilities: .yellow
        case .health: .teal
        case .entertainment: .purple
        case .shopping: .indigo
        case .education: .cyan
        case .travel: .blue
        case .subscriptions: .purple
        case .transfer: .blue
        case .debtPayment: .orange
        case .loanReceived: .teal
        case .other: .gray
        }
    }

    /// Categories that usually represent income. "Loan received" routes the
    /// money out of a debt account — neutral for income stats.
    static let incomeCategories: [Category] = [.salary, .business, .gifts, .loanReceived, .other]
    /// Categories that usually represent expenses. Debt payment is offered
    /// here too — picking it routes the money into a debt account.
    static let expenseCategories: [Category] = [
        .groceries, .eatingOut, .transport, .housing, .utilities, .health,
        .entertainment, .shopping, .education, .travel, .subscriptions, .gifts,
        .debtPayment, .other,
    ]
}

// MARK: - Account

enum AccountKind: String, Codable, CaseIterable, Identifiable {
    case regular
    case debt

    var id: String { rawValue }
    var title: String { self == .regular ? "Regular" : "Debt" }
}

/// A place money lives: cash, a bank card, a savings account — or a debt,
/// whose balance is negative and pulls the total down.
struct Account: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String
    var icon: String = "creditcard.fill"
    var currency: CurrencyCode
    /// Balance at the moment the account was added; current balance is
    /// derived by AppStore from linked transactions. Negative for debts.
    var openingBalance: Double = 0
    var kind: AccountKind = .regular
    /// Whether this account participates in the headline total balance.
    var includeInTotal: Bool = true

    static let icons = [
        "creditcard.fill", "banknote.fill", "building.columns.fill",
        "wallet.pass.fill", "dollarsign.circle.fill", "lock.fill",
    ]

    /// Human-readable name for an icon, for VoiceOver.
    static func iconLabel(_ symbol: String) -> String {
        switch symbol {
        case "creditcard.fill": "Card"
        case "banknote.fill": "Cash"
        case "building.columns.fill": "Bank"
        case "wallet.pass.fill": "Wallet"
        case "dollarsign.circle.fill": "Dollar"
        case "lock.fill": "Locked"
        case "star.fill": "Star"
        case "laptopcomputer": "Laptop"
        case "airplane": "Airplane"
        case "house.fill": "House"
        case "car.fill": "Car"
        case "graduationcap.fill": "Education"
        case "heart.fill": "Heart"
        case "shield.fill": "Shield"
        case "gift.fill": "Gift"
        case "camera.fill": "Camera"
        default: symbol
        }
    }

    init(
        id: UUID = UUID(),
        name: String,
        icon: String = "creditcard.fill",
        currency: CurrencyCode,
        openingBalance: Double = 0,
        kind: AccountKind = .regular,
        includeInTotal: Bool = true
    ) {
        self.id = id
        self.name = name
        self.icon = icon
        self.currency = currency
        self.openingBalance = openingBalance
        self.kind = kind
        self.includeInTotal = includeInTotal
    }

    // Lenient decoding so files saved before `kind`/`includeInTotal` existed
    // still load with sensible defaults.
    private enum CodingKeys: String, CodingKey {
        case id, name, icon, currency, openingBalance, kind, includeInTotal
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "creditcard.fill"
        currency = try c.decode(CurrencyCode.self, forKey: .currency)
        openingBalance = try c.decodeIfPresent(Double.self, forKey: .openingBalance) ?? 0
        kind = try c.decodeIfPresent(AccountKind.self, forKey: .kind) ?? .regular
        includeInTotal = try c.decodeIfPresent(Bool.self, forKey: .includeInTotal) ?? true
    }
}

// MARK: - Transaction

enum TransactionKind: String, Codable, CaseIterable, Identifiable {
    case income
    case expense
    case transfer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .income: "Income"
        case .expense: "Expense"
        case .transfer: "Transfer"
        }
    }
}

struct Transaction: Identifiable, Codable, Hashable {
    var id = UUID()
    var title: String
    var amount: Double
    var currency: CurrencyCode
    var category: Category
    var kind: TransactionKind
    var date: Date
    var note: String = ""
    /// Income/expense: the account the money hit (optional — nil = untracked).
    var accountID: UUID? = nil
    /// Transfers: which account the money left and where it landed.
    var fromAccountID: UUID? = nil
    var toAccountID: UUID? = nil
    /// Legacy name-based transfer fields; kept so pre-account files decode,
    /// migrated to IDs on load.
    var fromAccount: String? = nil
    var toAccount: String? = nil

    /// Positive for income, negative for expense, zero for transfers
    /// (money moves between the user's own accounts) — in the
    /// transaction's own currency.
    var signedAmount: Double {
        switch kind {
        case .income: amount
        case .expense: -amount
        case .transfer: 0
        }
    }

    /// Debt payments are transfers under the hood (net worth already counts
    /// the debt) but the user chose to treat them as spending in stats.
    var isDebtPayment: Bool { kind == .transfer && category == .debtPayment }

    /// Borrowing: transfer out of a debt account into a regular one.
    /// Neutral for income stats — a loan is not earnings.
    var isLoanReceived: Bool { kind == .transfer && category == .loanReceived }

    /// Whether this transaction counts toward spending stats and budgets.
    var isSpending: Bool { kind == .expense || isDebtPayment }

    init(
        id: UUID = UUID(), title: String, amount: Double, currency: CurrencyCode, category: Category,
        kind: TransactionKind, date: Date, note: String = "", accountID: UUID? = nil,
        fromAccountID: UUID? = nil, toAccountID: UUID? = nil, fromAccount: String? = nil, toAccount: String? = nil
    ) {
        self.id = id
        self.title = title
        self.amount = amount
        self.currency = currency
        self.category = category
        self.kind = kind
        self.date = date
        self.note = note
        self.accountID = accountID
        self.fromAccountID = fromAccountID
        self.toAccountID = toAccountID
        self.fromAccount = fromAccount
        self.toAccount = toAccount
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, amount, currency, category, kind, date, note, accountID, fromAccountID, toAccountID, fromAccount, toAccount
    }

    /// Lenient: optional fields may be absent; a non-finite amount is rejected
    /// so one bad row can't poison every total.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        title = try c.decode(String.self, forKey: .title)
        amount = try c.decode(Double.self, forKey: .amount)
        guard amount.isFinite else {
            throw DecodingError.dataCorruptedError(forKey: .amount, in: c, debugDescription: "Amount is not finite")
        }
        currency = try c.decode(CurrencyCode.self, forKey: .currency)
        category = try c.decode(Category.self, forKey: .category)
        kind = try c.decode(TransactionKind.self, forKey: .kind)
        date = try c.decode(Date.self, forKey: .date)
        note = try c.decodeIfPresent(String.self, forKey: .note) ?? ""
        accountID = try c.decodeIfPresent(UUID.self, forKey: .accountID)
        fromAccountID = try c.decodeIfPresent(UUID.self, forKey: .fromAccountID)
        toAccountID = try c.decodeIfPresent(UUID.self, forKey: .toAccountID)
        fromAccount = try c.decodeIfPresent(String.self, forKey: .fromAccount)
        toAccount = try c.decodeIfPresent(String.self, forKey: .toAccount)
    }
}

// MARK: - Budget

/// A monthly spending limit for one category.
struct Budget: Identifiable, Codable, Hashable {
    var id = UUID()
    var category: Category
    var limit: Double
    var currency: CurrencyCode

    init(id: UUID = UUID(), category: Category, limit: Double, currency: CurrencyCode) {
        self.id = id
        self.category = category
        self.limit = limit
        self.currency = currency
    }

    private enum CodingKeys: String, CodingKey { case id, category, limit, currency }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        category = try c.decode(Category.self, forKey: .category)
        limit = try c.decode(Double.self, forKey: .limit)
        guard limit.isFinite else {
            throw DecodingError.dataCorruptedError(forKey: .limit, in: c, debugDescription: "Limit is not finite")
        }
        currency = try c.decode(CurrencyCode.self, forKey: .currency)
    }
}

/// Computed monthly state of a budget, all amounts in the budget's own currency.
struct BudgetStatus {
    var spent: Double
    var limit: Double
    var remaining: Double { max(0, limit - spent) }
    var fraction: Double { limit > 0 ? spent / limit : 0 }
    var isOver: Bool { spent > limit }
}

// MARK: - Goal

struct Goal: Identifiable, Codable, Hashable {
    var id = UUID()
    var name: String
    var icon: String = "star.fill"
    var target: Double
    var saved: Double = 0
    var currency: CurrencyCode
    var deadline: Date?

    var fraction: Double { target > 0 ? min(1, max(0, saved / target)) : 0 }
    var isComplete: Bool { saved >= target && target > 0 }
    var remaining: Double { max(0, target - saved) }

    init(id: UUID = UUID(), name: String, icon: String = "star.fill", target: Double, saved: Double = 0, currency: CurrencyCode, deadline: Date? = nil) {
        self.id = id
        self.name = name
        self.icon = icon
        self.target = target
        self.saved = saved
        self.currency = currency
        self.deadline = deadline
    }

    private enum CodingKeys: String, CodingKey { case id, name, icon, target, saved, currency, deadline }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try c.decode(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon) ?? "star.fill"
        target = try c.decode(Double.self, forKey: .target)
        saved = try c.decodeIfPresent(Double.self, forKey: .saved) ?? 0
        guard target.isFinite, saved.isFinite else {
            throw DecodingError.dataCorruptedError(forKey: .target, in: c, debugDescription: "Goal amounts are not finite")
        }
        currency = try c.decode(CurrencyCode.self, forKey: .currency)
        deadline = try c.decodeIfPresent(Date.self, forKey: .deadline)
    }
}

// MARK: - Date helpers

extension Date {
    var startOfDay: Date { Calendar.current.startOfDay(for: self) }

    var startOfMonth: Date {
        let comps = Calendar.current.dateComponents([.year, .month], from: self)
        return Calendar.current.date(from: comps) ?? self
    }

    func isSameDay(as other: Date) -> Bool {
        Calendar.current.isDate(self, inSameDayAs: other)
    }

    func isSameMonth(as other: Date) -> Bool {
        let cal = Calendar.current
        return cal.component(.month, from: self) == cal.component(.month, from: other)
            && cal.component(.year, from: self) == cal.component(.year, from: other)
    }
}
