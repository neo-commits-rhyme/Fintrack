import Testing
import Foundation
@testable import Fintrack

@Suite("Budgets and goals")
@MainActor
struct GoalsBudgetsTests {

    // MARK: Budgets

    @Test func budgetStatusSameCurrency() {
        let store = makeTempStore()
        let b = Budget(category: .groceries, limit: 1_000, currency: .uzs)
        store.addBudget(b)
        store.addTransaction(tx(.expense, 400, category: .groceries))
        store.addTransaction(tx(.expense, 999, category: .transport))
        let s = store.status(of: b)
        #expect(s.spent == 400)
        #expect(s.limit == 1_000)
        #expect(s.remaining == 600)
        #expect(s.fraction == 0.4)
        #expect(!s.isOver)
    }

    @Test func budgetStatusConvertsSpendingIntoBudgetCurrency() {
        let store = makeTempStore()
        let b = Budget(category: .subscriptions, limit: 25, currency: .usd)
        store.addTransaction(tx(.expense, 121_100, .uzs, category: .subscriptions))  // 10 USD
        store.addTransaction(tx(.expense, 5, .usd, category: .subscriptions))
        let s = store.status(of: b)
        #expect(approx(s.spent, 15))
        #expect(approx(s.remaining, 10))
        #expect(approx(s.fraction, 0.6))
        // Display currency must not affect a budget's own-currency status.
        store.displayCurrency = .eur
        #expect(approx(store.status(of: b).spent, 15))
    }

    @Test func budgetStatusOverLimit() {
        let store = makeTempStore()
        let b = Budget(category: .eatingOut, limit: 100, currency: .uzs)
        store.addTransaction(tx(.expense, 150, category: .eatingOut))
        let s = store.status(of: b)
        #expect(s.isOver)
        #expect(s.remaining == 0)
        #expect(s.fraction == 1.5)
    }

    @Test func budgetStatusIgnoresLastMonth() {
        let store = makeTempStore()
        let b = Budget(category: .groceries, limit: 100, currency: .uzs)
        store.addTransaction(tx(.expense, 80, category: .groceries, date: Date().startOfMonth.addingTimeInterval(-1)))
        #expect(store.status(of: b).spent == 0)
    }

    @Test func budgetCountsDebtPaymentsInDebtPaymentCategory() {
        let store = makeTempStore()
        let b = Budget(category: .debtPayment, limit: 2_000_000, currency: .uzs)
        store.addTransaction(tx(.transfer, 1_000_000, category: .debtPayment))
        #expect(store.status(of: b).spent == 1_000_000)
    }

    @Test func budgetStatusZeroLimit() {
        let s = BudgetStatus(spent: 0, limit: 0)
        #expect(s.fraction == 0)
        #expect(!s.isOver)
        #expect(s.remaining == 0)
        let spent = BudgetStatus(spent: 10, limit: 0)
        #expect(spent.fraction == 0)
        #expect(spent.isOver)
        #expect(BudgetStatus(spent: 100, limit: 100).isOver == false)
    }

    @Test func unbudgetedCategories() {
        let store = makeTempStore()
        #expect(store.unbudgetedCategories == Fintrack.Category.expenseCategories)
        store.addBudget(Budget(category: .groceries, limit: 1, currency: .uzs))
        store.addBudget(Budget(category: .travel, limit: 1, currency: .uzs))
        let remaining = store.unbudgetedCategories
        #expect(!remaining.contains(.groceries))
        #expect(!remaining.contains(.travel))
        #expect(remaining.count == Fintrack.Category.expenseCategories.count - 2)
        #expect(!remaining.contains(.salary))
        #expect(!remaining.contains(.transfer))
    }

    @Test func budgetCRUD() {
        let store = makeTempStore()
        var b = Budget(category: .groceries, limit: 1, currency: .uzs)
        store.addBudget(b)
        b.limit = 99
        store.updateBudget(b)
        #expect(store.budgets == [b])
        store.updateBudget(Budget(category: .health, limit: 5, currency: .usd))  // unknown id: ignored
        #expect(store.budgets == [b])
        store.deleteBudget(id: b.id)
        #expect(store.budgets.isEmpty)
    }

    // MARK: Goals

    @Test func addFundsSameCurrency() {
        let store = makeTempStore()
        let g = Goal(name: "Mac", target: 2_400, saved: 100, currency: .usd)
        store.addGoal(g)
        store.addFunds(toGoal: g.id, amount: 50, currency: .usd)
        #expect(store.goals[0].saved == 150)
    }

    @Test func addFundsConvertsIntoGoalCurrency() {
        let store = makeTempStore()
        let g = Goal(name: "Mac", target: 2_400, currency: .usd)
        store.addGoal(g)
        store.addFunds(toGoal: g.id, amount: 121_100, currency: .uzs)
        #expect(approx(store.goals[0].saved, 10))
        store.addFunds(toGoal: g.id, amount: 100, currency: .eur)
        #expect(approx(store.goals[0].saved, 10 + 100 * 14_150.0 / 12_110))
    }

    @Test func addFundsUnknownGoalIsNoOp() {
        let store = makeTempStore()
        let g = Goal(name: "Mac", target: 10, currency: .usd)
        store.addGoal(g)
        store.addFunds(toGoal: UUID(), amount: 5, currency: .usd)
        #expect(store.goals[0].saved == 0)
    }

    @Test func goalCRUD() {
        let store = makeTempStore()
        var g = Goal(name: "Trip", target: 100, currency: .jpy)
        store.addGoal(g)
        g.name = "Tokyo"
        store.updateGoal(g)
        #expect(store.goals == [g])
        store.deleteGoal(id: g.id)
        #expect(store.goals.isEmpty)
    }

    @Test func goalFractionCompleteRemaining() {
        let half = Goal(name: "g", target: 200, saved: 100, currency: .usd)
        #expect(half.fraction == 0.5)
        #expect(!half.isComplete)
        #expect(half.remaining == 100)

        let exact = Goal(name: "g", target: 200, saved: 200, currency: .usd)
        #expect(exact.fraction == 1)
        #expect(exact.isComplete)
        #expect(exact.remaining == 0)

        let over = Goal(name: "g", target: 200, saved: 500, currency: .usd)
        #expect(over.fraction == 1)
        #expect(over.isComplete)
        #expect(over.remaining == 0)

        let zeroTarget = Goal(name: "g", target: 0, saved: 0, currency: .usd)
        #expect(zeroTarget.fraction == 0)
        #expect(!zeroTarget.isComplete)
        #expect(zeroTarget.remaining == 0)

        let zeroTargetSaved = Goal(name: "g", target: 0, saved: 50, currency: .usd)
        #expect(zeroTargetSaved.fraction == 0)
        #expect(!zeroTargetSaved.isComplete)
        #expect(zeroTargetSaved.remaining == 0)

        let empty = Goal(name: "g", target: 100, currency: .usd)
        #expect(empty.fraction == 0)
        #expect(empty.remaining == 100)
    }
}
