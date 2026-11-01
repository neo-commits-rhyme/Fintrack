import SwiftUI

/// Accounts: cash, cards and bank accounts with live balances derived from
/// linked transactions and transfers.
struct AccountsView: View {
    @Environment(AppStore.self) private var store

    @State private var isAddSheetPresented = false
    @State private var editingAccount: Account? = nil
    @State private var pendingDeletion: Account? = nil

    var body: some View {
        FTScreen("Accounts", subtitle: "Your money, where it lives") {
            Button {
                isAddSheetPresented = true
            } label: {
                Label("Add Account", systemImage: "plus")
            }
            .buttonStyle(.glassProminent)
        } content: {
            if store.accounts.isEmpty {
                GlassCard {
                    EmptyStateView(
                        icon: "creditcard",
                        title: "No accounts yet",
                        message: "Add your cash, cards and bank accounts to see where your money lives. Transfers move balances between them."
                    )
                }
            } else {
                summaryCard

                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 280), spacing: FT.gridSpacing, alignment: .top)],
                    spacing: FT.gridSpacing
                ) {
                    ForEach(store.accounts) { account in
                        AccountCard(
                            account: account,
                            onEdit: { editingAccount = account },
                            onDelete: { pendingDeletion = account }
                        )
                    }
                }
            }
        }
        .animation(.snappy, value: store.accounts)
        .sheet(isPresented: $isAddSheetPresented) {
            AccountEditorSheet(account: nil, defaultCurrency: store.displayCurrency)
        }
        .sheet(item: $editingAccount) { account in
            AccountEditorSheet(account: account, defaultCurrency: store.displayCurrency)
        }
        .confirmationDialog(
            "Delete Account?",
            isPresented: Binding(
                get: { pendingDeletion != nil },
                set: { if !$0 { pendingDeletion = nil } }
            ),
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { account in
            Button("Delete \u{201C}\(account.name)\u{201D}", role: .destructive) {
                store.deleteAccount(id: account.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { account in
            Text("Transactions and transfers that used \u{201C}\(account.name)\u{201D} are kept, but lose their link to it. This cannot be undone.")
        }
    }

    private var summaryCaption: String {
        let excluded = store.accounts.count { !$0.includeInTotal }
        var parts = ["\(store.accounts.count) account\(store.accounts.count == 1 ? "" : "s")"]
        if store.balancesByCurrency.count > 1 {
            parts.append("≈ \(store.format(store.totalAccountsBalance, in: store.displayCurrency)) at your rates")
        }
        if excluded > 0 {
            parts.append("\(excluded) not counted")
        }
        return parts.joined(separator: " · ")
    }

    private var summaryCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 6) {
                Text("Across all accounts")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                Text(store.balanceSplitText)
                    .font(.system(size: 30, weight: .semibold))
                    .monospacedDigit()
                    .kerning(-0.3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .contentTransition(.numericText())
                Text(summaryCaption)
                    .font(.system(size: 12))
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
        }
    }
}

// MARK: - Account card

private struct AccountCard: View {
    @Environment(AppStore.self) private var store
    var account: Account
    var onEdit: () -> Void
    var onDelete: () -> Void
    @State private var isPaying = false
    @State private var isBorrowing = false

    var body: some View {
        let balance = store.balance(of: account)

        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: account.icon)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(account.kind == .debt ? FT.expense : FT.accent)
                        .frame(width: 34, height: 34)
                        .background(
                            (account.kind == .debt ? FT.expense : FT.accent).opacity(0.13),
                            in: .rect(cornerRadius: 10)
                        )

                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 6) {
                            Text(account.name)
                                .font(.system(size: 15, weight: .semibold))
                                .lineLimit(1)
                            if account.kind == .debt {
                                Text("DEBT")
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundStyle(FT.expense)
                                    .padding(.horizontal, 5)
                                    .padding(.vertical, 2)
                                    .background(FT.expense.opacity(0.15), in: .capsule)
                            }
                        }
                        Text("\(account.currency.flag) \(account.currency.rawValue)")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Menu {
                        Button("Edit Account") { onEdit() }
                        if account.kind == .debt {
                            Button("Borrow More…") { isBorrowing = true }
                        }
                        Divider()
                        Button("Delete Account…", role: .destructive) { onDelete() }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .frame(width: 26, height: 26)
                            .contentShape(.rect)
                    }
                    .menuStyle(.button)
                    .buttonStyle(.plain)
                    .fixedSize()
                    .accessibilityLabel("Options for \(account.name)")
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(store.format(balance, in: account.currency))
                        .font(.system(size: 24, weight: .semibold))
                        .monospacedDigit()
                        .kerning(-0.3)
                        .contentTransition(.numericText())
                        .foregroundStyle(balance < 0 ? FT.expense : .primary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    if account.currency != store.displayCurrency {
                        Text(store.formatInDisplay(balance, from: account.currency))
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                }

                HStack {
                    Toggle(isOn: Binding(
                        get: { account.includeInTotal },
                        set: { newValue in
                            var updated = account
                            updated.includeInTotal = newValue
                            store.updateAccount(updated)
                        }
                    )) {
                        // A constant label: the switch itself shows the state, and
                        // the control never jumps sideways under the pointer.
                        Text("Count in total")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                    .toggleStyle(.switch)
                    .controlSize(.mini)

                    if account.kind == .debt, balance < 0 {
                        Spacer()
                        Button("Pay…") { isPaying = true }
                            .buttonStyle(.glass)
                            .controlSize(.small)
                    }
                }
            }
        }
        .onTapGesture(count: 2) { onEdit() }
        .sheet(isPresented: $isPaying) {
            PayDebtSheet(debt: account)
        }
        .sheet(isPresented: $isBorrowing) {
            BorrowSheet(debt: account)
        }
    }
}

// MARK: - Pay debt sheet

/// Quick payment into a debt account — creates the same "debt payment"
/// transfer as the Expense → Debt payment flow.
private struct PayDebtSheet: View {
    @Environment(AppStore.self) private var store
    let debt: Account

    @State private var amount: Double?
    @State private var sourceAccountID: UUID?
    @State private var date = Date()

    var body: some View {
        let remaining = abs(min(0, store.balance(of: debt)))

        FTSheet(
            title: "Pay \(debt.name)",
            saveTitle: "Pay",
            canSave: FTFormat.isValidAmount(amount) && (amount ?? 0) <= remaining + 0.005
                && store.account(sourceAccountID)?.kind == .regular,
            onSave: save
        ) {
            Section {
                HStack(spacing: 10) {
                    TextField("Amount", value: $amount, format: .amount, prompt: Text("0"))
                        .monospacedDigit()
                    Text(debt.currency.rawValue)
                        .foregroundStyle(.secondary)
                }

                if let amount, FTFormat.isValidAmount(amount), amount > remaining + 0.005 {
                    Text("That's more than the \(store.format(remaining, in: debt.currency)) left on this debt.")
                        .font(.system(size: 12))
                        .foregroundStyle(FT.expense)
                }

                if remaining > 0 {
                    Button("Pay in full — \(store.format(remaining, in: debt.currency))") {
                        amount = remaining
                    }
                    .buttonStyle(.link)
                }

                // The payment has to leave a real account, or the balance
                // would simply rise by the amount paid.
                Picker("From account", selection: $sourceAccountID) {
                    Text("Choose account…").tag(UUID?.none)
                    ForEach(store.accounts.filter { $0.kind == .regular }) { account in
                        Text(account.name).tag(UUID?.some(account.id))
                    }
                }
                .pickerStyle(.menu)

                DatePicker("Date", selection: $date, displayedComponents: [.date])
            } footer: {
                Text("Counts as spending in your monthly stats. \(store.format(remaining, in: debt.currency)) left on this debt.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func save() {
        guard let amount, FTFormat.isValidAmount(amount), store.account(sourceAccountID)?.kind == .regular else { return }
        store.addTransaction(Transaction(
            title: "\(debt.name) payment",
            amount: amount,
            currency: debt.currency,
            category: .debtPayment,
            kind: .transfer,
            date: date,
            accountID: nil,
            fromAccountID: sourceAccountID,
            toAccountID: debt.id,
            fromAccount: store.account(sourceAccountID)?.name,
            toAccount: debt.name
        ))
    }
}

// MARK: - Borrow sheet

/// Take more money out of a debt: debt account → regular account.
/// Neutral for income stats; the debt deepens by the borrowed amount.
private struct BorrowSheet: View {
    @Environment(AppStore.self) private var store
    let debt: Account

    @State private var amount: Double?
    @State private var depositAccountID: UUID?
    @State private var date = Date()

    var body: some View {
        FTSheet(
            title: "Borrow from \(debt.name)",
            saveTitle: "Borrow",
            canSave: FTFormat.isValidAmount(amount) && store.account(depositAccountID)?.kind == .regular,
            onSave: save
        ) {
            Section {
                HStack(spacing: 10) {
                    TextField("Amount", value: $amount, format: .amount, prompt: Text("0"))
                        .monospacedDigit()
                    Text(debt.currency.rawValue)
                        .foregroundStyle(.secondary)
                }

                Picker("Deposit to", selection: $depositAccountID) {
                    Text("Choose account…").tag(UUID?.none)
                    ForEach(store.accounts.filter { $0.kind == .regular }) { account in
                        Text(account.name).tag(UUID?.some(account.id))
                    }
                }
                .pickerStyle(.menu)

                DatePicker("Date", selection: $date, displayedComponents: [.date])
            } footer: {
                Text("The debt grows by this amount and the money lands on the chosen account. Doesn't count as income — borrowed money isn't earnings.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func save() {
        guard let amount, FTFormat.isValidAmount(amount), store.account(depositAccountID)?.kind == .regular else { return }
        store.addTransaction(Transaction(
            title: "Borrowed from \(debt.name)",
            amount: amount,
            currency: debt.currency,
            category: .loanReceived,
            kind: .transfer,
            date: date,
            accountID: nil,
            fromAccountID: debt.id,
            toAccountID: depositAccountID,
            fromAccount: debt.name,
            toAccount: store.account(depositAccountID)?.name
        ))
    }
}

// MARK: - Add / Edit sheet

private struct AccountEditorSheet: View {
    @Environment(AppStore.self) private var store

    private let editing: Account?

    @State private var name: String
    @State private var icon: String
    @State private var currency: CurrencyCode
    @State private var kind: AccountKind
    @State private var openingBalance: Double?
    @State private var includeInTotal: Bool

    init(account: Account?, defaultCurrency: CurrencyCode) {
        editing = account
        _name = State(initialValue: account?.name ?? "")
        _icon = State(initialValue: account?.icon ?? "creditcard.fill")
        _currency = State(initialValue: account?.currency ?? defaultCurrency)
        _kind = State(initialValue: account?.kind ?? .regular)
        // Debts store a negative balance but are edited as a positive "owed";
        // regular accounts keep their sign (an overdraft stays negative).
        _openingBalance = State(initialValue: account.map { $0.kind == .debt ? abs($0.openingBalance) : $0.openingBalance })
        _includeInTotal = State(initialValue: account?.includeInTotal ?? true)
    }

    var body: some View {
        FTSheet(
            title: editing == nil ? "New Account" : "Edit Account",
            saveTitle: editing == nil ? "Add" : "Save",
            canSave: canSave,
            onSave: save
        ) {
            Section {
                TextField("Name", text: $name, prompt: Text("e.g. Humo card"))

                ScrollView(.horizontal, showsIndicators: false) {
                    GlassEffectContainer(spacing: 12) {
                        HStack(spacing: 10) {
                            ForEach(Account.icons, id: \.self) { symbol in
                                Button {
                                    icon = symbol
                                } label: {
                                    Image(systemName: symbol)
                                        .font(.system(size: 15, weight: .medium))
                                        .foregroundStyle(icon == symbol ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                                        .frame(width: 38, height: 38)
                                        .contentShape(.circle)
                                }
                                .buttonStyle(.pressScale)
                                .glassEffect(
                                    icon == symbol
                                        ? Glass.regular.tint(FT.accent).interactive()
                                        : Glass.regular.interactive(),
                                    in: .circle
                                )
                                .accessibilityLabel(Account.iconLabel(symbol))
                                .accessibilityAddTraits(icon == symbol ? [.isSelected] : [])
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .animation(.snappy, value: icon)
            }

            Section {
                Picker("Kind", selection: $kind) {
                    ForEach(AccountKind.allCases) { kind in
                        Text(kind.title).tag(kind)
                    }
                }
                .pickerStyle(.segmented)

                CurrencyPicker(selection: $currency)
                    .onChange(of: currency) { old, new in
                        // Keep the balance meaningful: $180 becomes ~2.2M soʻm,
                        // not "180 soʻm". Linked activity is re-converted live.
                        if editing != nil, let b = openingBalance {
                            openingBalance = store.convert(b, from: old, to: new)
                        }
                    }

                TextField(
                    kind == .debt ? "Amount owed" : "Current balance",
                    value: $openingBalance,
                    format: .amount,
                    prompt: Text("0")
                )
                .monospacedDigit()

                if !FTFormat.isValidBalance(openingBalance) {
                    Text("Enter a real number.")
                        .font(.system(size: 12))
                        .foregroundStyle(FT.expense)
                }

                Toggle("Count in total balance", isOn: $includeInTotal)
            } footer: {
                Text(kind == .debt
                    ? "Debts carry a negative balance and pull the total down while counted. Transfers into a debt account pay it off."
                    : "The balance right now, before Fintrack starts tracking. Income, expenses and transfers you link to this account adjust it automatically.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        guard !trimmedName.isEmpty, FTFormat.isValidBalance(openingBalance) else { return false }
        // No duplicate names (except the account being edited itself).
        return !store.accounts.contains {
            $0.id != editing?.id && $0.name.caseInsensitiveCompare(trimmedName) == .orderedSame
        }
    }

    private func save() {
        var account = editing ?? Account(name: trimmedName, currency: currency)
        account.name = trimmedName
        account.icon = icon
        account.currency = currency
        account.kind = kind
        // Debts live below zero: "owed 2 000 000" is stored as −2 000 000.
        // Regular accounts keep the typed value (overdrafts may be negative).
        let typed = openingBalance ?? 0
        account.openingBalance = kind == .debt ? -abs(typed) : typed
        account.includeInTotal = includeInTotal
        if editing == nil {
            store.addAccount(account)
        } else {
            store.updateAccount(account)
        }
    }
}
