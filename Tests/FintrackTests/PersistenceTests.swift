import Testing
import Foundation
@testable import Fintrack

@Suite("JSON persistence and legacy migration")
@MainActor
struct PersistenceTests {

    private func write(_ json: String, to url: URL) throws {
        try Data(json.utf8).write(to: url)
    }

    private func jsonObject(at url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func backups(nextTo url: URL) -> [URL] {
        let dir = url.deletingLastPathComponent()
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return names
            .filter { $0.hasPrefix("fintrack-unreadable-") && $0.hasSuffix(".json") }
            .map { dir.appendingPathComponent($0) }
    }

    // MARK: First launch

    @Test func firstLaunchWritesAnEmptyFile() throws {
        let url = makeTempDataURL()
        #expect(!FileManager.default.fileExists(atPath: url.path))
        let store = AppStore(dataURL: url)
        #expect(FileManager.default.fileExists(atPath: url.path))
        #expect(store.saveError == nil)
        let obj = try jsonObject(at: url)
        #expect((obj["transactions"] as? [Any])?.isEmpty == true)
        #expect(obj["displayCurrency"] as? String == "UZS")
    }

    @Test func saveErrorIsReportedWhenDirectoryIsMissing() {
        let url = makeTempDataURL()
            .deletingLastPathComponent()
            .appendingPathComponent("does-not-exist", isDirectory: true)
            .appendingPathComponent("fintrack.json")
        let store = AppStore(dataURL: url)
        #expect(store.saveError != nil)
        store.clearSaveError()
        #expect(store.saveError == nil)
    }

    // MARK: Round trips

    @Test func everyEntityRoundTrips() throws {
        let url = makeTempDataURL()
        let now = wholeSecondNow()
        let cash = Account(name: "Cash", icon: "banknote.fill", currency: .uzs, openingBalance: 400_000)
        let loan = Account(name: "Loan", currency: .usd, openingBalance: -1_000, kind: .debt, includeInTotal: false)
        let t1 = Transaction(title: "Salary", amount: 14_500_000, currency: .uzs, category: .salary, kind: .income,
                             date: now, note: "Nov", accountID: cash.id)
        let t2 = Transaction(title: "Pay loan", amount: 12.34, currency: .usd, category: .debtPayment, kind: .transfer,
                             date: now.addingTimeInterval(-86_400), fromAccountID: cash.id, toAccountID: loan.id,
                             fromAccount: "Cash", toAccount: "Loan")
        let budget = Budget(category: .groceries, limit: 3_500_000, currency: .uzs)
        let goal = Goal(name: "Mac", icon: "laptopcomputer", target: 2_400, saved: 1_150.5, currency: .usd,
                        deadline: now.addingTimeInterval(86_400 * 30))
        do {
            let store = AppStore(dataURL: url)
            store.addAccount(cash); store.addAccount(loan)
            store.addTransaction(t1); store.addTransaction(t2)
            store.addBudget(budget)
            store.addGoal(goal)
            store.displayCurrency = .eur
            store.setRate(12_345.67, for: .usd)
            #expect(store.saveError == nil)
        }
        let r = AppStore(dataURL: url)
        #expect(r.accounts == [cash, loan])
        #expect(r.transactions == [t1, t2])
        #expect(r.budgets == [budget])
        #expect(r.goals == [goal])
        #expect(r.displayCurrency == .eur)
        #expect(r.rates[.usd] == 12_345.67)
        #expect(r.rates[.uzs] == 1)
    }

    @Test func updatesAndDeletesPersist() {
        let url = makeTempDataURL()
        let now = wholeSecondNow()
        var a = Account(name: "A", currency: .uzs)
        let b = Account(name: "B", currency: .uzs)
        var t = tx(.expense, 10, date: now, account: a.id)
        let t2 = tx(.income, 20, date: now)
        var budget = Budget(category: .health, limit: 1, currency: .uzs)
        var goal = Goal(name: "G", target: 10, currency: .usd)
        do {
            let s = AppStore(dataURL: url)
            s.addAccount(a); s.addAccount(b)
            s.addTransaction(t); s.addTransaction(t2)
            s.addBudget(budget); s.addGoal(goal)
        }
        a.name = "A2"; t.amount = 99; budget.limit = 2; goal.saved = 5
        do {
            let s = AppStore(dataURL: url)
            s.updateAccount(a); s.updateTransaction(t); s.updateBudget(budget); s.updateGoal(goal)
            s.addFunds(toGoal: goal.id, amount: 1, currency: .usd)
        }
        goal.saved = 6
        do {
            let s = AppStore(dataURL: url)
            #expect(s.accounts.first { $0.id == a.id } == a)
            #expect(s.transactions.first { $0.id == t.id } == t)
            #expect(s.budgets == [budget])
            #expect(s.goals == [goal])
            s.deleteAccount(id: b.id)
            s.deleteTransaction(id: t2.id)
            s.deleteBudget(id: budget.id)
            s.deleteGoal(id: goal.id)
        }
        let s = AppStore(dataURL: url)
        #expect(s.accounts == [a])
        #expect(s.transactions == [t])
        #expect(s.budgets.isEmpty)
        #expect(s.goals.isEmpty)
    }

    @Test func seededStoreRoundTripsExceptSubSecondDates() {
        let url = makeTempDataURL()
        let original: AppStore = {
            let s = AppStore(dataURL: url)
            s.resetToSampleData()
            return s
        }()
        let r = AppStore(dataURL: url)
        #expect(r.accounts == original.accounts)
        #expect(r.transactions.map(\.id) == original.transactions.map(\.id))
        #expect(r.budgets == original.budgets)
        #expect(r.goals.map(\.id) == original.goals.map(\.id))
        #expect(approx(r.balance, original.balance, tolerance: 1e-12))
    }

    @Test
    func subSecondDatesSurviveRoundTrip() {
        let url = makeTempDataURL()
        let date = Date(timeIntervalSince1970: 1_790_000_000.75)
        let t = tx(.expense, 1, date: date)
        do { AppStore(dataURL: url).addTransaction(t) }
        let r = AppStore(dataURL: url)
        #expect(r.transactions.first?.date == date)
        #expect(r.transactions.first == t)
    }

    // MARK: JSON shape

    @Test func jsonShape() throws {
        let url = makeTempDataURL()
        let store = AppStore(dataURL: url)
        let date = Date(timeIntervalSince1970: 1_790_000_000)
        store.addTransaction(tx(.expense, 1, date: date))
        let obj = try jsonObject(at: url)
        let rates = try #require(obj["rates"] as? [String: Any], "rates must be a string-keyed object")
        #expect(Set(rates.keys) == Set(CurrencyCode.allCases.map(\.rawValue)))
        #expect((rates["USD"] as? NSNumber)?.doubleValue == 12_110)
        #expect((rates["UZS"] as? NSNumber)?.doubleValue == 1)
        let txs = try #require(obj["transactions"] as? [[String: Any]])
        let dateString = try #require(txs.first?["date"] as? String)
        // Dates carry fractional seconds so sub-second order survives a round trip.
        #expect(dateString == "2026-09-21T14:13:20.000Z")
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        #expect(fractional.date(from: dateString) == date)
        #expect(obj["accounts"] is [Any])
        #expect(obj["budgets"] is [Any])
        #expect(obj["goals"] is [Any])
        #expect(obj["displayCurrency"] as? String == "UZS")
    }

    // MARK: Legacy layouts

    @Test func legacyEnumKeyedRatesFlatArray() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [
            {"id": "11111111-1111-1111-1111-111111111111", "title": "Coffee", "amount": 30000,
             "currency": "UZS", "category": "eatingOut", "kind": "expense",
             "date": "2025-01-10T09:00:00Z", "note": ""},
            {"id": "22222222-2222-2222-2222-222222222222", "title": "Salary", "amount": 1000,
             "currency": "USD", "category": "salary", "kind": "income",
             "date": "2025-01-11T09:00:00Z", "note": "Jan"}
          ],
          "budgets": [{"id": "33333333-3333-3333-3333-333333333333", "category": "groceries", "limit": 100, "currency": "UZS"}],
          "goals": [{"id": "44444444-4444-4444-4444-444444444444", "name": "Car", "icon": "car.fill",
                     "target": 5000, "saved": 10, "currency": "USD"}],
          "displayCurrency": "USD",
          "rates": ["USD", 12000, "UZS", 1, "EUR", 0, "RUB", -3]
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        #expect(s.transactions.count == 2)
        #expect(s.transactions.map(\.title) == ["Salary", "Coffee"])  // newest first
        #expect(s.budgets.count == 1)
        #expect(s.goals.first?.name == "Car")
        #expect(s.goals.first?.deadline == nil)
        #expect(s.displayCurrency == .usd)
        #expect(s.accounts.isEmpty)
        #expect(s.rates[.usd] == 12_000)
        #expect(s.rates[.eur] == CurrencyCode.defaultRates[.eur])   // zero → default
        #expect(s.rates[.rub] == CurrencyCode.defaultRates[.rub])   // negative → default
        #expect(s.rates[.jpy] == CurrencyCode.defaultRates[.jpy])   // missing → default
        #expect(s.rates[.uzs] == 1)
        #expect(backups(nextTo: url).isEmpty)

        // After the next save the file is in the current string-keyed layout.
        s.addBudget(Budget(category: .health, limit: 1, currency: .uzs))
        let obj = try jsonObject(at: url)
        #expect(obj["rates"] is [String: Any])
    }

    @Test func legacyAccountsAsPlainStrings() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [],
          "budgets": [],
          "goals": [],
          "displayCurrency": "RUB",
          "rates": {"USD": 12500, "RUB": 150},
          "accounts": ["Humo card", "Cash"]
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        #expect(s.accounts.map(\.name) == ["Cash", "Humo card"])
        #expect(s.accounts.allSatisfy { $0.currency == .rub && $0.openingBalance == 0 && $0.kind == .regular && $0.includeInTotal })
        #expect(s.rates[.usd] == 12_500)
        #expect(s.rates[.rub] == 150)
        #expect(s.rates[.eur] == CurrencyCode.defaultRates[.eur])
        #expect(backups(nextTo: url).isEmpty)
    }

    @Test func legacyTransferNamesCreateAndLinkAccounts() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [
            {"id": "11111111-1111-1111-1111-111111111111", "title": "Top-up", "amount": 50000,
             "currency": "UZS", "category": "transfer", "kind": "transfer",
             "date": "2025-01-10T09:00:00Z", "note": "", "fromAccount": "Cash", "toAccount": "Humo card"},
            {"id": "22222222-2222-2222-2222-222222222222", "title": "Back", "amount": 10000,
             "currency": "UZS", "category": "transfer", "kind": "transfer",
             "date": "2025-01-11T09:00:00Z", "note": "", "fromAccount": "humo CARD", "toAccount": "cash"},
            {"id": "33333333-3333-3333-3333-333333333333", "title": "Visa", "amount": 5,
             "currency": "USD", "category": "transfer", "kind": "transfer",
             "date": "2025-01-12T09:00:00Z", "note": "", "fromAccount": "Cash", "toAccount": "Visa"},
            {"id": "44444444-4444-4444-4444-444444444444", "title": "Unnamed", "amount": 1,
             "currency": "UZS", "category": "transfer", "kind": "transfer",
             "date": "2025-01-13T09:00:00Z", "note": "", "fromAccount": "", "toAccount": null}
          ],
          "budgets": [], "goals": [],
          "displayCurrency": "UZS",
          "rates": ["USD", 12110]
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        // One account per case-insensitive name. (Which spelling wins depends on
        // migration order — newest transfer first — so compare lowercased.)
        #expect(s.accounts.map { $0.name.lowercased() } == ["cash", "humo card", "visa"])
        #expect(s.accounts.allSatisfy { $0.currency == .uzs && $0.openingBalance == 0 })
        let byName = Dictionary(uniqueKeysWithValues: s.accounts.map { ($0.name.lowercased(), $0.id) })
        let top = try #require(s.transactions.first { $0.title == "Top-up" })
        #expect(top.fromAccountID == byName["cash"] && top.toAccountID == byName["humo card"])
        let back = try #require(s.transactions.first { $0.title == "Back" })
        #expect(back.fromAccountID == byName["humo card"] && back.toAccountID == byName["cash"])
        let unnamed = try #require(s.transactions.first { $0.title == "Unnamed" })
        #expect(unnamed.fromAccountID == nil && unnamed.toAccountID == nil)
        let cash = try #require(s.account(byName["cash"]))
        #expect(s.balance(of: cash) == -50_000 + 10_000 - 5 * 12_110)
        // Transfers between own accounts are net zero.
        #expect(approx(s.balance, 0))
    }

    @Test func legacyTransferNamesReuseStringAccounts() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [
            {"id": "11111111-1111-1111-1111-111111111111", "title": "Top-up", "amount": 50000,
             "currency": "UZS", "category": "transfer", "kind": "transfer",
             "date": "2025-01-10T09:00:00Z", "note": "", "fromAccount": "CASH", "toAccount": "Savings"}
          ],
          "budgets": [], "goals": [],
          "displayCurrency": "UZS",
          "rates": {"USD": 12110},
          "accounts": ["Cash"]
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        #expect(s.accounts.map(\.name) == ["Cash", "Savings"])
        #expect(s.transactions[0].fromAccountID == s.accounts[0].id)
        #expect(s.transactions[0].toAccountID == s.accounts[1].id)
    }

    @Test func accountsWithoutNewerFieldsDecodeWithDefaults() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [], "budgets": [], "goals": [],
          "displayCurrency": "UZS",
          "rates": {"USD": 12110},
          "accounts": [{"id": "55555555-5555-5555-5555-555555555555", "name": "Old", "currency": "USD"}]
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        let a = try #require(s.accounts.first)
        #expect(a.name == "Old")
        #expect(a.kind == .regular && a.includeInTotal && a.openingBalance == 0 && a.icon == "creditcard.fill")
    }

    @Test func invalidRatesInCurrentLayoutFallBackToDefaults() throws {
        let url = makeTempDataURL()
        try write("""
        {
          "transactions": [], "budgets": [], "goals": [], "accounts": [],
          "displayCurrency": "UZS",
          "rates": {"USD": 0, "EUR": -14150, "GBP": 17000, "UZS": 7, "XXX": 5}
        }
        """, to: url)
        let s = AppStore(dataURL: url)
        #expect(s.rates[.usd] == 12_110)
        #expect(s.rates[.eur] == 14_150)
        #expect(s.rates[.gbp] == 17_000)
        #expect(s.rates[.uzs] == 1)
        #expect(s.rates[.jpy] == 82)
        #expect(s.rates.count == CurrencyCode.allCases.count)
    }

    // MARK: Unreadable files

    @Test func unreadableFileIsBackedUpAndNotOverwritten() throws {
        let url = makeTempDataURL()
        let garbage = Data("{ this is not json ".utf8)
        try garbage.write(to: url)
        let s = AppStore(dataURL: url)
        #expect(s.transactions.isEmpty && s.accounts.isEmpty)
        #expect(s.rates == CurrencyCode.defaultRates)
        let found = backups(nextTo: url)
        #expect(found.count == 1)
        if let backup = found.first {
            #expect(try Data(contentsOf: backup) == garbage)
        }
        // The original file is untouched by loading.
        #expect(try Data(contentsOf: url) == garbage)
    }

    @Test func wellFormedButIncompatibleJSONIsBackedUp() throws {
        let url = makeTempDataURL()
        let json = Data(#"{"transactions": "nope", "displayCurrency": "XYZ"}"#.utf8)
        try json.write(to: url)
        _ = AppStore(dataURL: url)
        #expect(backups(nextTo: url).count == 1)
        #expect(try Data(contentsOf: url) == json)
    }

    @Test
    func fileThatExistsButCannotBeReadIsNeverReplaced() throws {
        let url = makeTempDataURL()
        let original = Data(#"{"transactions": [], "budgets": [], "goals": [], "displayCurrency": "USD", "rates": {"USD": 1}}"#.utf8)
        try original.write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: url.path)
        _ = AppStore(dataURL: url)
        try? FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
        let after = try Data(contentsOf: url)
        #expect(after == original || !backups(nextTo: url).isEmpty,
                "existing data file was replaced without a backup")
    }

    // MARK: Deleted accounts

    @Test
    func deletedAccountStaysDeletedAfterRelaunch() {
        let url = makeTempDataURL()
        let cash = Account(name: "Cash", currency: .uzs, openingBalance: 100)
        let card = Account(name: "Card", currency: .uzs)
        do {
            let s = AppStore(dataURL: url)
            s.addAccount(cash); s.addAccount(card)
            // Exactly how TransactionsView / PayDebtSheet build transfers: IDs + names.
            s.addTransaction(Transaction(title: "Top-up", amount: 50, currency: .uzs, category: .transfer,
                                         kind: .transfer, date: wholeSecondNow(),
                                         fromAccountID: cash.id, toAccountID: card.id,
                                         fromAccount: "Cash", toAccount: "Card"))
            s.deleteAccount(id: cash.id)
            #expect(s.accounts.map(\.name) == ["Card"])
        }
        let r = AppStore(dataURL: url)
        #expect(r.accounts.map(\.name) == ["Card"], "deleted account came back: \(r.accounts.map(\.name))")
        #expect(r.transactions.first?.fromAccountID == nil)
    }
}
