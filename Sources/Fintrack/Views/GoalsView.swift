import SwiftUI

// MARK: - GoalsView

/// Savings-goals screen: an adaptive grid of goal cards with progress rings,
/// an add-funds flow with live currency conversion, and goal creation/editing.
struct GoalsView: View {
    @Environment(AppStore.self) private var store

    @State private var isAddingGoal = false
    @State private var editingGoal: Goal?
    @State private var fundingGoal: Goal?

    var body: some View {
        FTScreen("Goals", subtitle: "Save toward what matters") {
            Button {
                isAddingGoal = true
            } label: {
                Label("Add", systemImage: "plus")
            }
            .buttonStyle(.glassProminent)
        } content: {
            if store.goals.isEmpty {
                GlassCard {
                    EmptyStateView(
                        icon: "target",
                        title: "No goals yet",
                        message: "Create a goal — a trip, a laptop, an emergency fund — then add funds whenever you set money aside."
                    )
                }
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 320), spacing: FT.gridSpacing, alignment: .top)],
                    spacing: FT.gridSpacing
                ) {
                    ForEach(sortedGoals) { goal in
                        GoalCardView(
                            goal: goal,
                            onAddFunds: { fundingGoal = goal },
                            onEdit: { editingGoal = goal }
                        )
                    }
                }
                .animation(.snappy, value: store.goals)
            }
        }
        .sheet(isPresented: $isAddingGoal) {
            GoalEditorSheet(goal: nil, defaultCurrency: store.displayCurrency)
        }
        .sheet(item: $editingGoal) { goal in
            GoalEditorSheet(goal: goal, defaultCurrency: goal.currency)
        }
        .sheet(item: $fundingGoal) { goal in
            GoalFundsSheet(goal: goal)
        }
    }

    /// Incomplete goals first (closest deadline, then name); reached goals last.
    private var sortedGoals: [Goal] {
        store.goals.sorted { a, b in
            if a.isComplete != b.isComplete { return !a.isComplete }
            let aDue = a.deadline ?? .distantFuture
            let bDue = b.deadline ?? .distantFuture
            if aDue != bDue { return aDue < bDue }
            return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
        }
    }
}

// MARK: - Goal card

private struct GoalCardView: View {
    @Environment(AppStore.self) private var store

    var goal: Goal
    var onAddFunds: () -> Void
    var onEdit: () -> Void

    @State private var isConfirmingDelete = false

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top, spacing: 16) {
                    GoalRing(
                        fraction: goal.fraction,
                        tint: goal.isComplete ? FT.income : FT.accent
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 7) {
                            Image(systemName: goal.icon)
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(.secondary)
                            Text(goal.name)
                                .font(.system(size: 17, weight: .semibold))
                                .lineLimit(1)
                        }

                        Text(store.format(goal.saved, in: goal.currency))
                            .font(.system(size: 24, weight: .semibold))
                            .monospacedDigit()
                            .kerning(-0.3)
                            .contentTransition(.numericText())
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)

                        Group {
                            if goal.isComplete {
                                Text("of \(store.format(goal.target, in: goal.currency))")
                            } else {
                                Text("of \(store.format(goal.target, in: goal.currency)) · \(store.format(goal.remaining, in: goal.currency)) to go")
                            }
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)

                        if goal.isComplete {
                            HStack(spacing: 5) {
                                Image(systemName: "checkmark.seal.fill")
                                Text("Reached")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(FT.income)
                            .padding(.top, 3)
                        } else if let deadline = goal.deadline {
                            DeadlineChip(deadline: deadline)
                                .padding(.top, 3)
                        }
                    }

                    Spacer(minLength: 0)
                }
                // Uniform card height regardless of deadline chips or
                // caption wrapping — footers align across the grid.
                .frame(minHeight: 118, alignment: .top)

                Spacer(minLength: 0)

                HStack {
                    if !goal.isComplete {
                        Button("Add funds") {
                            onAddFunds()
                        }
                        .buttonStyle(.glass)
                        .controlSize(.small)
                    }

                    Spacer()

                    Menu {
                        Button("Edit Goal") { onEdit() }
                        Divider()
                        Button("Delete Goal…", role: .destructive) {
                            isConfirmingDelete = true
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 26, height: 26)
                            .contentShape(.rect)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .accessibilityLabel("Options for \(goal.name)")
                }
            }
        }
        .confirmationDialog(
            "Delete “\(goal.name)”?",
            isPresented: $isConfirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Delete Goal", role: .destructive) {
                store.deleteGoal(id: goal.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the goal and its \(store.format(goal.saved, in: goal.currency)) of tracked progress. Your transactions are not affected.")
        }
    }
}

// MARK: - Deadline chip

private struct DeadlineChip: View {
    var deadline: Date

    var body: some View {
        let info = Self.info(for: deadline)
        Text(info.label)
            .font(.system(size: 12, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(info.isOverdue ? FT.expense : .secondary)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                info.isOverdue
                    ? AnyShapeStyle(FT.expense.opacity(0.14))
                    : AnyShapeStyle(.quaternary),
                in: .capsule
            )
    }

    private static func info(for deadline: Date) -> (label: String, isOverdue: Bool) {
        let calendar = Calendar.current
        let today = Date().startOfDay
        let due = deadline.startOfDay
        if due < today { return ("Overdue", true) }

        let days = calendar.dateComponents([.day], from: today, to: due).day ?? 0
        if days == 0 { return ("Due today", false) }

        let months = calendar.dateComponents([.month], from: today, to: due).month ?? 0
        // Calendar counts 31 Jan → 28 Feb as "1 month"; only say months once a
        // real month's worth of days has passed, so 28 days reads as days.
        if months >= 1 && days >= 28 {
            return (months == 1 ? "1 month left" : "\(months) months left", false)
        }
        return (days == 1 ? "1 day left" : "\(days) days left", false)
    }
}

// MARK: - Add funds sheet

private struct GoalFundsSheet: View {
    @Environment(AppStore.self) private var store

    let goal: Goal
    @State private var amount: Double?
    @State private var currency: CurrencyCode

    init(goal: Goal) {
        self.goal = goal
        _currency = State(initialValue: goal.currency)
    }

    private var canSave: Bool {
        FTFormat.isValidAmount(amount)
    }

    var body: some View {
        FTSheet(
            title: "Add funds to \(goal.name)",
            saveTitle: "Add",
            canSave: canSave,
            onSave: {
                guard let amount, FTFormat.isValidAmount(amount) else { return }
                store.addFunds(toGoal: goal.id, amount: amount, currency: currency)
            }
        ) {
            Section {
                TextField("Amount", value: $amount, format: .amount, prompt: Text("0"))
                    .monospacedDigit()

                CurrencyPicker(selection: $currency)

                if currency != goal.currency {
                    Text("= \(store.format(store.convert(amount ?? 0, from: currency, to: goal.currency), in: goal.currency)) in \(goal.currency.rawValue)")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .animation(.snappy, value: amount)
                }
            } footer: {
                Text("Currently \(store.format(goal.saved, in: goal.currency)) of \(store.format(goal.target, in: goal.currency)) saved.")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }
}

// MARK: - Add / Edit goal sheet

private struct GoalEditorSheet: View {
    @Environment(AppStore.self) private var store

    private let existing: Goal?
    @State private var name: String
    @State private var icon: String
    @State private var target: Double?
    @State private var saved: Double?
    @State private var currency: CurrencyCode
    @State private var hasDeadline: Bool
    @State private var deadline: Date

    private static let icons = [
        "star.fill", "laptopcomputer", "airplane", "house.fill", "car.fill",
        "graduationcap.fill", "heart.fill", "shield.fill", "gift.fill", "camera.fill",
    ]

    init(goal: Goal?, defaultCurrency: CurrencyCode) {
        existing = goal
        _name = State(initialValue: goal?.name ?? "")
        _icon = State(initialValue: goal?.icon ?? "star.fill")
        _target = State(initialValue: goal.map(\.target))
        _saved = State(initialValue: goal.map(\.saved))
        _currency = State(initialValue: goal?.currency ?? defaultCurrency)
        _hasDeadline = State(initialValue: goal?.deadline != nil)
        _deadline = State(
            initialValue: goal?.deadline
                ?? Calendar.current.date(byAdding: .month, value: 3, to: Date().startOfDay)
                ?? Date()
        )
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        !trimmedName.isEmpty && FTFormat.isValidAmount(target) && FTFormat.isValidBalance(saved) && (saved ?? 0) >= 0
    }

    var body: some View {
        FTSheet(
            title: existing == nil ? "New Goal" : "Edit Goal",
            canSave: canSave,
            onSave: save
        ) {
            Section {
                TextField("Name", text: $name, prompt: Text("e.g. Emergency fund"))

                ScrollView(.horizontal, showsIndicators: false) {
                    // One container so the chips' glass samples the background
                    // together and blends between neighbors (Liquid Glass HIG).
                    GlassEffectContainer(spacing: 12) {
                        HStack(spacing: 10) {
                            ForEach(Self.icons, id: \.self) { symbol in
                                IconChip(symbol: symbol, isSelected: icon == symbol) {
                                    icon = symbol
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .animation(.snappy, value: icon)
            }

            Section {
                TextField("Target", value: $target, format: .amount, prompt: Text("Amount to save"))
                    .monospacedDigit()

                if existing != nil {
                    TextField("Saved so far", value: $saved, format: .amount)
                        .monospacedDigit()
                }

                CurrencyPicker(selection: $currency)
                    .onChange(of: currency) { old, new in
                        // Editing: keep the amounts meaningful when the currency
                        // changes — 2 400 USD becomes ~29M soʻm, not "2 400 soʻm".
                        // Creating: the user is still typing, so leave the
                        // numbers alone (2 400 then "USD" must stay $2 400).
                        guard existing != nil else { return }
                        if let t = target { target = store.convert(t, from: old, to: new) }
                        if let s = saved { saved = store.convert(s, from: old, to: new) }
                    }
            }

            Section {
                Toggle("Deadline", isOn: $hasDeadline.animation(.snappy))

                if hasDeadline {
                    DatePicker(
                        "Date",
                        selection: $deadline,
                        in: Date()...,
                        displayedComponents: .date
                    )
                }
            }
        }
    }

    private func save() {
        guard let target, FTFormat.isValidAmount(target), !trimmedName.isEmpty else { return }
        var goal = existing ?? Goal(name: trimmedName, target: target, currency: currency)
        goal.name = trimmedName
        goal.icon = icon
        goal.target = target
        // The fallback is the stored amount in the OLD currency — convert it too.
        let fallbackSaved = store.convert(goal.saved, from: goal.currency, to: currency)
        goal.saved = max(0, saved ?? fallbackSaved)
        goal.currency = currency
        goal.deadline = hasDeadline ? deadline.startOfDay : nil
        if existing == nil {
            store.addGoal(goal)
        } else {
            store.updateGoal(goal)
        }
    }
}

// MARK: - Icon chip

private struct IconChip: View {
    var symbol: String
    var isSelected: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(isSelected ? AnyShapeStyle(FT.accentForeground) : AnyShapeStyle(.primary))
                .frame(width: 38, height: 38)
                .contentShape(.circle)
        }
        .buttonStyle(.pressScale)
        .glassEffect(
            isSelected ? Glass.regular.tint(FT.accent).interactive() : Glass.regular.interactive(),
            in: .circle
        )
        .accessibilityLabel(Account.iconLabel(symbol))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
