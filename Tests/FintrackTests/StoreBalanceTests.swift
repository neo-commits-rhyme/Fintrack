import Testing
import Foundation
@testable import Fintrack

@Suite("Account balances and headline totals")
@MainActor
struct StoreBalanceTests {

    // MARK: balance(of:)

    @Test func openingBalanceOnly() {
        let store = makeTempStore()
        let a = Account(name: "Cash", currency: .uzs, openingBalance: 400_000)
        store.addAccount(a)
        #expect(store.balance(of: a) == 400_000)
    }

    @Test func incomeAndExpenseSameCurrency() {
        let store = makeTempStore()
        let a = Account(name: "Cash", currency: .uzs, openingBalance: 1_000)
        store.addAccount(a)
        store.addTransaction(tx(.income, 500, account: a.id))
        store.addTransaction(tx(.expense, 200, account: a.id))
        #expect(store.balance(of: a) == 1_300)
    }

    @Test func incomeAndExpenseOtherCurrencyAreConverted() {
        let store = makeTempStore()
        let usd = Account(name: "Visa", currency: .usd, openingBalance: 10)
        store.addAccount(usd)
        // 121 100 UZS = 10 USD at the default 12 110 rate.
        store.addTransaction(tx(.income, 121_100, .uzs, account: usd.id))
        store.addTransaction(tx(.expense, 14_150, .uzs, account: usd.id)) // ≈ 1.1685 USD
        #expect(approx(store.balance(of: usd), 10 + 10 - 14_150.0 / 12_110))
    }

    @Test func unlinkedAndForeignTransactionsDoNotTouchAccount() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs)
        let b = Account(name: "B", currency: .uzs)
        store.addAccount(a); store.addAccount(b)
        store.addTransaction(tx(.income, 500, account: b.id))
        store.addTransaction(tx(.expense, 70)) // unlinked
        #expect(store.balance(of: a) == 0)
        #expect(store.balance(of: b) == 500)
    }

    @Test func transferMovesMoneyBetweenAccounts() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs, openingBalance: 1_000)
        let b = Account(name: "B", currency: .uzs, openingBalance: 0)
        store.addAccount(a); store.addAccount(b)
        store.addTransaction(tx(.transfer, 300, from: a.id, to: b.id))
        #expect(store.balance(of: a) == 700)
        #expect(store.balance(of: b) == 300)
        // Net zero for the headline.
        #expect(store.balance == 1_000)
    }

    @Test func transferAcrossCurrenciesConvertsEachSide() {
        let store = makeTempStore()
        let uzs = Account(name: "Humo", currency: .uzs, openingBalance: 1_000_000)
        let usd = Account(name: "Visa", currency: .usd, openingBalance: 0)
        store.addAccount(uzs); store.addAccount(usd)
        store.addTransaction(tx(.transfer, 50, .usd, from: uzs.id, to: usd.id))
        #expect(store.balance(of: usd) == 50)
        #expect(store.balance(of: uzs) == 1_000_000 - 50 * 12_110)
        #expect(approx(store.balance, 1_000_000))
    }

    @Test func transferToSelfIsNetZero() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs, openingBalance: 10)
        store.addAccount(a)
        store.addTransaction(tx(.transfer, 5, from: a.id, to: a.id))
        #expect(store.balance(of: a) == 10)
    }

    @Test func debtAccountHasNegativeBalanceAndPullsTotalDown() {
        let store = makeTempStore()
        let cash = Account(name: "Cash", currency: .uzs, openingBalance: 2_000_000)
        let loan = Account(name: "Car loan", currency: .uzs, openingBalance: -5_000_000, kind: .debt)
        store.addAccount(cash); store.addAccount(loan)
        #expect(store.balance(of: loan) == -5_000_000)
        #expect(store.totalAccountsBalance == -3_000_000)
        #expect(store.balance == -3_000_000)
    }

    @Test func debtPaymentPaysDownDebt() {
        let store = makeTempStore()
        let card = Account(name: "Card", currency: .uzs, openingBalance: 3_000_000)
        let loan = Account(name: "Loan", currency: .uzs, openingBalance: -5_000_000, kind: .debt)
        store.addAccount(card); store.addAccount(loan)
        store.addTransaction(tx(.transfer, 1_000_000, category: .debtPayment, from: card.id, to: loan.id))
        #expect(store.balance(of: card) == 2_000_000)
        #expect(store.balance(of: loan) == -4_000_000)
        // Net worth unchanged by paying a debt from own money.
        #expect(store.balance == -2_000_000)
    }

    @Test func debtPaymentInForeignCurrencyIsConvertedIntoDebtCurrency() {
        let store = makeTempStore()
        let visa = Account(name: "Visa", currency: .usd, openingBalance: 100)
        let loan = Account(name: "Loan", currency: .uzs, openingBalance: -1_000_000, kind: .debt)
        store.addAccount(visa); store.addAccount(loan)
        store.addTransaction(tx(.transfer, 10, .usd, category: .debtPayment, from: visa.id, to: loan.id))
        #expect(store.balance(of: visa) == 90)
        #expect(store.balance(of: loan) == -1_000_000 + 121_100)
    }

    @Test func loanReceivedDeepensDebtAndFundsAccount() {
        let store = makeTempStore()
        let card = Account(name: "Card", currency: .uzs, openingBalance: 0)
        let loan = Account(name: "Loan", currency: .uzs, openingBalance: -1_000, kind: .debt)
        store.addAccount(card); store.addAccount(loan)
        store.addTransaction(tx(.transfer, 500, category: .loanReceived, from: loan.id, to: card.id))
        #expect(store.balance(of: loan) == -1_500)
        #expect(store.balance(of: card) == 500)
        #expect(store.balance == -1_000)
        #expect(store.monthIncome == 0)
        #expect(store.monthExpense == 0)
    }

    @Test func deletingAccountUnlinksButKeepsTransactions() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs, openingBalance: 100)
        let b = Account(name: "B", currency: .uzs, openingBalance: 0)
        store.addAccount(a); store.addAccount(b)
        let inc = tx(.income, 50, account: a.id)
        let tr = tx(.transfer, 30, from: a.id, to: b.id)
        let tr2 = tx(.transfer, 10, from: b.id, to: a.id)
        store.addTransaction(inc); store.addTransaction(tr); store.addTransaction(tr2)

        store.deleteAccount(id: a.id)

        #expect(store.accounts.map(\.id) == [b.id])
        #expect(store.transactions.count == 3)
        #expect(store.transactions.allSatisfy { $0.accountID != a.id && $0.fromAccountID != a.id && $0.toAccountID != a.id })
        #expect(store.transactions.first { $0.id == tr.id }?.toAccountID == b.id)
        #expect(store.transactions.first { $0.id == tr2.id }?.fromAccountID == b.id)
        // B keeps its side of both transfers.
        #expect(store.balance(of: b) == 20)
        // The income is now unlinked and still counted in the headline.
        #expect(store.balance == 20 + 50)
    }

    @Test func accountLookup() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs)
        store.addAccount(a)
        #expect(store.account(a.id) == a)
        #expect(store.account(nil) == nil)
        #expect(store.account(UUID()) == nil)
    }

    @Test func accountsStaySortedByNameCaseInsensitively() {
        let store = makeTempStore()
        store.addAccount(Account(name: "visa", currency: .usd))
        store.addAccount(Account(name: "Cash", currency: .uzs))
        store.addAccount(Account(name: "humo", currency: .uzs))
        #expect(store.accounts.map(\.name) == ["Cash", "humo", "visa"])
        var renamed = store.accounts[0]
        renamed.name = "Zebra"
        store.updateAccount(renamed)
        #expect(store.accounts.map(\.name) == ["humo", "visa", "Zebra"])
    }

    @Test func createAccountTrimsAndDeduplicatesCaseInsensitively() {
        let store = makeTempStore()
        let first = store.createAccount(named: "  Cash \n", currency: .uzs)
        #expect(first.name == "Cash")
        let again = store.createAccount(named: "cash", currency: .usd, kind: .debt)
        #expect(again.id == first.id)
        #expect(again.currency == .uzs)
        #expect(store.accounts.count == 1)
        let debt = store.createAccount(named: "Loan", currency: .usd, kind: .debt)
        #expect(debt.kind == .debt && debt.currency == .usd)
        #expect(store.accounts.count == 2)
    }

    // MARK: headline balance / totals

    @Test func fallbackLedgerWhenNoAccounts() {
        let store = makeTempStore()
        store.addTransaction(tx(.income, 1_000))
        store.addTransaction(tx(.expense, 300))
        store.addTransaction(tx(.income, 1, .usd))
        store.addTransaction(tx(.transfer, 99_999))
        let expectedLedger: Double = 1_000 - 300 + 12_110
        #expect(store.balance == expectedLedger)
        let split = store.balancesByCurrency
        #expect(split.count == 2)
        #expect(split[0].currency == .uzs && split[0].amount == 700)
        #expect(split[1].currency == .usd && split[1].amount == 1)
    }

    @Test func emptyStoreBalances() {
        let store = makeTempStore()
        #expect(store.balance == 0)
        #expect(store.totalAccountsBalance == 0)
        let split = store.balancesByCurrency
        #expect(split.count == 1)
        #expect(split[0].currency == .uzs && split[0].amount == 0)
    }

    @Test func includeInTotalOffIsSkipped() {
        let store = makeTempStore()
        let main = Account(name: "Main", currency: .uzs, openingBalance: 1_000)
        let hidden = Account(name: "Savings", currency: .uzs, openingBalance: 9_000, includeInTotal: false)
        store.addAccount(main); store.addAccount(hidden)
        store.addTransaction(tx(.income, 500, account: hidden.id))
        #expect(store.balance(of: hidden) == 9_500)
        #expect(store.totalAccountsBalance == 1_000)
        #expect(store.balance == 1_000)
        #expect(store.balancesByCurrency.map(\.amount) == [1_000])
    }

    @Test func transferFromExcludedAccountRaisesTotal() {
        let store = makeTempStore()
        let main = Account(name: "Main", currency: .uzs)
        let hidden = Account(name: "Savings", currency: .uzs, openingBalance: 9_000, includeInTotal: false)
        store.addAccount(main); store.addAccount(hidden)
        store.addTransaction(tx(.transfer, 2_000, from: hidden.id, to: main.id))
        #expect(store.balance == 2_000)
    }

    @Test func unlinkedTransactionsAreAddedWhenAccountsExist() {
        let store = makeTempStore()
        let a = Account(name: "A", currency: .uzs, openingBalance: 1_000)
        store.addAccount(a)
        store.addTransaction(tx(.expense, 200))           // unlinked UZS
        store.addTransaction(tx(.income, 3, .usd))        // unlinked USD
        store.addTransaction(tx(.transfer, 777))          // unlinked transfer: ignored
        #expect(store.totalAccountsBalance == 1_000)
        let expected: Double = 1_000 - 200 + 3 * 12_110
        #expect(store.balance == expected)
        let split = store.balancesByCurrency
        #expect(split.count == 2)
        #expect(split[0].currency == .uzs && split[0].amount == 800)
        #expect(split[1].currency == .usd && split[1].amount == 3)
    }

    @Test func totalsConvertIntoDisplayCurrency() {
        let store = makeTempStore()
        store.addAccount(Account(name: "Visa", currency: .usd, openingBalance: 10))
        store.addAccount(Account(name: "Humo", currency: .uzs, openingBalance: 121_100))
        store.displayCurrency = .usd
        #expect(approx(store.totalAccountsBalance, 20))
        #expect(approx(store.balance, 20))
    }

    @Test func balancesByCurrencyPutsDisplayCurrencyFirstThenBySize() {
        let store = makeTempStore()
        store.addAccount(Account(name: "Humo", currency: .uzs, openingBalance: 1_000))   // tiny
        store.addAccount(Account(name: "Visa", currency: .usd, openingBalance: 10))     // 121 100 UZS
        store.addAccount(Account(name: "EUR", currency: .eur, openingBalance: 100))     // 1 415 000 UZS
        store.addAccount(Account(name: "Loan", currency: .gbp, openingBalance: -1_000, kind: .debt)) // −16.3M UZS
        let split = store.balancesByCurrency
        #expect(split.map(\.currency) == [.uzs, .gbp, .eur, .usd])

        store.displayCurrency = .usd
        #expect(store.balancesByCurrency.map(\.currency) == [.usd, .gbp, .eur, .uzs])
    }

    @Test func balancesByCurrencyDropsZeroBalances() {
        let store = makeTempStore()
        let usd = Account(name: "Visa", currency: .usd, openingBalance: 10)
        store.addAccount(usd)
        store.addAccount(Account(name: "Humo", currency: .uzs, openingBalance: 500))
        store.addTransaction(tx(.expense, 10, .usd, account: usd.id))
        store.addTransaction(tx(.expense, 0.001, .eur))   // below the 0.005 cut-off
        #expect(store.balancesByCurrency.map(\.currency) == [.uzs])
    }

    @Test func balancesByCurrencySumMatchesHeadline() {
        let store = makeTempStore(seed: true)
        let summed = store.balancesByCurrency.reduce(0) { $0 + store.inDisplay($1.amount, from: $1.currency) }
        #expect(approx(summed, store.balance, tolerance: 1e-9))
        store.displayCurrency = .eur
        let summedEUR = store.balancesByCurrency.reduce(0) { $0 + store.inDisplay($1.amount, from: $1.currency) }
        #expect(approx(summedEUR, store.balance, tolerance: 1e-9))
    }

    @Test func balanceSplitTextJoinsPerCurrency() {
        let store = makeTempStore()
        store.addAccount(Account(name: "Humo", currency: .uzs, openingBalance: 34_456_990))
        store.addAccount(Account(name: "Visa", currency: .usd, openingBalance: 560))
        #expect(store.balanceSplitText == "34\u{00A0}456\u{00A0}990\u{00A0}soʻm  |  $560")
    }

    @Test func eraseAllClearsEverything() {
        let store = makeTempStore(seed: true)
        store.eraseAll()
        #expect(store.accounts.isEmpty && store.transactions.isEmpty && store.budgets.isEmpty && store.goals.isEmpty)
        #expect(store.balance == 0)
    }

    @Test func transactionsStaySortedNewestFirst() {
        let store = makeTempStore()
        let now = Date()
        let old = tx(.expense, 1, date: now.addingTimeInterval(-3_600))
        let mid = tx(.expense, 2, date: now.addingTimeInterval(-60))
        let new = tx(.expense, 3, date: now)
        store.addTransaction(mid); store.addTransaction(old); store.addTransaction(new)
        #expect(store.transactions.map(\.id) == [new.id, mid.id, old.id])
        var moved = old
        moved.date = now.addingTimeInterval(60)
        store.updateTransaction(moved)
        #expect(store.transactions.map(\.id) == [old.id, new.id, mid.id])
        store.deleteTransactions(ids: [new.id, mid.id])
        #expect(store.transactions.map(\.id) == [old.id])
        store.deleteTransaction(id: old.id)
        #expect(store.transactions.isEmpty)
    }

    @Test func updatingUnknownTransactionIsNoOp() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 1))
        store.updateTransaction(tx(.expense, 999))
        #expect(store.transactions.count == 1)
        #expect(store.transactions[0].amount == 1)
    }
}
