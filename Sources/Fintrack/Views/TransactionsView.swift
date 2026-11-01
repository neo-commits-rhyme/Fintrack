import SwiftUI

// MARK: - Transactions screen

/// Full transaction manager: searchable, filterable history grouped by day,
/// with add/edit sheet and confirmed deletion.
struct TransactionsView: View {
    @Environment(AppStore.self) private var store

    @State private var searchText = ""
    @State private var kindFilter: KindFilter = .all
    @State private var categoryFilter: Category? = nil

    @State private var isAddSheetPresented = false
    @State private var editingTransaction: Transaction? = nil
    @State private var pendingDeletion: Transaction? = nil

    var body: some View {
        FTScreen("Transactions", subtitle: subtitle) {
            Button {
                isAddSheetPresented = true
            } label: {
                Label("Add Transaction", systemImage: "plus")
            }
            .buttonStyle(.glassProminent)
            .help("New Transaction (⌘N)")
        } content: {
            filterBar

            // The whole list crossfades as ONE unit when a filter changes —
            // no per-card shuffling. Data edits still animate in place.
            Group {
                if filteredTransactions.isEmpty {
                    GlassCard {
                        if store.transactions.isEmpty {
                            EmptyStateView(
                                icon: "list.bullet.rectangle.portrait",
                                title: "No transactions yet",
                                message: "Record your first income or expense with Add Transaction (⌘N)."
                            )
                        } else {
                            EmptyStateView(
                                icon: "magnifyingglass",
                                title: "No matching transactions",
                                message: "Try a different search, or broaden the kind and category filters."
                            )
                        }
                    }
                } else {
                    ForEach(dayGroups, id: \.day) { group in
                        VStack(alignment: .leading, spacing: FT.gridSpacing) {
                            SectionHeader(
                                FTFormat.dayLabel(group.day),
                                subtitle: dayTotalLabel(for: group.transactions)
                            )
                            GlassCard {
                                VStack(spacing: 0) {
                                    ForEach(group.transactions) { transaction in
                                        TransactionRow(
                                            transaction: transaction,
                                            onEdit: { editingTransaction = transaction },
                                            onDelete: { pendingDeletion = transaction }
                                        )
                                        if transaction.id != group.transactions.last?.id {
                                            Divider()
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .id("\(kindFilter.rawValue)-\(categoryFilter?.rawValue ?? "all")")
            .transition(.blurReplace)
        }
        .animation(.smooth(duration: 0.3), value: kindFilter)
        .animation(.smooth(duration: 0.3), value: categoryFilter)
        .animation(.snappy, value: store.transactions)
        // File ▸ New Transaction (⌘N) works from every screen: it lands here
        // and opens the sheet.
        .onAppear { consumeNewTransactionRequest() }
        .onChange(of: store.newTransactionRequested) { _, _ in consumeNewTransactionRequest() }
        .sheet(isPresented: $isAddSheetPresented) {
            TransactionEditorSheet(
                transaction: nil,
                defaultCurrency: store.accounts.first { $0.kind == .regular }?.currency ?? store.displayCurrency,
                defaultAccountID: store.accounts.first { $0.kind == .regular }?.id
            )
        }
        .sheet(item: $editingTransaction) { transaction in
            TransactionEditorSheet(transaction: transaction, defaultCurrency: store.displayCurrency)
        }
        .confirmationDialog(
            "Delete Transaction?",
            isPresented: isDeleteDialogPresented,
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { transaction in
            Button("Delete \u{201C}\(transaction.title)\u{201D}", role: .destructive) {
                store.deleteTransaction(id: transaction.id)
            }
            Button("Cancel", role: .cancel) {}
        } message: { transaction in
            Text("\(store.format(transaction.amount, in: transaction.currency)) from \(FTFormat.dayLabel(transaction.date)) will be removed. This cannot be undone.")
        }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        GlassCard(cornerRadius: FT.smallRadius, padding: 10) {
            HStack(spacing: 14) {
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                    TextField("Search transactions", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))
                    if !searchText.isEmpty {
                        Button {
                            searchText = ""
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12))
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("Clear search")
                    }
                }
                .frame(maxWidth: .infinity)

                GlassSegmentedPicker(
                    options: KindFilter.allCases,
                    title: \.title,
                    selection: $kindFilter
                )
                .fixedSize()

                Menu {
                    Picker("Category", selection: $categoryFilter) {
                        Text("All Categories").tag(Category?.none)
                        ForEach(Category.allCases) { category in
                            Label(category.title, systemImage: category.icon)
                                .tag(Category?.some(category))
                        }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } label: {
                    Label(
                        categoryFilter?.title ?? "All Categories",
                        systemImage: categoryFilter?.icon ?? "line.3.horizontal.decrease.circle"
                    )
                }
                .fixedSize()
                .help("Filter by category")
            }
        }
    }

    // MARK: Derived data

    private var subtitle: String {
        let count = store.transactions.count
        let countLabel = count == 1 ? "1 transaction" : "\(count) transactions"
        let net = store.monthIncome - store.monthExpense
        let netLabel = store.format(net, in: store.displayCurrency)
        return "\(countLabel) · \(net > 0 ? "+" : "")\(netLabel) net this month"
    }

    private var filteredTransactions: [Transaction] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return store.transactions.filter { transaction in
            if !kindFilter.matches(transaction) { return false }
            if let category = categoryFilter, transaction.category != category { return false }
            guard !query.isEmpty else { return true }
            return transaction.title.localizedCaseInsensitiveContains(query)
                || transaction.note.localizedCaseInsensitiveContains(query)
                || transaction.category.title.localizedCaseInsensitiveContains(query)
        }
    }

    /// Filtered transactions bucketed by calendar day, newest day first.
    /// Store order (newest first) is preserved inside each bucket.
    private var dayGroups: [(day: Date, transactions: [Transaction])] {
        let grouped = Dictionary(grouping: filteredTransactions) { $0.date.startOfDay }
        return grouped.keys.sorted(by: >).map { (day: $0, transactions: grouped[$0] ?? []) }
    }

    private func dayTotalLabel(for transactions: [Transaction]) -> String {
        // Debt payments are net-worth neutral but the user counts them as
        // money out for the day.
        let total = transactions.reduce(0.0) { sum, t in
            let flow = t.isDebtPayment ? -t.amount : t.signedAmount
            return sum + store.inDisplay(flow, from: t.currency)
        }
        let formatted = store.format(total, in: store.displayCurrency)
        return total > 0 ? "+\(formatted)" : formatted
    }

    private func consumeNewTransactionRequest() {
        guard store.newTransactionRequested else { return }
        store.newTransactionRequested = false
        editingTransaction = nil
        isAddSheetPresented = true
    }

    private var isDeleteDialogPresented: Binding<Bool> {
        Binding(
            get: { pendingDeletion != nil },
            set: { if !$0 { pendingDeletion = nil } }
        )
    }
}

// MARK: - Kind filter

private enum KindFilter: String, CaseIterable, Identifiable {
    case all
    case income
    case expense
    case transfers

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: "All"
        case .income: "Income"
        case .expense: "Expense"
        case .transfers: "Transfers"
        }
    }

    /// Debt payments live under BOTH Expense (they're spending to the user)
    /// and Transfers (that's their ledger form).
    func matches(_ transaction: Transaction) -> Bool {
        switch self {
        case .all: true
        case .income: transaction.kind == .income || transaction.isLoanReceived
        case .expense: transaction.isSpending
        case .transfers: transaction.kind == .transfer
        }
    }
}

// MARK: - Row

private struct TransactionRow: View {
    @Environment(AppStore.self) private var store
    var transaction: Transaction
    var onEdit: () -> Void
    var onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            CategoryBadge(category: transaction.category)

            VStack(alignment: .leading, spacing: 2) {
                Text(transaction.title)
                    .font(.system(size: 15, weight: .semibold))
                    .lineLimit(1)
                Text(detailText)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 16)

            VStack(alignment: .trailing, spacing: 2) {
                Text(store.signedDisplayAmount(transaction))
                    .font(.system(size: 15, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(transaction.kind == .income ? FT.income : .primary)
                if transaction.currency != store.displayCurrency {
                    Text(store.format(transaction.amount, in: transaction.currency))
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 9)
        .contentShape(.rect)
        .onTapGesture(count: 2) { onEdit() }
        .contextMenu {
            Button {
                onEdit()
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button(role: .destructive) {
                onDelete()
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private var detailText: String {
        var base: String
        if transaction.kind == .transfer {
            let from = store.account(transaction.fromAccountID)?.name
                ?? transaction.fromAccount ?? "Unlinked"
            let to = store.account(transaction.toAccountID)?.name
                ?? transaction.toAccount ?? "Unlinked"
            base = "\(from) → \(to)"
            if let received = transaction.toAmount, let currency = transaction.toCurrency {
                base += " · received \(store.format(received, in: currency))"
            }
        } else {
            base = transaction.category.title
            if let account = store.account(transaction.accountID) {
                base += " · \(account.name)"
            }
        }
        return transaction.note.isEmpty ? base : "\(base) · \(transaction.note)"
    }

}

// MARK: - Add / Edit sheet

private struct TransactionEditorSheet: View {
    @Environment(AppStore.self) private var store

    private let editing: Transaction?

    @State private var title: String
    @State private var amount: Double?
    @State private var currency: CurrencyCode
    @State private var kind: TransactionKind
    @State private var category: Category
    @State private var date: Date
    @State private var note: String
    @State private var accountID: UUID?
    @State private var fromAccountID: UUID?
    @State private var toAccountID: UUID?
    @State private var debtAccountID: UUID?
    @State private var newFromName = ""
    @State private var newToName = ""
    @State private var newDebtName = ""
    /// Cross-currency transfer: what lands on the destination, in its currency.
    @State private var receivedAmount: Double?
    @State private var receivedEdited: Bool

    /// Sentinel tag for the "New Account…" escape hatch in transfer pickers.
    private static let newAccountSentinel = UUID(uuidString: "00000000-0000-0000-0000-0000FFFF0001")!

    init(transaction: Transaction?, defaultCurrency: CurrencyCode, defaultAccountID: UUID? = nil) {
        editing = transaction
        _title = State(initialValue: transaction?.title ?? "")
        _amount = State(initialValue: transaction?.amount)
        _currency = State(initialValue: transaction?.currency ?? defaultCurrency)
        _date = State(initialValue: transaction?.date ?? Date())
        _note = State(initialValue: transaction?.note ?? "")
        _receivedAmount = State(initialValue: transaction?.toAmount)
        _receivedEdited = State(initialValue: transaction?.toAmount != nil)
        if let transaction, transaction.isDebtPayment {
            // Debt payments re-open in the expense form they were created from.
            _kind = State(initialValue: .expense)
            _category = State(initialValue: .debtPayment)
            _accountID = State(initialValue: transaction.fromAccountID)
            _debtAccountID = State(initialValue: transaction.toAccountID)
            _fromAccountID = State(initialValue: nil)
            _toAccountID = State(initialValue: nil)
        } else if let transaction, transaction.isLoanReceived {
            // Borrowings re-open in the income form they were created from.
            _kind = State(initialValue: .income)
            _category = State(initialValue: .loanReceived)
            _accountID = State(initialValue: transaction.toAccountID)
            _debtAccountID = State(initialValue: transaction.fromAccountID)
            _fromAccountID = State(initialValue: nil)
            _toAccountID = State(initialValue: nil)
        } else {
            _kind = State(initialValue: transaction?.kind ?? .expense)
            _category = State(initialValue: transaction?.category ?? .groceries)
            // New entries default to the first regular account, so money
            // comes from somewhere unless the user says otherwise.
            _accountID = State(initialValue: transaction?.accountID ?? defaultAccountID)
            _fromAccountID = State(initialValue: transaction?.fromAccountID)
            _toAccountID = State(initialValue: transaction?.toAccountID)
            _debtAccountID = State(initialValue: nil)
        }
    }

    /// Transfer endpoint picker: existing accounts + "New Account…" which
    /// reveals an inline name field.
    @ViewBuilder
    private func accountRow(
        _ label: String,
        selection: Binding<UUID?>,
        newName: Binding<String>
    ) -> some View {
        Picker(label, selection: selection) {
            Text("Choose…").tag(UUID?.none)
            ForEach(store.accounts) { account in
                Text(account.name).tag(UUID?.some(account.id))
            }
            Divider()
            Label("New Account…", systemImage: "plus").tag(UUID?.some(Self.newAccountSentinel))
        }
        .pickerStyle(.menu)

        if selection.wrappedValue == Self.newAccountSentinel {
            TextField("\(label) name", text: newName, prompt: Text("e.g. Kapital Visa"))
        }
    }

    /// The final endpoint names, used for validation only.
    private func endpointName(selection: UUID?, typed: String) -> String {
        if selection == Self.newAccountSentinel {
            return typed.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return store.account(selection)?.name ?? ""
    }

    private var resolvedFrom: String { endpointName(selection: fromAccountID, typed: newFromName) }
    private var resolvedTo: String { endpointName(selection: toAccountID, typed: newToName) }

    var body: some View {
        FTSheet(
            title: editing == nil ? "New Transaction" : "Edit Transaction",
            saveTitle: editing == nil ? "Add" : "Save",
            canSave: canSave,
            onSave: save
        ) {
            TextField("Title", text: $title, prompt: Text("What was it for?"))

            HStack(spacing: 10) {
                TextField("Amount", value: $amount, format: .amount, prompt: Text("0"))
                    .monospacedDigit()
                CurrencyPicker(selection: $currency)
                    .labelsHidden()
                    .fixedSize()
            }
            if let amount, !FTFormat.isValidAmount(amount) {
                Text("Enter an amount above 0.")
                    .font(.system(size: 12))
                    .foregroundStyle(FT.expense)
            }

            Picker("Kind", selection: $kind) {
                ForEach(TransactionKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)

            if kind == .transfer {
                accountRow("From account", selection: $fromAccountID, newName: $newFromName)
                accountRow("To account", selection: $toAccountID, newName: $newToName)
                if !resolvedFrom.isEmpty, resolvedFrom.caseInsensitiveCompare(resolvedTo) == .orderedSame {
                    Text("Choose two different accounts.")
                        .font(.system(size: 12))
                        .foregroundStyle(FT.expense)
                }
                if let destination = crossCurrencyDestination {
                    // Fix what arrived, so a later rate edit never re-prices it.
                    HStack(spacing: 10) {
                        TextField("Amount received", value: Binding(
                            get: { receivedAmount ?? suggestedReceived },
                            set: { receivedAmount = $0; receivedEdited = true }
                        ), format: .amount, prompt: Text("0"))
                            .monospacedDigit()
                        Text(destination.currency.rawValue)
                            .foregroundStyle(.secondary)
                    }
                    Text("\(destination.name) is in \(destination.currency.rawValue). At your current rate that's \(store.format(suggestedReceived, in: destination.currency)); edit it to what the bank actually credited.")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            } else {
                Picker("Category", selection: $category) {
                    ForEach(availableCategories) { category in
                        Label(category.title, systemImage: category.icon).tag(category)
                    }
                }
                .pickerStyle(.menu)

                if isDebtPaymentEntry {
                    Picker("Pay toward", selection: $debtAccountID) {
                        Text("Choose debt…").tag(UUID?.none)
                        ForEach(debtAccounts) { debt in
                            Text("\(debt.name) — \(store.format(abs(store.balance(of: debt)), in: debt.currency)) left")
                                .tag(UUID?.some(debt.id))
                        }
                    }
                    .pickerStyle(.menu)

                    if debtAccounts.isEmpty {
                        Text("The debt this payment went to no longer exists. Add a debt account, or change the category.")
                            .font(.system(size: 12))
                            .foregroundStyle(FT.expense)
                    }

                    if let debt = store.account(debtAccountID) {
                        let remaining = abs(min(0, store.balance(of: debt)))
                        if remaining > 0 {
                            Button("Pay in full — \(store.format(remaining, in: debt.currency))") {
                                amount = remaining
                                currency = debt.currency
                            }
                            .buttonStyle(.link)
                        }
                    }
                }

                if isLoanEntry {
                    Picker("From debt", selection: $debtAccountID) {
                        Text("Choose debt…").tag(UUID?.none)
                        ForEach(debtAccounts) { debt in
                            Text("\(debt.name) — owes \(store.format(abs(min(0, store.balance(of: debt))), in: debt.currency))")
                                .tag(UUID?.some(debt.id))
                        }
                        Divider()
                        Label("New Debt…", systemImage: "plus").tag(UUID?.some(Self.newAccountSentinel))
                    }
                    .pickerStyle(.menu)

                    if debtAccountID == Self.newAccountSentinel {
                        TextField("Debt name", text: $newDebtName, prompt: Text("e.g. Bank loan"))
                        if newDebtNameClashes {
                            Text("An account named \u{201C}\(newDebtName.trimmingCharacters(in: .whitespacesAndNewlines))\u{201D} already exists and isn't a debt.")
                                .font(.system(size: 12))
                                .foregroundStyle(FT.expense)
                        }
                    }
                }

                if !store.accounts.isEmpty {
                    Picker(accountRowLabel, selection: $accountID) {
                        // Debt payments and loans move real money between
                        // accounts, so they need a real source/destination.
                        Text(requiresAccount ? "Choose account…" : "None").tag(UUID?.none)
                        ForEach(store.accounts.filter { $0.kind == .regular }) { account in
                            Text(account.name).tag(UUID?.some(account.id))
                        }
                    }
                    .pickerStyle(.menu)
                } else if requiresAccount {
                    Text("Add a regular account first — the money has to come from (or land on) somewhere.")
                        .font(.system(size: 12))
                        .foregroundStyle(FT.expense)
                }
            }

            DatePicker("Date", selection: $date, displayedComponents: [.date, .hourAndMinute])

            TextField("Note", text: $note, prompt: Text("Optional details"))
        }
        .onChange(of: kind) { _, newKind in
            // The debt picker belongs to one flow; never carry a "New Debt…"
            // placeholder from the loan form into the payment form.
            debtAccountID = nil
            switch newKind {
            case .transfer:
                category = .transfer
            case .income:
                if !Category.incomeCategories.contains(category) {
                    category = Category.incomeCategories.first ?? .other
                }
            case .expense:
                if !Category.expenseCategories.contains(category) {
                    category = Category.expenseCategories.first ?? .other
                }
            }
        }
        .onChange(of: category) { _, _ in
            debtAccountID = nil
        }
        .onChange(of: fromAccountID) { _, new in
            // A transfer is usually typed in the source account's currency.
            if editing == nil, let source = store.account(new) { currency = source.currency }
        }
        .onChange(of: accountID) { _, new in
            if editing == nil, let account = store.account(new) { currency = account.currency }
        }
    }

    /// The destination account when it holds a different currency than the
    /// amount typed — only then does "amount received" need asking.
    private var crossCurrencyDestination: Account? {
        guard kind == .transfer, let destination = store.account(toAccountID), destination.currency != currency else { return nil }
        return destination
    }

    private var suggestedReceived: Double {
        guard let destination = crossCurrencyDestination else { return 0 }
        return store.convert(amount ?? 0, from: currency, to: destination.currency)
    }

    private var availableCategories: [Category] {
        var list = kind == .income ? Category.incomeCategories : Category.expenseCategories
        // "Debt payment" only makes sense once a debt account exists — unless
        // this entry already is one (its debt was deleted): keep it listed so
        // the picker never shows blank.
        if debtAccounts.isEmpty && category != .debtPayment {
            list.removeAll { $0 == .debtPayment }
        }
        return list
    }

    /// Debt payments need a source account; loans need a deposit account.
    private var requiresAccount: Bool { isDebtPaymentEntry || isLoanEntry }

    /// The chosen debt, only when it really is a debt account (never the
    /// "New Debt…" placeholder, never a regular account).
    private var selectedDebt: Account? {
        guard let debt = store.account(debtAccountID), debt.kind == .debt else { return nil }
        return debt
    }

    private var newDebtNameClashes: Bool {
        let name = newDebtName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return false }
        return store.accounts.contains { $0.kind != .debt && $0.name.caseInsensitiveCompare(name) == .orderedSame }
    }

    private var debtAccounts: [Account] {
        store.accounts.filter { $0.kind == .debt }
    }

    /// Expense form with the "Debt payment" category selected.
    private var isDebtPaymentEntry: Bool {
        kind == .expense && category == .debtPayment
    }

    /// Income form with the "Loan received" category selected.
    private var isLoanEntry: Bool {
        kind == .income && category == .loanReceived
    }

    private var accountRowLabel: String {
        if isDebtPaymentEntry { return "From account" }
        if isLoanEntry { return "Deposit to" }
        return "Account"
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSave: Bool {
        guard !trimmedTitle.isEmpty, FTFormat.isValidAmount(amount) else { return false }
        if kind == .transfer {
            if crossCurrencyDestination != nil, receivedEdited, !FTFormat.isValidAmount(receivedAmount) { return false }
            return !resolvedFrom.isEmpty
                && !resolvedTo.isEmpty
                && resolvedFrom.caseInsensitiveCompare(resolvedTo) != .orderedSame
        }
        if isDebtPaymentEntry {
            // A real debt AND a real source account — otherwise the money
            // would leave nowhere and the balance would go up.
            return selectedDebt != nil && store.account(accountID)?.kind == .regular
        }
        if isLoanEntry {
            guard store.account(accountID)?.kind == .regular else { return false }
            if debtAccountID == Self.newAccountSentinel {
                return !newDebtName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !newDebtNameClashes
            }
            return selectedDebt != nil
        }
        return true
    }

    private func save() {
        guard let amount, FTFormat.isValidAmount(amount) else { return }

        var fromID = fromAccountID
        var toID = toAccountID
        var storedKind = kind
        var storedCategory = kind == .transfer ? Category.transfer : category

        if kind == .transfer {
            if fromID == Self.newAccountSentinel {
                fromID = store.createAccount(named: newFromName, currency: currency).id
            }
            if toID == Self.newAccountSentinel {
                toID = store.createAccount(named: newToName, currency: currency).id
            }
        } else if isDebtPaymentEntry {
            // A debt payment is a transfer under the hood: source account →
            // debt account. Stats still count it as spending.
            storedKind = .transfer
            storedCategory = .debtPayment
            fromID = accountID
            toID = selectedDebt?.id
        } else if isLoanEntry {
            // Borrowing: debt account → deposit account. The debt deepens,
            // the card grows, net worth stays honest. Income stats untouched.
            storedKind = .transfer
            storedCategory = .loanReceived
            var debtID = selectedDebt?.id
            if debtAccountID == Self.newAccountSentinel {
                debtID = store.createAccount(named: newDebtName, currency: currency, kind: .debt).id
            }
            fromID = debtID
            toID = accountID
        }

        let isTransferForm = storedKind == .transfer

        // Received amount only for cross-currency transfers; nil otherwise so
        // same-currency moves stay exact.
        var storedToAmount: Double? = nil
        var storedToCurrency: CurrencyCode? = nil
        if let destination = crossCurrencyDestination {
            storedToAmount = receivedEdited ? receivedAmount : suggestedReceived
            storedToCurrency = destination.currency
        }

        let transaction = Transaction(
            id: editing?.id ?? UUID(),
            title: trimmedTitle,
            amount: amount,
            currency: currency,
            category: storedCategory,
            kind: storedKind,
            date: date,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            accountID: isTransferForm ? nil : accountID,
            fromAccountID: isTransferForm ? fromID : nil,
            toAccountID: isTransferForm ? toID : nil,
            // Names duplicated for JSON readability + pre-account file compat.
            fromAccount: isTransferForm ? store.account(fromID)?.name : nil,
            toAccount: isTransferForm ? store.account(toID)?.name : nil,
            toAmount: storedToAmount,
            toCurrency: storedToCurrency
        )
        if editing == nil {
            store.addTransaction(transaction)
        } else {
            store.updateTransaction(transaction)
        }
    }
}
