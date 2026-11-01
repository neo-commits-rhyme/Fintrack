import SwiftUI

// MARK: - Budgets screen

/// Monthly category budgets: an overall summary, a grid of per-category cards,
/// and an add/edit sheet. All per-budget math comes from `store.status(of:)`,
/// so amounts on each card are in that budget's own currency; the summary
/// converts everything into the display currency.
struct BudgetsView: View {
    @Environment(AppStore.self) private var store

    @State private var isAddingBudget = false
    @State private var editingBudget: Budget?

    private static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "LLLL yyyy"
        return formatter
    }()

    private var subtitle: String {
        "\(Self.monthFormatter.string(from: Date())) · resets monthly"
    }

    var body: some View {
        FTScreen("Budgets", subtitle: subtitle) {
            Button {
                isAddingBudget = true
            } label: {
                Label("Add", systemImage: "plus")
            }
            .buttonStyle(.glassProminent)
            .disabled(store.unbudgetedCategories.isEmpty)
            .help(store.unbudgetedCategories.isEmpty
                ? "Every expense category already has a budget"
                : "Set a monthly limit for a category")
        } content: {
            if store.budgets.isEmpty {
                emptyState
            } else {
                summaryCard

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 300), spacing: FT.gridSpacing)],
                    spacing: FT.gridSpacing
                ) {
                    ForEach(store.budgets) { budget in
                        BudgetCard(budget: budget) {
                            editingBudget = budget
                        }
                    }
                }
                .animation(.snappy, value: store.budgets)
            }
        }
        .sheet(isPresented: $isAddingBudget) {
            BudgetEditorSheet(
                budget: nil,
                categories: store.unbudgetedCategories,
                defaultCurrency: store.displayCurrency
            )
        }
        .sheet(item: $editingBudget) { budget in
            BudgetEditorSheet(
                budget: budget,
                categories: editableCategories(for: budget),
                defaultCurrency: budget.currency
            )
        }
    }

    /// When editing, the picker offers the budget's current category plus any
    /// category that doesn't have a budget yet, in the canonical expense order.
    private func editableCategories(for budget: Budget) -> [Category] {
        let allowed = Set(store.unbudgetedCategories).union([budget.category])
        return Category.expenseCategories.filter { allowed.contains($0) }
    }

    // MARK: Summary

    private var summaryCard: some View {
        let display = store.displayCurrency
        let totalBudgeted = store.budgets.reduce(0) { sum, budget in
            sum + store.inDisplay(budget.limit, from: budget.currency)
        }
        let totalSpent = store.budgets.reduce(0) { sum, budget in
            sum + store.inDisplay(store.status(of: budget).spent, from: budget.currency)
        }
        let overCount = store.budgets.count { store.status(of: $0).isOver }
        let fraction = totalBudgeted > 0 ? totalSpent / totalBudgeted : 0
        // Sum per-budget remainders so an overspent category can't "donate"
        // its deficit to categories that still have room.
        let totalLeft = store.budgets.reduce(0) { sum, budget in
            sum + store.inDisplay(store.status(of: budget).remaining, from: budget.currency)
        }

        return GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Spent this month")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if overCount > 0 {
                        Text("\(overCount) over budget")
                            .font(.system(size: 12, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(FT.expense)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(FT.expense.opacity(0.14), in: .capsule)
                    }
                }

                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(store.format(totalSpent, in: display))
                        .font(.system(size: 28, weight: .semibold))
                        .monospacedDigit()
                        .kerning(-0.3)
                        .contentTransition(.numericText())
                    Text("of \(store.format(totalBudgeted, in: display)) budgeted")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)

                GlassProgressBar(fraction: fraction, tint: FT.accent)

                Group {
                    if totalSpent > totalBudgeted {
                        Text("\(store.format(totalSpent - totalBudgeted, in: display)) over the monthly plan")
                            .fontWeight(.semibold)
                            .foregroundStyle(FT.expense)
                    } else {
                        Text("\(store.format(totalLeft, in: display)) left to spend this month")
                            .foregroundStyle(.secondary)
                    }
                }
                .font(FT.captionFont)
                .monospacedDigit()
            }
        }
        .animation(.snappy, value: totalSpent)
    }

    // MARK: Empty state

    private var emptyState: some View {
        GlassCard {
            VStack(spacing: 0) {
                EmptyStateView(
                    icon: "chart.pie",
                    title: "No budgets yet",
                    message: "Pick a category and set a monthly limit — Fintrack tracks every expense against it and starts fresh on the 1st."
                )
                Button {
                    isAddingBudget = true
                } label: {
                    Label("Create a Budget", systemImage: "plus")
                }
                .buttonStyle(.glassProminent)
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 12)
        }
    }
}

// MARK: - Budget card

private struct BudgetCard: View {
    @Environment(AppStore.self) private var store
    var budget: Budget
    var onEdit: () -> Void

    @State private var isConfirmingDelete = false

    var body: some View {
        let status = store.status(of: budget)

        GlassCard(tint: status.isOver ? FT.expense : nil) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    CategoryBadge(category: budget.category)
                    Text(budget.category.title)
                        .font(.system(size: 16, weight: .semibold))
                        .lineLimit(1)
                    Spacer()
                    Menu {
                        Button("Edit Budget", systemImage: "pencil") {
                            onEdit()
                        }
                        Button("Delete Budget", systemImage: "trash", role: .destructive) {
                            isConfirmingDelete = true
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 24, height: 24)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .help("Budget options")
                    .accessibilityLabel("Options for \(budget.category.title) budget")
                }

                Text(store.format(status.spent, in: budget.currency))
                    .font(.system(size: 24, weight: .semibold))
                    .monospacedDigit()
                    .kerning(-0.3)
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)

                GlassProgressBar(fraction: status.fraction, tint: budget.category.tint)

                HStack(alignment: .firstTextBaseline) {
                    Text("of \(store.format(status.limit, in: budget.currency))")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    Spacer()
                    if status.isOver {
                        Text("Over by \(store.format(status.spent - status.limit, in: budget.currency))")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(FT.expense)
                            .monospacedDigit()
                    } else {
                        Text("\(store.format(status.remaining, in: budget.currency)) left")
                            .font(FT.captionFont)
                            .foregroundStyle(.secondary)
                            .monospacedDigit()
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            }
        }
        .animation(.snappy, value: status.spent)
        .confirmationDialog(
            "Delete the \(budget.category.title) budget?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete Budget", role: .destructive) {
                store.deleteBudget(id: budget.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your transactions stay put — only the monthly limit is removed.")
        }
    }
}

// MARK: - Add / Edit sheet

private struct BudgetEditorSheet: View {
    @Environment(AppStore.self) private var store

    private let existing: Budget?
    private let categories: [Category]

    @State private var category: Category
    @State private var limitInput: Double?
    @State private var currency: CurrencyCode

    init(budget: Budget?, categories: [Category], defaultCurrency: CurrencyCode) {
        self.existing = budget
        self.categories = categories
        _category = State(initialValue: budget?.category ?? categories.first ?? .other)
        _limitInput = State(initialValue: budget?.limit)
        _currency = State(initialValue: budget?.currency ?? defaultCurrency)
    }

    private var canSave: Bool {
        FTFormat.isValidAmount(limitInput)
    }

    var body: some View {
        FTSheet(
            title: existing == nil ? "New Budget" : "Edit Budget",
            saveTitle: existing == nil ? "Add Budget" : "Save",
            canSave: canSave,
            onSave: save
        ) {
            Section {
                Picker("Category", selection: $category) {
                    ForEach(categories) { category in
                        Label(category.title, systemImage: category.icon)
                            .tag(category)
                    }
                }
                .pickerStyle(.menu)

                TextField(
                    "Monthly limit",
                    value: $limitInput,
                    format: .number,
                    prompt: Text("0")
                )
                .monospacedDigit()

                if let limit = limitInput, !FTFormat.isValidAmount(limit) {
                    Text("Enter a limit above 0.")
                        .font(.system(size: 12))
                        .foregroundStyle(FT.expense)
                }

                CurrencyPicker(selection: $currency)
            } footer: {
                Text("Spending in other currencies counts toward the limit at your saved rates.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }

            Section {
                LabeledContent("Spent so far this month") {
                    Text(store.format(
                        store.spentThisMonth(in: category, convertedTo: currency),
                        in: currency
                    ))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func save() {
        guard let limit = limitInput, FTFormat.isValidAmount(limit) else { return }
        if var budget = existing {
            budget.category = category
            budget.limit = limit
            budget.currency = currency
            store.updateBudget(budget)
        } else {
            store.addBudget(Budget(category: category, limit: limit, currency: currency))
        }
    }
}
