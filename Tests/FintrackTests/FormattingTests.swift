import Testing
import Foundation
@testable import Fintrack

private let nbsp = "\u{00A0}"
private let minus = "\u{2212}"

@Suite("FTFormat and Date helpers")
struct FormattingTests {

    // MARK: money — symbol placement and grouping

    @Test func prefixCurrenciesUseCommaGroupingAndDot() {
        #expect(FTFormat.money(1_234.5, currency: .usd) == "$1,234.50")
        #expect(FTFormat.money(1_234_567, currency: .usd) == "$1,234,567")
        #expect(FTFormat.money(1_368.1, currency: .gbp) == "£1,368.10")
        #expect(FTFormat.money(999, currency: .eur) == "€999")
        #expect(FTFormat.money(1_000_000, currency: .jpy) == "¥1,000,000")
        #expect(FTFormat.money(1_234.56, currency: .jpy) == "¥1,235")
    }

    @Test func suffixCurrenciesUseNoBreakSpaceGroupingAndComma() {
        #expect(FTFormat.money(12_110, currency: .uzs) == "12\(nbsp)110\(nbsp)soʻm")
        #expect(FTFormat.money(23_380_412, currency: .uzs) == "23\(nbsp)380\(nbsp)412\(nbsp)soʻm")
        #expect(FTFormat.money(1_234.5, currency: .rub) == "1\(nbsp)234,50\(nbsp)₽")
        #expect(FTFormat.money(500, currency: .kzt) == "500\(nbsp)₸")
        #expect(!FTFormat.money(12_110, currency: .uzs).contains(" "), "must not use a plain breaking space")
    }

    @Test func wholeAmountsHaveNoDecimals() {
        #expect(FTFormat.money(350, currency: .usd) == "$350")
        #expect(FTFormat.money(350, currency: .rub) == "350\(nbsp)₽")
        #expect(FTFormat.money(0, currency: .usd) == "$0")
        #expect(FTFormat.money(0, currency: .uzs) == "0\(nbsp)soʻm")
        // Rounds to a whole number at 2dp → still no decimals.
        #expect(FTFormat.money(0.999, currency: .usd) == "$1")
        #expect(FTFormat.money(1.996, currency: .usd) == "$2")
    }

    @Test func fractionalAmountsAlwaysShowTwoDecimals() {
        #expect(FTFormat.money(1.5, currency: .usd) == "$1.50")
        #expect(FTFormat.money(0.01, currency: .usd) == "$0.01")
        #expect(FTFormat.money(2.99, currency: .usd) == "$2.99")
        #expect(FTFormat.money(1.994, currency: .usd) == "$1.99")
        #expect(FTFormat.money(1_368.1, currency: .eur) == "€1,368.10")
    }

    @Test(arguments: [CurrencyCode.jpy, .uzs, .kzt])
    func zeroDecimalCurrenciesNeverShowDecimals(code: CurrencyCode) {
        for amount in [0.4, 12.75, 1_234.56, 99.99] {
            let s = FTFormat.money(amount, currency: code)
            // Prefix currencies use "." as decimal separator, suffix ones ",".
            let decimalSeparator = code.symbolLeading ? "." : ","
            #expect(!s.contains(decimalSeparator), "\(amount) \(code) → \(s)")
        }
    }

    @Test func negativeUsesUnicodeMinusBeforeSymbol() {
        #expect(FTFormat.money(-45_000, currency: .uzs) == "\(minus)45\(nbsp)000\(nbsp)soʻm")
        #expect(FTFormat.money(-12.5, currency: .usd) == "\(minus)$12.50")
        #expect(!FTFormat.money(-1, currency: .usd).contains("-"), "ASCII hyphen-minus must not be used")
    }

    @Test func tinyNegativesPrintWithoutMinus() {
        #expect(FTFormat.money(-0.001, currency: .uzs) == "0\(nbsp)soʻm")
        #expect(FTFormat.money(-0.001, currency: .usd) == "$0")
        #expect(FTFormat.money(-0.004, currency: .usd) == "$0")
        #expect(FTFormat.money(-0.4, currency: .uzs) == "0\(nbsp)soʻm")
        #expect(FTFormat.money(-0.0, currency: .usd) == "$0")
    }

    @Test
    func halfCentNegativeNeverPrintsMinusZero() {
        let s = FTFormat.money(-0.005, currency: .usd)
        #expect(s == "\(minus)$0.01" || s == "$0", "got \(s)")
    }

    @Test
    func roundingIsHalfAwayFromZero() {
        #expect(FTFormat.money(2.5, currency: .uzs) == "3\(nbsp)soʻm")
        #expect(FTFormat.money(0.125, currency: .usd) == "$0.13")
        #expect(FTFormat.money(12_110.5, currency: .uzs) == "12\(nbsp)111\(nbsp)soʻm")
    }

    @Test func moneyIsLocaleIndependent() {
        // Same output regardless of the machine's locale — formatter pins en_US_POSIX.
        #expect(FTFormat.money(1_234_567.89, currency: .usd) == "$1,234,567.89")
        #expect(FTFormat.money(1_234_567.89, currency: .rub) == "1\(nbsp)234\(nbsp)567,89\(nbsp)₽")
    }

    // MARK: compactMoney

    @Test func compactBelowTenThousandIsFullMoney() {
        #expect(FTFormat.compactMoney(9_999, currency: .uzs) == FTFormat.money(9_999, currency: .uzs))
        #expect(FTFormat.compactMoney(9_999, currency: .uzs) == "9\(nbsp)999\(nbsp)soʻm")
        #expect(FTFormat.compactMoney(1_234.5, currency: .usd) == "$1,234.50")
        #expect(FTFormat.compactMoney(0, currency: .usd) == "$0")
    }

    @Test func compactThresholds() {
        #expect(FTFormat.compactMoney(10_000, currency: .uzs) == "10K\(nbsp)soʻm")
        #expect(FTFormat.compactMoney(12_400, currency: .usd) == "$12.4K")
        #expect(FTFormat.compactMoney(99_950, currency: .usd) == "$100K")
        #expect(FTFormat.compactMoney(999_949, currency: .usd) == "$999.9K")
        #expect(FTFormat.compactMoney(999_950, currency: .usd) == "$1M")
        #expect(FTFormat.compactMoney(12_400_000, currency: .uzs) == "12.4M\(nbsp)soʻm")
        #expect(FTFormat.compactMoney(999_949_999, currency: .usd) == "$999.9M")
        #expect(FTFormat.compactMoney(999_950_000, currency: .usd) == "$1B")
        #expect(FTFormat.compactMoney(2_500_000_000, currency: .usd) == "$2.5B")
        #expect(FTFormat.compactMoney(1_000_000_000_000, currency: .usd) == "$1T")
        #expect(FTFormat.compactMoney(999_950_000_000, currency: .usd) == "$1T")
    }

    @Test func compactNegative() {
        #expect(FTFormat.compactMoney(-10_000, currency: .uzs) == "\(minus)10K\(nbsp)soʻm")
        #expect(FTFormat.compactMoney(-2_500_000, currency: .usd) == "\(minus)$2.5M")
        #expect(FTFormat.compactMoney(-9_999, currency: .usd) == "\(minus)$9,999")
        #expect(FTFormat.compactMoney(-0.001, currency: .usd) == "$0")
    }

    @Test
    func compactMoneyDoesNotCrashOnHugeValues() async {
        await #expect(processExitsWith: .success) {
            _ = FTFormat.compactMoney(1e30, currency: .usd)
            _ = FTFormat.compactMoney(.infinity, currency: .usd)
        }
    }

    // MARK: dayLabel

    @Test func dayLabelTodayYesterday() {
        #expect(FTFormat.dayLabel(Date()) == "Today")
        #expect(FTFormat.dayLabel(Date().startOfDay) == "Today")
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date())!
        #expect(FTFormat.dayLabel(yesterday) == "Yesterday")
        let twoDays = Calendar.current.date(byAdding: .day, value: -2, to: Date())!
        let label = FTFormat.dayLabel(twoDays)
        #expect(label != "Today" && label != "Yesterday")
        #expect(label.hasPrefix(String(Calendar.current.component(.day, from: twoDays))))
    }

    @Test func dayLabelIncludesYearOnlyForOtherYears() {
        let cal = Calendar.current
        let thisYear = cal.component(.year, from: Date())
        let lastYearDate = cal.date(from: DateComponents(year: thisYear - 1, month: 7, day: 12, hour: 12))!
        #expect(FTFormat.dayLabel(lastYearDate).hasSuffix(String(thisYear - 1)))
        // A date earlier this year (not today/yesterday) has no year.
        let tenDaysAgo = cal.date(byAdding: .day, value: -10, to: Date())!
        if cal.component(.year, from: tenDaysAgo) == thisYear {
            #expect(!FTFormat.dayLabel(tenDaysAgo).contains(String(thisYear)))
        }
    }

    // MARK: Date helpers

    @Test func startOfMonth() {
        let cal = Calendar.current
        let d = cal.date(from: DateComponents(year: 2024, month: 2, day: 29, hour: 23, minute: 59, second: 59))!
        let s = d.startOfMonth
        let c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second], from: s)
        #expect(c.year == 2024 && c.month == 2 && c.day == 1)
        #expect(c.hour == 0 && c.minute == 0 && c.second == 0)
        #expect(s.startOfMonth == s)
        #expect(Date().startOfMonth <= Date())
    }

    @Test func startOfDay() {
        let d = Date()
        #expect(d.startOfDay <= d)
        #expect(d.startOfDay.isSameDay(as: d))
        #expect(d.timeIntervalSince(d.startOfDay) < 86_400 + 3_600)
    }

    @Test func isSameMonthAcrossYears() {
        let cal = Calendar.current
        let nov25 = cal.date(from: DateComponents(year: 2025, month: 11, day: 15))!
        let nov26 = cal.date(from: DateComponents(year: 2026, month: 11, day: 15))!
        let nov26b = cal.date(from: DateComponents(year: 2026, month: 11, day: 30, hour: 23))!
        let dec25 = cal.date(from: DateComponents(year: 2025, month: 12, day: 31, hour: 23, minute: 59))!
        let jan26 = cal.date(from: DateComponents(year: 2026, month: 1, day: 1))!
        #expect(!nov25.isSameMonth(as: nov26))
        #expect(nov26.isSameMonth(as: nov26b))
        #expect(!dec25.isSameMonth(as: jan26))
        #expect(dec25.isSameMonth(as: dec25.startOfMonth))
    }

    @Test func isSameDay() {
        let cal = Calendar.current
        let a = cal.date(from: DateComponents(year: 2026, month: 3, day: 1, hour: 0, minute: 0, second: 0))!
        let b = cal.date(from: DateComponents(year: 2026, month: 3, day: 1, hour: 23, minute: 59, second: 59))!
        #expect(a.isSameDay(as: b))
        #expect(!a.isSameDay(as: a.addingTimeInterval(-1)))
    }
}
