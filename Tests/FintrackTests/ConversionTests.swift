import Testing
import Foundation
@testable import Fintrack

@Suite("Currency conversion and rates")
@MainActor
struct ConversionTests {

    @Test(arguments: CurrencyCode.allCases)
    func identityConversion(code: CurrencyCode) {
        let store = makeTempStore()
        #expect(store.convert(123.45, from: code, to: code) == 123.45)
        #expect(store.convert(-7, from: code, to: code) == -7)
    }

    @Test func defaultRatesCoverEveryCurrencyAndUZSIsOne() {
        for code in CurrencyCode.allCases {
            #expect((CurrencyCode.defaultRates[code] ?? 0) > 0, "missing default rate for \(code)")
        }
        #expect(CurrencyCode.defaultRates[.uzs] == 1)
    }

    @Test func toAndFromUZS() {
        let store = makeTempStore()
        #expect(store.convert(1, from: .usd, to: .uzs) == 12_110)
        #expect(store.convert(12_110, from: .uzs, to: .usd) == 1)
        #expect(store.convert(100, from: .kzt, to: .uzs) == 2_350)
    }

    @Test func crossRateGoesThroughUZS() {
        let store = makeTempStore()
        // 1 EUR = 14 150 UZS, 1 USD = 12 110 UZS → 1 EUR = 14150/12110 USD.
        #expect(approx(store.convert(1, from: .eur, to: .usd), 14_150.0 / 12_110))
        #expect(approx(store.convert(1_000, from: .jpy, to: .rub), 1_000 * 82.0 / 155))
        // Round trip is lossless up to floating point.
        let there = store.convert(987.65, from: .gbp, to: .kzt)
        #expect(approx(store.convert(there, from: .kzt, to: .gbp), 987.65))
    }

    @Test func customRatesAreUsed() {
        let store = makeTempStore()
        store.setRate(10_000, for: .usd)
        store.setRate(20_000, for: .eur)
        #expect(store.convert(1, from: .eur, to: .usd) == 2)
        #expect(store.rates[.usd] == 10_000)
    }

    // Invalid rates can never take effect: assigning zero, a negative or a
    // non-finite value through the binding restores the built-in default,
    // so every conversion stays finite and keeps its sign.

    @Test func zeroTargetRateFallsBackToDefault() {
        let store = makeTempStore()
        store.rates[.usd] = 0          // direct binding bypasses setRate
        #expect(store.rates[.usd] == CurrencyCode.defaultRates[.usd])
        let r = store.convert(100, from: .uzs, to: .usd)
        #expect(r.isFinite && r > 0)
    }

    @Test func zeroSourceRateFallsBackToDefault() {
        let store = makeTempStore()
        store.rates[.usd] = 0
        #expect(store.convert(100, from: .usd, to: .uzs) == 100 * 12_110)
    }

    @Test func negativeSourceRateNeverFlipsSign() {
        let store = makeTempStore()
        store.rates[.usd] = -12_110    // direct binding bypasses setRate
        let r = store.convert(100, from: .usd, to: .uzs)
        #expect(r > 0, "converted a positive amount into \(r)")
    }

    @Test func negativeTargetRateFallsBackToDefault() {
        let store = makeTempStore()
        store.rates[.usd] = -5
        #expect(store.rates[.usd] == 12_110)
        #expect(store.convert(100, from: .uzs, to: .usd) > 0)
    }

    @Test func nonFiniteRateIsRejectedEverywhere() {
        let store = makeTempStore()
        store.setRate(.infinity, for: .usd)
        store.setRate(.nan, for: .eur)
        #expect(store.rates[.usd] == 12_110)
        #expect(store.rates[.eur] == 14_150)
        store.rates[.gbp] = .infinity
        #expect(store.rates[.gbp] == 16_320)
    }

    @Test func inDisplayFollowsDisplayCurrency() {
        let store = makeTempStore()
        #expect(store.inDisplay(1, from: .usd) == 12_110)
        store.displayCurrency = .usd
        #expect(store.inDisplay(1, from: .usd) == 1)
        #expect(store.inDisplay(24_220, from: .uzs) == 2)
        #expect(store.formatInDisplay(24_220, from: .uzs) == "$2")
        #expect(store.format(1_234.5, in: .usd) == "$1,234.50")
    }

    @Test func setRateRejectsZeroNegativeNaNAndUZS() {
        let store = makeTempStore()
        store.setRate(0, for: .usd)
        store.setRate(-1, for: .usd)
        store.setRate(.nan, for: .usd)
        #expect(store.rates[.usd] == 12_110)
        store.setRate(5, for: .uzs)
        #expect(store.rates[.uzs] == 1)
        store.setRate(12_500, for: .usd)
        #expect(store.rates[.usd] == 12_500)
    }

    @Test func ratesDidSetForcesUZSToOne() {
        let store = makeTempStore()
        store.rates[.uzs] = 3
        #expect(store.rates[.uzs] == 1)
        store.rates = [.usd: 100, .uzs: 42]
        #expect(store.rates[.uzs] == 1)
        #expect(store.rates[.usd] == 100)
        store.rates = [.usd: 100]       // UZS key missing entirely
        #expect(store.rates[.uzs] == 1)
    }

    @Test func resetRatesToDefaults() {
        let store = makeTempStore()
        store.setRate(1, for: .eur)
        store.resetRatesToDefaults()
        #expect(store.rates == CurrencyCode.defaultRates)
    }

    @Test func rateChangesArePersisted() {
        let url = makeTempDataURL()
        do {
            let store = AppStore(dataURL: url)
            store.setRate(13_000, for: .usd)
        }
        let reopened = AppStore(dataURL: url)
        #expect(reopened.rates[.usd] == 13_000)
        #expect(reopened.rates[.uzs] == 1)
    }

    @Test func currencyMetadata() {
        #expect(CurrencyCode.allCases.count == 7)
        #expect(CurrencyCode.usd.symbolLeading && CurrencyCode.jpy.symbolLeading)
        #expect(!CurrencyCode.uzs.symbolLeading && !CurrencyCode.rub.symbolLeading && !CurrencyCode.kzt.symbolLeading)
        #expect(CurrencyCode.jpy.fractionDigits == 0 && CurrencyCode.uzs.fractionDigits == 0 && CurrencyCode.kzt.fractionDigits == 0)
        #expect(CurrencyCode.usd.fractionDigits == 2 && CurrencyCode.rub.fractionDigits == 2)
        #expect(CurrencyCode(rawValue: "USD") == .usd)
    }
}
