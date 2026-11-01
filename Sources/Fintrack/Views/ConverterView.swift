import SwiftUI
import Foundation

/// The signature screen: instant conversion between all seven currencies,
/// cross-rated through UZS with rates the user fully controls.
struct ConverterView: View {
    @Environment(AppStore.self) private var store

    @State private var amount: Double? = 100
    @State private var fromCurrency: CurrencyCode = .usd
    @State private var toCurrency: CurrencyCode = .uzs
    @State private var isConfirmingReset = false
    @State private var swapRotation = 0.0

    private static let editableCurrencies = CurrencyCode.allCases.filter { $0 != .uzs }

    /// The amount actually converted — never negative, never nil.
    private var effectiveAmount: Double { max(0, amount ?? 0) }

    private var convertedValue: Double {
        store.convert(effectiveAmount, from: fromCurrency, to: toCurrency)
    }

    private var resultText: String {
        store.format(convertedValue, in: toCurrency)
    }

    var body: some View {
        FTScreen("Converter", subtitle: "Your rates, your rules") {
            heroCard

            SectionHeader("Everything at once")
            allCurrenciesCard

            SectionHeader("Your exchange rates", subtitle: "UZS per 1 unit — edit anytime")
            ratesCard
        }
        .onAppear {
            let preferred = store.displayCurrency
            toCurrency = preferred == fromCurrency ? .uzs : preferred
        }
        .onChange(of: fromCurrency) { old, new in
            guard new == toCurrency else { return }
            withAnimation(.snappy) { toCurrency = old }
        }
        .onChange(of: toCurrency) { old, new in
            guard new == fromCurrency else { return }
            withAnimation(.snappy) { fromCurrency = old }
        }
    }

    // MARK: Hero converter

    private var heroCard: some View {
        GlassCard(padding: 28) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(alignment: .center, spacing: FT.gridSpacing) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Amount")
                            .font(FT.captionFont)
                            .foregroundStyle(.secondary)
                        TextField("0", value: $amount, format: .number)
                            .textFieldStyle(.plain)
                            .font(.system(size: 30, weight: .semibold))
                            .monospacedDigit()
                    }
                    Spacer(minLength: FT.gridSpacing)
                    CurrencyPicker(label: "From", selection: $fromCurrency)
                        .labelsHidden()
                        .fixedSize()
                }

                HStack(spacing: 14) {
                    Rectangle()
                        .fill(.quaternary)
                        .frame(height: 1)
                    Button(action: swapCurrencies) {
                        Image(systemName: "arrow.up.arrow.down")
                            .font(.system(size: 13, weight: .semibold))
                            .frame(width: 18, height: 18)
                            .rotationEffect(.degrees(swapRotation))
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .help("Swap currencies")
                    .accessibilityLabel("Swap currencies")
                    Rectangle()
                        .fill(.quaternary)
                        .frame(height: 1)
                }

                HStack(alignment: .center, spacing: FT.gridSpacing) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Converted")
                            .font(FT.captionFont)
                            .foregroundStyle(.secondary)
                        Text(resultText)
                            .font(FT.heroNumberFont)
                            .monospacedDigit()
                            .kerning(-0.5)
                            .lineLimit(1)
                            .minimumScaleFactor(0.45)
                            .contentTransition(.numericText(value: convertedValue))
                    }
                    Spacer(minLength: FT.gridSpacing)
                    CurrencyPicker(label: "To", selection: $toCurrency)
                        .labelsHidden()
                        .fixedSize()
                }
                .animation(.snappy, value: resultText)

                Text(crossRateCaption)
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .animation(.snappy, value: crossRateCaption)
            }
        }
    }

    private func swapCurrencies() {
        withAnimation(.snappy) {
            let previousFrom = fromCurrency
            fromCurrency = toCurrency
            toCurrency = previousFrom
            swapRotation += 180
        }
    }

    /// "1 USD = 12 110 soʻm  ·  1 UZS = $0.0000826" — both directions, always live.
    private var crossRateCaption: String {
        let forward = rateString(store.convert(1, from: fromCurrency, to: toCurrency), in: toCurrency)
        let backward = rateString(store.convert(1, from: toCurrency, to: fromCurrency), in: fromCurrency)
        return "1 \(fromCurrency.rawValue) = \(forward)  ·  1 \(toCurrency.rawValue) = \(backward)"
    }

    /// Formats a unit rate, widening precision for tiny values so they never collapse to zero
    /// (about three significant digits below 1, plain money formatting above).
    private func rateString(_ value: Double, in code: CurrencyCode) -> String {
        guard value.isFinite, value > 0 else { return FTFormat.money(0, currency: code) }
        let decimals: Int
        switch value {
        case 1000...: decimals = 0
        case 1...: decimals = 2
        default: decimals = min(8, -Int(floor(log10(value))) + 2)
        }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true  // POSIX locale turns this off
        formatter.groupingSeparator = code.symbolLeading ? "," : "\u{00A0}"
        formatter.decimalSeparator = code.symbolLeading ? "." : ","
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = decimals
        let magnitude = formatter.string(from: NSNumber(value: value)) ?? "0"
        return code.symbolLeading
            ? "\(code.symbol)\(magnitude)"
            : "\(magnitude)\u{00A0}\(code.symbol)"
    }

    // MARK: Everything at once

    private var allCurrenciesCard: some View {
        GlassCard {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), spacing: FT.gridSpacing)],
                alignment: .leading,
                spacing: FT.gridSpacing
            ) {
                ForEach(CurrencyCode.allCases.filter { $0 != fromCurrency }) { code in
                    ConversionCell(code: code, amount: effectiveAmount, from: fromCurrency)
                }
            }
            .animation(.snappy, value: effectiveAmount)
            .animation(.snappy, value: fromCurrency)
            .animation(.snappy, value: store.rates)
        }
    }

    // MARK: Exchange rates

    private var ratesCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Self.editableCurrencies) { code in
                    RateRow(code: code)
                    Divider()
                }
                ratesFooter
            }
        }
    }

    private var ratesFooter: some View {
        HStack(spacing: FT.gridSpacing) {
            Text("All conversions cross through UZS.")
                .font(FT.captionFont)
                .foregroundStyle(.secondary)
            Spacer()
            Button("Reset to defaults") {
                isConfirmingReset = true
            }
            .buttonStyle(.glass)
        }
        .padding(.top, 14)
        .confirmationDialog(
            "Reset exchange rates?",
            isPresented: $isConfirmingReset,
            titleVisibility: .visible
        ) {
            Button("Reset to Defaults", role: .destructive) {
                withAnimation(.snappy) { store.resetRatesToDefaults() }
            }
            Button("Keep My Rates", role: .cancel) {}
        } message: {
            Text("Every currency goes back to Fintrack's built-in rate. Rates you've entered yourself will be replaced.")
        }
    }
}

// MARK: - Conversion cell

/// One currency in the "Everything at once" grid: flag, code, and the live-converted amount.
private struct ConversionCell: View {
    var code: CurrencyCode
    var amount: Double
    var from: CurrencyCode
    @Environment(AppStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text(code.flag)
                Text(code.rawValue)
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
            }
            Text(store.format(store.convert(amount, from: from, to: code), in: code))
                .font(.system(size: 17, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Rate row

/// One editable exchange rate: flag, code, full name, and a "1 XXX = ____ soʻm" field.
private struct RateRow: View {
    var code: CurrencyCode
    @Environment(AppStore.self) private var store
    /// Bumped when invalid input is rejected so the field re-reads the real rate
    /// instead of keeping the rejected text on screen.
    @State private var revertTick = 0

    private var rateBinding: Binding<Double> {
        Binding(
            get: { store.rates[code] ?? 1 },
            set: { newValue in
                if FTFormat.isValidRate(newValue) {
                    store.setRate(newValue, for: code)
                } else {
                    revertTick += 1
                }
            }
        )
    }

    var body: some View {
        HStack(spacing: 12) {
            Text(code.flag)
                .font(.system(size: 22))
            VStack(alignment: .leading, spacing: 2) {
                Text(code.rawValue)
                    .font(.system(size: 15, weight: .semibold))
                Text(code.displayName)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: FT.gridSpacing)
            HStack(spacing: 8) {
                Text("1 \(code.rawValue) =")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                TextField("Rate", value: rateBinding, format: .number)
                    .textFieldStyle(.roundedBorder)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .frame(width: 110)
                    .accessibilityLabel("UZS per 1 \(code.rawValue)")
                    .id("\(code.rawValue)-\(revertTick)")
                Text("soʻm")
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 10)
    }
}
