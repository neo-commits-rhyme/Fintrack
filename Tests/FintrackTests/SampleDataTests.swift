import Testing
import Foundation
@testable import Fintrack

@Suite("Sample data bundle")
@MainActor
struct SampleDataTests {

    /// A UUID-free, date-free fingerprint of a transaction, with account links
    /// resolved to names so two bundles can be compared.
    private func fingerprint(_ t: Transaction, accounts: [Account]) -> String {
        func name(_ id: UUID?) -> String { accounts.first { $0.id == id }?.name ?? "-" }
        return "\(t.title)|\(t.amount)|\(t.currency)|\(t.category)|\(t.kind)|\(t.note)|\(name(t.accountID))|\(name(t.fromAccountID))|\(name(t.toAccountID))"
    }

    @Test func bundleIsDeterministic() {
        let a = SampleData.bundle()
        let b = SampleData.bundle()
        #expect(a.accounts.map(\.name) == b.accounts.map(\.name))
        #expect(a.accounts.map(\.openingBalance) == b.accounts.map(\.openingBalance))
        #expect(a.transactions.map { fingerprint($0, accounts: a.accounts) }
                == b.transactions.map { fingerprint($0, accounts: b.accounts) })
        #expect(a.budgets.map(\.category) == b.budgets.map(\.category))
        #expect(a.budgets.map(\.limit) == b.budgets.map(\.limit))
        #expect(a.goals.map(\.name) == b.goals.map(\.name))
        #expect(a.goals.map(\.saved) == b.goals.map(\.saved))
    }

    @Test func idsAreUnique() {
        let b = SampleData.bundle()
        #expect(Set(b.transactions.map(\.id)).count == b.transactions.count)
        #expect(Set(b.accounts.map(\.id)).count == b.accounts.count)
        #expect(Set(b.accounts.map(\.name)).count == b.accounts.count)
        #expect(Set(b.budgets.map(\.category)).count == b.budgets.count)
    }

    @Test func everyTransactionLinksToAnExistingAccount() {
        let b = SampleData.bundle()
        let ids = Set(b.accounts.map(\.id))
        #expect(!b.transactions.isEmpty)
        for t in b.transactions {
            switch t.kind {
            case .income, .expense:
                #expect(t.accountID.map(ids.contains) == true, "\(t.title) unlinked")
                #expect(t.fromAccountID == nil && t.toAccountID == nil)
            case .transfer:
                #expect(t.fromAccountID.map(ids.contains) == true, "\(t.title) missing source")
                #expect(t.toAccountID.map(ids.contains) == true, "\(t.title) missing destination")
                #expect(t.fromAccountID != t.toAccountID)
                #expect(t.accountID == nil)
            }
        }
    }

    @Test func debtPaymentsGoIntoTheDebtAccount() {
        let b = SampleData.bundle()
        let debtIDs = Set(b.accounts.filter { $0.kind == .debt }.map(\.id))
        #expect(!debtIDs.isEmpty)
        let payments = b.transactions.filter(\.isDebtPayment)
        #expect(payments.count == 3)
        #expect(payments.allSatisfy { $0.toAccountID.map(debtIDs.contains) == true })
        #expect(b.accounts.filter { $0.kind == .debt }.allSatisfy { $0.openingBalance < 0 })
        #expect(b.accounts.contains { !$0.includeInTotal })
    }

    @Test
    func noTransactionIsInTheFuture() {
        let now = Date()
        let b = SampleData.bundle()
        let future = b.transactions.filter { $0.date > now }
        #expect(future.isEmpty, "future-dated: \(future.map { "\($0.title) @ \($0.date)" })")
    }

    @Test func noTransactionIsAfterToday() {
        let endOfToday = Calendar.current.date(byAdding: .day, value: 1, to: Date().startOfDay)!
        #expect(SampleData.bundle().transactions.allSatisfy { $0.date < endOfToday })
    }

    @Test func coversRoughlyThreeMonths() {
        let b = SampleData.bundle()
        let oldest = b.transactions.map(\.date).min()!
        let days = Calendar.current.dateComponents([.day], from: oldest.startOfDay, to: Date().startOfDay).day!
        #expect((80...93).contains(days))
    }

    @Test func sortedNewestFirst() {
        let ts = SampleData.bundle().transactions
        #expect(zip(ts, ts.dropFirst()).allSatisfy { $0.date >= $1.date })
    }

    @Test func amountsArePositive() {
        let b = SampleData.bundle()
        #expect(b.transactions.allSatisfy { $0.amount > 0 && $0.amount.isFinite })
        #expect(b.budgets.allSatisfy { $0.limit > 0 })
        #expect(b.goals.allSatisfy { $0.target > 0 && $0.saved >= 0 })
    }

    @Test func resetToSampleDataKeepsDisplayCurrencyAndRates() {
        let store = makeTempStore()
        store.displayCurrency = .usd
        store.setRate(13_000, for: .usd)
        store.resetToSampleData()
        #expect(store.displayCurrency == .usd)
        #expect(store.rates[.usd] == 13_000)
        #expect(store.accounts.map(\.name) == ["Car loan", "Cash", "Humo card", "Savings", "Visa USD"])
        #expect(!store.transactions.isEmpty)
    }
}
