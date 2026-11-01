import Testing
import Foundation
@testable import Fintrack

@Suite("Monthly analytics and daily series")
@MainActor
struct AnalyticsTests {

    /// Today is used for "this month" so the tests hold on any day (incl. the 1st).
    private var now: Date { Date() }
    private var firstSecondOfMonth: Date { Date().startOfMonth }
    private var lastSecondOfLastMonth: Date { Date().startOfMonth.addingTimeInterval(-1) }
    private var firstSecondOfNextMonth: Date {
        Calendar.current.date(byAdding: .month, value: 1, to: Date().startOfMonth)!
    }

    @Test func monthIncomeCountsOnlyIncomeThisMonth() {
        let store = makeTempStore()
        store.addTransaction(tx(.income, 1_000, date: now))
        store.addTransaction(tx(.income, 1, .usd, date: firstSecondOfMonth))
        store.addTransaction(tx(.income, 50_000, date: lastSecondOfLastMonth))
        store.addTransaction(tx(.expense, 77, date: now))
        store.addTransaction(tx(.transfer, 5_000, category: .loanReceived, date: now))
        store.addTransaction(tx(.transfer, 5_000, date: now))
        #expect(store.monthIncome == 1_000 + 12_110)
    }

    @Test func monthExpenseIncludesDebtPaymentsButNotPlainTransfersOrLoans() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 100, date: now))
        store.addTransaction(tx(.transfer, 1_000, category: .debtPayment, date: now))
        store.addTransaction(tx(.transfer, 10_000, category: .transfer, date: now))
        store.addTransaction(tx(.transfer, 20_000, category: .loanReceived, date: now))
        store.addTransaction(tx(.income, 30_000, date: now))
        #expect(store.monthExpense == 1_100)
    }

    @Test func monthBoundaries() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 1, date: firstSecondOfMonth))
        store.addTransaction(tx(.expense, 10, date: lastSecondOfLastMonth))
        store.addTransaction(tx(.expense, 100, date: firstSecondOfNextMonth))
        #expect(store.monthExpense == 1)
        #expect(store.spentThisMonth(in: .groceries) == 1)
        #expect(store.monthSpendingByCategory.map(\.amount) == [1])
    }

    @Test func sameMonthLastYearIsExcluded() {
        let store = makeTempStore()
        let lastYear = Calendar.current.date(byAdding: .year, value: -1, to: now)!
        store.addTransaction(tx(.expense, 999, date: lastYear))
        store.addTransaction(tx(.income, 999, date: lastYear))
        #expect(store.monthExpense == 0)
        #expect(store.monthIncome == 0)
    }

    @Test func monthExpenseConvertsToDisplayCurrency() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 2, .usd, date: now))
        store.addTransaction(tx(.expense, 12_110, .uzs, date: now))
        #expect(store.monthExpense == 36_330)
        store.displayCurrency = .usd
        #expect(approx(store.monthExpense, 3))
    }

    @Test func isSpendingFlags() {
        #expect(tx(.expense, 1).isSpending)
        #expect(tx(.transfer, 1, category: .debtPayment).isSpending)
        #expect(tx(.transfer, 1, category: .debtPayment).isDebtPayment)
        #expect(!tx(.transfer, 1).isSpending)
        #expect(!tx(.transfer, 1, category: .loanReceived).isSpending)
        #expect(tx(.transfer, 1, category: .loanReceived).isLoanReceived)
        #expect(!tx(.income, 1).isSpending)
        // A debtPayment *category* on an income is not a debt payment.
        #expect(!tx(.income, 1, category: .debtPayment).isDebtPayment)
        #expect(tx(.income, 5).signedAmount == 5)
        #expect(tx(.expense, 5).signedAmount == -5)
        #expect(tx(.transfer, 5).signedAmount == 0)
    }

    @Test func spentThisMonthPerCategoryAndCurrency() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 24_220, category: .groceries, date: now))
        store.addTransaction(tx(.expense, 1, .usd, category: .groceries, date: now))
        store.addTransaction(tx(.expense, 500, category: .transport, date: now))
        store.addTransaction(tx(.transfer, 1_000, category: .debtPayment, date: now))
        #expect(store.spentThisMonth(in: .groceries) == 36_330)
        #expect(approx(store.spentThisMonth(in: .groceries, convertedTo: .usd), 3))
        #expect(store.spentThisMonth(in: .transport) == 500)
        #expect(store.spentThisMonth(in: .debtPayment) == 1_000)
        #expect(store.spentThisMonth(in: .health) == 0)
    }

    @Test func monthSpendingByCategorySortedHighestFirst() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 300, category: .transport, date: now))
        store.addTransaction(tx(.expense, 100, category: .groceries, date: now))
        store.addTransaction(tx(.expense, 250, category: .groceries, date: now))
        store.addTransaction(tx(.expense, 1, .usd, category: .shopping, date: now))
        store.addTransaction(tx(.transfer, 200, category: .debtPayment, date: now))
        store.addTransaction(tx(.transfer, 99_999, category: .transfer, date: now))
        let rows = store.monthSpendingByCategory
        #expect(rows.map(\.category) == [.shopping, .groceries, .transport, .debtPayment])
        #expect(rows.map(\.amount) == [12_110, 350, 300, 200])
    }

    @Test func dailyExpensesLengthOrderingAndZeroFill() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 100, date: daysAgo(0, hour: 0)))
        store.addTransaction(tx(.expense, 50, date: daysAgo(0, hour: 0).addingTimeInterval(60)))
        store.addTransaction(tx(.expense, 7, date: daysAgo(2)))
        store.addTransaction(tx(.transfer, 1_000, category: .debtPayment, date: daysAgo(2)))
        store.addTransaction(tx(.transfer, 9_999, date: daysAgo(2)))
        store.addTransaction(tx(.transfer, 9_999, category: .loanReceived, date: daysAgo(2)))
        store.addTransaction(tx(.income, 9_999, date: daysAgo(1)))
        store.addTransaction(tx(.expense, 3, date: daysAgo(7)))   // outside a 7-day window

        let series = store.dailyExpenses(lastDays: 7)
        #expect(series.count == 7)
        #expect(series.last?.date == Date().startOfDay)
        #expect(series.first?.date == Calendar.current.date(byAdding: .day, value: -6, to: Date().startOfDay))
        #expect(zip(series, series.dropFirst()).allSatisfy { $0.date < $1.date })
        #expect(series.allSatisfy { $0.date == $0.date.startOfDay })
        #expect(series.map(\.amount) == [0, 0, 0, 0, 1_007, 0, 150])
    }

    @Test func dailyExpensesConvertsToDisplayCurrency() {
        let store = makeTempStore()
        store.addTransaction(tx(.expense, 2, .usd, date: daysAgo(0, hour: 0)))
        #expect(store.dailyExpenses(lastDays: 1).map(\.amount) == [24_220])
        store.displayCurrency = .usd
        #expect(store.dailyExpenses(lastDays: 1).map(\.amount) == [2])
    }

    @Test(arguments: [0, -3])
    func dailyExpensesNonPositiveWindowIsEmpty(days: Int) {
        let store = makeTempStore()
        #expect(store.dailyExpenses(lastDays: days).isEmpty)
    }

    @Test func dailyExpensesThirtyDaysHasUniqueConsecutiveDays() {
        let store = makeTempStore(seed: true)
        let series = store.dailyExpenses(lastDays: 30)
        #expect(series.count == 30)
        #expect(Set(series.map(\.date)).count == 30)
        let cal = Calendar.current
        for (a, b) in zip(series, series.dropFirst()) {
            #expect(cal.dateComponents([.day], from: a.date, to: b.date).day == 1)
        }
    }

    @Test func futureDatedTransactionsInDailySeries() {
        // A transaction dated tomorrow must never show up in a series that ends today.
        let store = makeTempStore()
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: daysAgo(0))!
        store.addTransaction(tx(.expense, 500, date: tomorrow))
        #expect(store.dailyExpenses(lastDays: 7).map(\.amount).reduce(0, +) == 0)
    }

    @Test func futureDatedTransactionLaterThisMonthCountsInMonthTotals() {
        // Documents current behavior: month totals count any date in the
        // current calendar month, including ones later than now.
        let store = makeTempStore()
        let lastSecond = firstSecondOfNextMonth.addingTimeInterval(-1)
        store.addTransaction(tx(.expense, 40, date: lastSecond))
        store.addTransaction(tx(.income, 60, date: lastSecond))
        #expect(store.monthExpense == 40)
        #expect(store.monthIncome == 60)
    }

    @Test func seedDataProducesSaneAnalytics() {
        let store = makeTempStore(seed: true)
        #expect(store.monthExpense >= 0)
        let byCategory = store.monthSpendingByCategory
        #expect(approx(byCategory.reduce(0) { $0 + $1.amount }, store.monthExpense))
        #expect(zip(byCategory, byCategory.dropFirst()).allSatisfy { $0.amount >= $1.amount })
    }
}
