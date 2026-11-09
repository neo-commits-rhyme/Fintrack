import SwiftUI
import UniformTypeIdentifiers

/// A statement that has been read and is waiting for review.
struct PendingStatementImport: Identifiable {
    let id = UUID()
    var rows: [StatementRow]

    static let fileTypes: [UTType] = [UTType(filenameExtension: "xlsx") ?? .data]
}

/// Review step: every statement row with a suggested category; nothing is
/// saved until Import.
struct BankImportSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private enum CardTarget: Hashable {
        case existing(UUID)
        case new
    }

    private let rowCount: Int
    private let regularAccounts: [Account]
    private let newAccountName: String

    @State private var review: ImportReview
    @State private var card: CardTarget
    @State private var cashSourceID: UUID?

    private static let expenseOptions = Category.expenseCategories.filter { $0 != .debtPayment }
    private static let incomeOptions = Category.incomeCategories.filter { $0 != .loanReceived }

    init(rows: [StatementRow], accounts: [Account], existingImportIDs: Set<String>) {
        let regular = accounts.filter { $0.kind == .regular }
        let last4 = rows.first { !$0.cardLast4.isEmpty }?.cardLast4
        let newName = last4.map { "Card •\($0)" } ?? "Bank card"
        // The card's own account from an earlier import beats any other UZS one.
        let defaultCard = regular.first { $0.name == newName } ?? regular.first {
            // A statement is a card's history: never default it onto a cash wallet.
            let lowered = $0.name.lowercased()
            return $0.currency == .uzs && !lowered.contains("cash") && !lowered.contains("налич")
        }
        let defaultCash = regular.first { account in
            let name = account.name.lowercased()
            return account.id != defaultCard?.id && (name.contains("cash") || name.contains("налич"))
        }

        rowCount = rows.count
        regularAccounts = regular
        newAccountName = newName
        _card = State(initialValue: defaultCard.map { .existing($0.id) } ?? .new)
        _cashSourceID = State(initialValue: defaultCash?.id)
        _review = State(initialValue: ImportReview(
            rows: rows, existingImportIDs: existingImportIDs, hasCashSource: defaultCash != nil
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Import Bank Statement")
                .font(.system(size: 20, weight: .semibold))
                .padding(.top, 22)
            Text(summary)
                .font(FT.captionFont)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .padding(.top, 4)
                .padding(.bottom, 14)

            GlassCard(cornerRadius: FT.smallRadius, padding: 12) {
                HStack(spacing: 24) {
                    cardPicker
                    cashPicker
                }
            }
            .padding(.horizontal, 20)

            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(review.drafts) { draft in
                        row(for: draft)
                        if draft.id != review.drafts.last?.id {
                            Divider().padding(.horizontal, 8)
                        }
                    }
                }
                .padding(8)
            }
            .glassCard(cornerRadius: FT.smallRadius)
            .padding(.horizontal, 20)
            .padding(.top, 12)

            HStack {
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button {
                    save()
                } label: {
                    Text("Import \(review.importCount)")
                        .monospacedDigit()
                        .foregroundStyle(review.importCount > 0 ? AnyShapeStyle(FT.accentForeground) : AnyShapeStyle(.secondary))
                }
                .buttonStyle(.glassProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(review.importCount == 0)
            }
            .padding(20)
        }
        .frame(minWidth: 680, idealWidth: 760, maxWidth: 1100, minHeight: 480, idealHeight: 640, maxHeight: 1000)
        .presentationSizing(.fitted)
    }

    private var summary: String {
        "\(rowCount) \(rowCount == 1 ? "row" : "rows") · \(review.importCount) will be imported"
    }

    // MARK: Pickers

    private var cardPicker: some View {
        Picker("Card account", selection: Binding(get: { card }, set: pickCard)) {
            ForEach(regularAccounts) { account in
                Text(account.name).tag(CardTarget.existing(account.id))
            }
            Text("New account \u{201C}\(newAccountName)\u{201D}").tag(CardTarget.new)
        }
        .pickerStyle(.menu)
    }

    private var cashPicker: some View {
        Picker("Cash deposits come from", selection: Binding(get: { cashSourceID }, set: pickCashSource)) {
            Text("Don't import cash deposits").tag(UUID?.none)
            ForEach(regularAccounts.filter { card != .existing($0.id) }) { account in
                Text(account.name).tag(UUID?.some(account.id))
            }
        }
        .pickerStyle(.menu)
    }

    private func pickCard(_ target: CardTarget) {
        card = target
        // Money can't move from an account into itself.
        if case .existing(let id) = target, id == cashSourceID { pickCashSource(nil) }
    }

    private func pickCashSource(_ id: UUID?) {
        cashSourceID = id
        review.setHasCashSource(id != nil)
    }

    // MARK: Rows

    private func row(for draft: ImportDraft) -> some View {
        let isOn = review.willImport(draft)
        return HStack(spacing: 12) {
            Toggle("Include \(draft.title)", isOn: Binding(
                get: { isOn },
                set: { review.setInclude(line: draft.id, $0) }
            ))
            .toggleStyle(.checkbox)
            .labelsHidden()
            .disabled(review.isToggleDisabled(draft))

            VStack(alignment: .leading, spacing: 2) {
                Text(draft.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(isOn ? .primary : .secondary)
                    .lineLimit(1)
                Text(dateText(draft.row.date))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .lineLimit(1)
                if let reason = review.displayReason(draft) {
                    Text(reason)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Spacer(minLength: 12)

            Text(amountText(draft))
                .font(.system(size: 14, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(!isOn ? AnyShapeStyle(.secondary) : (draft.kind == .income ? AnyShapeStyle(FT.income) : AnyShapeStyle(.primary)))
                .lineLimit(1)
                .fixedSize()

            categoryControl(for: draft)
                .frame(width: 160, alignment: .leading)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background {
            if draft.needsAttention {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.orange.opacity(0.12))
            }
        }
    }

    @ViewBuilder
    private func categoryControl(for draft: ImportDraft) -> some View {
        if draft.kind == .transfer {
            Text("Transfer")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.leading, 8)
        } else {
            Picker("Category for \(draft.title)", selection: Binding(
                get: { draft.category },
                set: { review.setCategory(line: draft.id, $0) }
            )) {
                ForEach(draft.kind == .income ? Self.incomeOptions : Self.expenseOptions) { category in
                    Text(category.title).tag(category)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .disabled(review.isLocked(draft))
        }
    }

    private func dateText(_ date: Date) -> String {
        let time = Calendar.current.dateComponents([.hour, .minute], from: date)
        return "\(FTFormat.dayLabel(date)), \(String(format: "%02d:%02d", time.hour ?? 0, time.minute ?? 0))"
    }

    private func amountText(_ draft: ImportDraft) -> String {
        let sign = draft.row.credit ? (draft.kind == .transfer ? "" : "+") : "−"
        return sign + FTFormat.money(draft.row.amount, currency: .uzs)
    }

    // MARK: Save

    private func save() {
        let accountID: UUID
        switch card {
        case .existing(let id): accountID = id
        case .new: accountID = store.createAccount(named: newAccountName, currency: .uzs).id
        }
        store.importTransactions(BankImport.buildTransactions(review.drafts, accountID: accountID, cashSourceID: cashSourceID))
        dismiss()
    }
}
