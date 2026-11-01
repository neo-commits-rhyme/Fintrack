import Testing
import Foundation
@testable import Fintrack

@Suite("Cross-currency transfers and number entry")
struct ReceivedAmountTests {
    @Test @MainActor func receivedAmountIsFixedWhenRatesChange() {
        let store = makeTempStore()
        let visa = Account(name: "Visa", currency: .usd, openingBalance: 500)
        let cash = Account(name: "Cash", currency: .uzs, openingBalance: 1_000_000)
        store.addAccount(visa)
        store.addAccount(cash)
        store.addTransaction(Transaction(
            title: "Exchange", amount: 100, currency: .usd, category: .transfer, kind: .transfer, date: Date(),
            fromAccountID: visa.id, toAccountID: cash.id, toAmount: 1_231_000, toCurrency: .uzs
        ))
        #expect(store.balance(of: cash) == 2_231_000)
        #expect(store.balance(of: visa) == 400)
        store.setRate(13_000, for: .usd)
        // The soʻm that landed never changes; only live conversions do.
        #expect(store.balance(of: cash) == 2_231_000)
    }

    @Test @MainActor func receivedAmountSurvivesReload() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("fintrack-ra-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("fintrack.json")
        let store = AppStore(dataURL: url)
        let a = Account(name: "A", currency: .usd)
        let b = Account(name: "B", currency: .uzs)
        store.addAccount(a); store.addAccount(b)
        store.addTransaction(Transaction(title: "x", amount: 1, currency: .usd, category: .transfer, kind: .transfer, date: Date(),
                                         fromAccountID: a.id, toAccountID: b.id, toAmount: 12_000, toCurrency: .uzs))
        let reloaded = AppStore(dataURL: url)
        #expect(reloaded.transactions.first?.toAmount == 12_000)
        #expect(reloaded.transactions.first?.toCurrency == .uzs)
        #expect(reloaded.balance(of: b) == 12_000)
    }

    @Test func flexibleNumberAcceptsEitherDecimalMark() throws {
        let parse = FTFormat.FlexibleNumber.Strategy()
        #expect(try parse.parse("40.5") == 40.5)
        #expect(try parse.parse("40,5") == 40.5)
        #expect(try parse.parse("1 234,56") == 1234.56)
        #expect(try parse.parse("1,234.5") == 1234.5)
        #expect(try parse.parse("1,234") == 1234)
        #expect(try parse.parse("12 310") == 12_310)
        #expect(try parse.parse("12'310.25") == 12_310.25)
        #expect(throws: (any Error).self) { try parse.parse("abc") }
        #expect(throws: (any Error).self) { try parse.parse("") }
    }

    @Test func flexibleNumberFormatsCleanly() {
        let f = FTFormat.FlexibleNumber()
        #expect(f.format(40) == "40")
        #expect(f.format(40.5) == "40.5")
        #expect(f.format(40.25) == "40.25")
        #expect(f.format(12_110) == "12110")
        #expect(f.format(.infinity) == "")
    }
}
