import SwiftUI
import Charts

/// Read-only overview screen: total balance, this month's flows, a 30-day
/// spending chart, category breakdown, budget health, and recent activity.
struct DashboardView: View {
    @Environment(AppStore.self) private var store

    var body: some View {
        FTScreen("Dashboard", subtitle: "Your money at a glance") {
            heroCard

            statRow

            SectionHeader("Spending — last 30 days")
            spendingChartCard

            HStack(alignment: .top, spacing: FT.gridSpacing) {
                topCategoriesColumn
                budgetsColumn
            }

            SectionHeader("Recent activity")
            recentActivityCard
        }
    }

    // MARK: Hero balance

    private var heroCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                Text("Total balance")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)

                // One figure per currency, no conversion — money shown in the
                // currency it actually sits in.
                Text(store.balanceSplitText)
                    .font(FT.heroNumberFont)
                    .monospacedDigit()
                    .kerning(-0.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .contentTransition(.numericText())
                    .animation(.snappy, value: store.balanceSplitText)

                if store.balancesByCurrency.count > 1 {
                    Text("≈ \(store.format(store.balance, in: store.displayCurrency)) all together, at your rates")
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(.tertiary)
                }

                HStack(spacing: 10) {
                    flowChip(
                        prefix: "+",
                        amount: store.monthIncome,
                        tint: FT.income,
                        icon: "arrow.up.right"
                    )
                    flowChip(
                        prefix: "−",
                        amount: store.monthExpense,
                        tint: FT.expense,
                        icon: "arrow.down.right"
                    )
                    Text("this month")
                        .font(FT.captionFont)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    private func flowChip(prefix: String, amount: Double, tint: Color, icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .bold))
            Text(prefix + store.format(amount, in: store.displayCurrency))
                .font(.system(size: 13, weight: .semibold))
                .monospacedDigit()
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(tint.opacity(0.12), in: .capsule)
    }

    // MARK: Stat tiles

    private var statRow: some View {
        HStack(alignment: .top, spacing: FT.gridSpacing) {
            StatTile(
                title: "Income · \(monthName)",
                value: store.format(store.monthIncome, in: store.displayCurrency),
                icon: "arrow.up.right",
                tint: FT.income
            )
            StatTile(
                title: "Spending · \(monthName)",
                value: store.format(store.monthExpense, in: store.displayCurrency),
                icon: "arrow.down.right",
                tint: FT.expense
            )
            StatTile(
                title: "Savings rate",
                value: savingsRateText,
                icon: "percent",
                tint: FT.accent
            )
        }
    }

    private var monthName: String {
        Date().formatted(.dateTime.month(.wide))
    }

    private var savingsRateText: String {
        guard store.monthIncome > 0 else { return "—" }
        let rate = (store.monthIncome - store.monthExpense) / store.monthIncome
        let percent = Int((rate * 100).rounded())
        return percent < 0 ? "−\(abs(percent))%" : "\(percent)%"
    }

    // MARK: 30-day spending chart

    private var spendingChartCard: some View {
        let series = store.dailyExpenses(lastDays: 30)
        return GlassCard {
            if series.contains(where: { $0.amount > 0 }) {
                Chart(series) { point in
                    BarMark(
                        x: .value("Day", point.date, unit: .day),
                        y: .value("Spent", point.amount)
                    )
                    .foregroundStyle(FT.accent.gradient)
                    .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: .dateTime.day().month(.abbreviated))
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .trailing) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let amount = value.as(Double.self) {
                                Text(FTFormat.compactMoney(amount, currency: store.displayCurrency))
                                    .monospacedDigit()
                            }
                        }
                    }
                }
                .frame(height: 220)
                .animation(.snappy, value: store.transactions)
            } else {
                EmptyStateView(
                    icon: "chart.bar",
                    title: "No spending recorded",
                    message: "Add a few expenses and the last 30 days will take shape here."
                )
            }
        }
    }

    // MARK: Top categories

    private var topCategoriesColumn: some View {
        let breakdown = store.monthSpendingByCategory
        let top = Array(breakdown.prefix(5))
        return VStack(alignment: .leading, spacing: 0) {
            SectionHeader("Top categories")
            GlassCard {
                if top.isEmpty {
                    EmptyStateView(
                        icon: "chart.pie",
                        title: "Nothing spent this month",
                        message: "Your spending will break down by category here."
                    )
                } else {
                    VStack(alignment: .leading, spacing: 16) {
                        donutChart(top)

                        VStack(spacing: 12) {
                            ForEach(top, id: \.category) { item in
                                HStack(spacing: 10) {
                                    CategoryBadge(category: item.category, size: 26)
                                    Text(item.category.title)
                                        .font(.system(size: 14, weight: .medium))
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    Text(store.format(item.amount, in: store.displayCurrency))
                                        .font(.system(size: 14, weight: .semibold))
                                        .monospacedDigit()
                                }
                            }
                        }

                        if breakdown.count > top.count {
                            Text("+ \(breakdown.count - top.count) smaller \(breakdown.count - top.count == 1 ? "category" : "categories")")
                                .font(.system(size: 12))
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func donutChart(_ top: [(category: Category, amount: Double)]) -> some View {
        Chart(top, id: \.category) { item in
            SectorMark(
                angle: .value("Amount", item.amount),
                innerRadius: .ratio(0.62),
                angularInset: 1.5
            )
            .foregroundStyle(item.category.tint.gradient)
            .cornerRadius(3)
        }
        .chartLegend(.hidden)
        .chartBackground { proxy in
            GeometryReader { geo in
                if let anchor = proxy.plotFrame {
                    let frame = geo[anchor]
                    VStack(spacing: 2) {
                        Text(FTFormat.compactMoney(store.monthExpense, currency: store.displayCurrency))
                            .font(.system(size: 17, weight: .semibold))
                            .monospacedDigit()
                        Text("this month")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }
                    .position(x: frame.midX, y: frame.midY)
                }
            }
        }
        .frame(height: 190)
        .animation(.snappy, value: store.transactions)
    }

    // MARK: Budgets

    private var budgetsColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader("Budgets")
            GlassCard {
                if store.budgets.isEmpty {
                    EmptyStateView(
                        icon: "gauge.with.needle",
                        title: "No budgets yet",
                        message: "Set monthly limits in the Budgets tab to track them here."
                    )
                } else {
                    VStack(alignment: .leading, spacing: 18) {
                        ForEach(store.budgets.prefix(4)) { budget in
                            budgetRow(budget)
                        }
                    }
                    .animation(.snappy, value: store.transactions)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func budgetRow(_ budget: Budget) -> some View {
        let status = store.status(of: budget)
        return VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(budget.category.title)
                    .font(.system(size: 14, weight: .medium))
                Spacer(minLength: 8)
                if status.isOver {
                    Text("Over by \(store.format(status.spent - status.limit, in: budget.currency))")
                        .font(.system(size: 12, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(FT.expense)
                }
            }
            GlassProgressBar(fraction: status.fraction, tint: budget.category.tint)
            Text("\(store.format(status.spent, in: budget.currency)) of \(store.format(status.limit, in: budget.currency))")
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(.secondary)
        }
    }

    // MARK: Recent activity

    private var recentActivityCard: some View {
        let recent = Array(store.transactions.prefix(6))
        return GlassCard {
            if recent.isEmpty {
                EmptyStateView(
                    icon: "list.bullet.rectangle.portrait",
                    title: "No activity yet",
                    message: "Transactions you add will show up here, newest first."
                )
            } else {
                VStack(spacing: 14) {
                    ForEach(recent) { transaction in
                        transactionRow(transaction)
                    }
                }
                .animation(.snappy, value: store.transactions)
            }
        }
    }

    private func transactionRow(_ transaction: Transaction) -> some View {
        HStack(spacing: 12) {
            CategoryBadge(category: transaction.category, size: 34)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.title)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                Text(FTFormat.dayLabel(transaction.date))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 12)

            VStack(alignment: .trailing, spacing: 2) {
                Text(signedDisplayAmount(transaction))
                    .font(.system(size: 14, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(transaction.kind == .income ? FT.income : Color.primary)
                if transaction.currency != store.displayCurrency {
                    Text(store.format(transaction.amount, in: transaction.currency))
                        .font(.system(size: 11))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    /// "+1 250 000 soʻm" for income, "−45 000 soʻm" for expense — in display currency.
    private func signedDisplayAmount(_ transaction: Transaction) -> String {
        let converted = store.inDisplay(transaction.amount, from: transaction.currency)
        let formatted = FTFormat.money(converted, currency: store.displayCurrency)
        return transaction.kind == .income ? "+\(formatted)" : "−\(formatted)"
    }
}
