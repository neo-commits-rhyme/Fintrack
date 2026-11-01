import SwiftUI

/// Settings: display currency, a read-only glance at exchange rates,
/// data management (reset / erase), and the about card.
struct SettingsView: View {
    @Environment(AppStore.self) private var store

    @State private var isConfirmingReset = false
    @State private var isConfirmingErase = false

    var body: some View {
        FTScreen("Settings", subtitle: "Currency, rates and data") {
            VStack(alignment: .leading, spacing: FT.gridSpacing) {
                displayCurrencyCard
                exchangeRatesCard
                dataCard
                aboutCard
            }
            .frame(maxWidth: 680, alignment: .leading)
        }
    }

    // MARK: Display currency

    private var displayCurrencyCard: some View {
        @Bindable var store = store

        return GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                cardTitle("Display currency")

                Text("Every total in Fintrack is shown in this currency, converted with your rates.")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Picker("Display currency", selection: $store.displayCurrency) {
                    ForEach(CurrencyCode.allCases) { code in
                        Text("\(code.flag) \(code.rawValue) — \(code.displayName)")
                            .tag(code)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .fixedSize()
                .padding(.top, 2)

                Text("Example: your balance is \(Text(store.format(store.balance, in: store.displayCurrency)).fontWeight(.semibold).monospacedDigit())")
                .font(FT.captionFont)
                .foregroundStyle(.secondary)
                .contentTransition(.numericText())
                .animation(.snappy, value: store.displayCurrency)
            }
        }
    }

    // MARK: Exchange rates

    private var exchangeRatesCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                cardTitle("Exchange rates")

                Text("Fintrack never fetches rates from the internet — every conversion uses the rates you set yourself.")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 8) {
                    rateRow(for: .usd)
                    rateRow(for: .eur)
                }
                .padding(.vertical, 2)

                Label("Edit any rate in Converter → Your exchange rates.", systemImage: "arrow.left.arrow.right.circle")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func rateRow(for code: CurrencyCode) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text("\(code.flag) 1 \(code.rawValue)")
                .font(FT.bodyFont)
            Spacer()
            Text("= \(store.format(currentRate(for: code), in: .uzs))")
                .font(FT.bodyFont)
                .fontWeight(.semibold)
                .monospacedDigit()
                .contentTransition(.numericText())
        }
        .animation(.snappy, value: currentRate(for: code))
    }

    private func currentRate(for code: CurrencyCode) -> Double {
        store.rates[code] ?? CurrencyCode.defaultRates[code] ?? 1
    }

    // MARK: Data

    private var dataCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 14) {
                cardTitle("Data")

                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Button("Load sample data") {
                        isConfirmingReset = true
                    }
                    .buttonStyle(.glass)
                    .confirmationDialog(
                        "Load sample data?",
                        isPresented: $isConfirmingReset,
                        titleVisibility: .visible
                    ) {
                        Button("Load Sample Data") {
                            store.resetToSampleData()
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Your accounts, transactions, budgets and goals will be replaced with a demo dataset. Your display currency and exchange rates are kept.")
                    }

                    Text("Replaces everything with a demo dataset — handy for a quick tour.")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 0)
                }

                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Button("Erase all data", role: .destructive) {
                        isConfirmingErase = true
                    }
                    .buttonStyle(.glass)
                    .tint(FT.expense)
                    .confirmationDialog(
                        "Erase all data?",
                        isPresented: $isConfirmingErase,
                        titleVisibility: .visible
                    ) {
                        Button("Erase Everything", role: .destructive) {
                            store.eraseAll()
                        }
                        Button("Cancel", role: .cancel) {}
                    } message: {
                        Text("Every account, transaction, budget and goal will be permanently deleted. Your display currency and exchange rates are kept. This cannot be undone.")
                    }

                    Text("Removes every account, transaction, budget and goal. This cannot be undone.")
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)

                    Spacer(minLength: 0)
                }
            }
        }
    }

    // MARK: About

    private var aboutCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    appMark
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Fintrack 1.0")
                            .font(.system(size: 17, weight: .semibold))
                        Text("Personal finance for macOS")
                            .font(FT.captionFont)
                            .foregroundStyle(.secondary)
                    }
                }

                Text("Personal finance for macOS — budgets, goals and a converter that trusts your rates. Built with SwiftUI and Liquid Glass.")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Text(countsLine)
                    .font(FT.captionFont)
                    .foregroundStyle(.tertiary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: countsLine)
            }
        }
    }

    private var appMark: some View {
        Image(systemName: "creditcard.fill")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 44, height: 44)
            .background(
                LinearGradient(
                    colors: [FT.accent, FT.accentDeep],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: .rect(cornerRadius: 12)
            )
    }

    private var countsLine: String {
        [
            pluralized(store.transactions.count, "transaction"),
            pluralized(store.budgets.count, "budget"),
            pluralized(store.goals.count, "goal"),
            pluralized(store.accounts.count, "account"),
        ]
        .joined(separator: " · ")
    }

    private func pluralized(_ count: Int, _ noun: String) -> String {
        "\(count) \(noun)\(count == 1 ? "" : "s")"
    }

    // MARK: Shared bits

    private func cardTitle(_ title: String) -> some View {
        Text(title)
            .font(FT.taglineFont)
            .kerning(-0.2)
    }
}
