import Testing
import Foundation
@testable import Fintrack

private let fixturesDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()   // FintrackTests
    .deletingLastPathComponent()   // Tests
    .deletingLastPathComponent()   // repo root
    .appendingPathComponent("fixtures", isDirectory: true)

private let fixtureURL = fixturesDirectory.appendingPathComponent("bank-statement-sample.xlsx")
private let expectedURL = fixturesDirectory.appendingPathComponent("bank-statement-sample.expected.json")

private struct ExpectedDraft: Decodable {
    var line: Int
    var localDate: String
    var credit: Bool
    var amount: Double
    var importID: String
    var include: Bool
    var kind: String
    var category: String
    var title: String
    var reason: String?
    var needsAttention: Bool
    var waitsForCashSource: Bool
}

private func fixtureRows() throws -> [StatementRow] {
    try BankImport.parseStatement(XlsxReader.readRows(Data(contentsOf: fixtureURL)))
}

private func fixtureDrafts(hasCashSource: Bool = false, existing: Set<String> = []) throws -> [ImportDraft] {
    BankImport.suggest(try fixtureRows(), existingImportIDs: existing, hasCashSource: hasCashSource)
}

private func xml(_ text: String) -> Data { Data(text.utf8) }

@Suite("xlsx reader")
struct XlsxReaderTests {
    @Test func readsSharedInlineAndNumericCellsAndKeepsColumns() throws {
        let rows = try XlsxReader.readRows(Data(contentsOf: fixtureURL))
        #expect(rows[0][5] == "Сумма платежа")
        #expect(Array(rows[1][0..<3]) == ["07-11-2026", "22:23:59", "Списание"])
        #expect(rows[2][3] == "OOO YANDEXGO UB")   // inline string cell
        #expect(rows[1][7] == "")                  // omitted empty cell keeps its column
        #expect(rows[1][15] == "50420\t")
    }

    @Test func decodesEntitiesAndRichTextRuns() throws {
        let shared = try XlsxReader.parseSharedStrings(xml(
            "<sst><si><t>A &amp; B</t></si><si><r><t>Мульти</t></r><r><t xml:space=\"preserve\"> строка</t></r></si></sst>"
        ))
        #expect(shared == ["A & B", "Мульти строка"])
        let rows = try XlsxReader.parseSheet(
            xml("<sheetData><row r=\"1\"><c r=\"C1\" t=\"s\"><v>1</v></c></row></sheetData>"), shared: shared
        )
        #expect(rows == [["", "", "Мульти строка"]])
    }

    @Test func nonZipFileThrows() {
        #expect(throws: XlsxError.self) { try XlsxReader.readRows(Data("hello".utf8)) }
        do {
            _ = try XlsxReader.readRows(Data("hello".utf8))
        } catch {
            #expect(error.localizedDescription.localizedCaseInsensitiveContains("xlsx"))
        }
    }
}

@Suite("statement parsing")
struct StatementParsingTests {
    @Test func parsesEveryDataRowWithCleanFields() throws {
        let drafts = try fixtureDrafts()
        #expect(drafts.count == 17)
        let transfer = try #require(drafts.first { $0.row.party == "Testova A." })
        #expect(transfer.row.cardLast4 == "1111")
        #expect(transfer.row.localDate == "06-11-2026 22:06:40")
        let parts = Calendar.current.dateComponents([.day, .hour, .minute, .second], from: transfer.row.date)
        #expect([parts.day, parts.hour, parts.minute, parts.second] == [6, 22, 6, 40])
    }

    @Test func refusesASheetWithoutTheAmountColumn() {
        #expect(throws: StatementFormatError.self) { try BankImport.parseStatement([["a", "b"], ["1", "2"]]) }
    }

    @Test func namesMissingColumns() {
        #expect(throws: StatementFormatError.self) { try BankImport.parseStatement([["Сумма платежа", "Категория"]]) }
    }

    @Test func importIDsAreStableAndDistinct() throws {
        let a = try fixtureDrafts(), b = try fixtureDrafts()
        #expect(a.map(\.row.importID) == b.map(\.row.importID))
        #expect(Set(a.map(\.row.importID)).count == a.count)
    }

    @Test func fnvKnownValues() {
        #expect(BankImport.fnv1a64("") == "cbf29ce484222325")
        #expect(BankImport.fnv1a64("a") == "af63dc4c8601ec8c")
    }

    @Test func cleansMerchantNames() {
        #expect(BankImport.cleanMerchantName("OOO INTERNATIONAL FOODCHAIN") == "International Foodchain")
        #expect(BankImport.cleanMerchantName("EDEN SEUL MCHJ XK") == "Eden Seul")
        #expect(BankImport.cleanMerchantName("ELNUR ZIYO BIZNES N777 MCHJ") == "Elnur Ziyo Biznes N777")
        #expect(BankImport.cleanMerchantName("ИП ООО «ANGLESEY FOOD»") == "Anglesey Food")
    }

    @Test func amountsPrintLikeJavaScript() {
        #expect(JSCompat.string(35000) == "35000")
        #expect(JSCompat.string(8_000_000) == "8000000")
        #expect(JSCompat.string(0.1) == "0.1")
        #expect(JSCompat.string(1234.56) == "1234.56")
        #expect(JSCompat.string(0.1 + 0.2) == "0.30000000000000004")
        #expect(JSCompat.string(0.000001) == "0.000001")
        #expect(JSCompat.string(1.5e-7) == "1.5e-7")
        #expect(JSCompat.string(1e20) == "100000000000000000000")
        #expect(JSCompat.string(1e21) == "1e+21")
        #expect(JSCompat.string(1.5e300) == "1.5e+300")
        #expect(JSCompat.string(123456789012345680000) == "123456789012345680000")
    }

    @Test func amountTextParsesLikeJavaScriptNumber() {
        #expect(JSCompat.number("") == 0)
        #expect(JSCompat.number("  12 ") == 12)
        #expect(JSCompat.number("5.") == 5)
        #expect(JSCompat.number(".5") == 0.5)
        #expect(JSCompat.number("1e3") == 1000)
        #expect(JSCompat.number("0x10") == 16)
        #expect(JSCompat.number("12abc") == nil)
        #expect(JSCompat.number("1,5") == nil)
        #expect(JSCompat.number(".") == nil)
    }

    @Test func spacedAndCommaAmountsAndFootersAreHandled() throws {
        let header = ["Дата платежа", "Время платежа", "Тип операции", "Имя поставщика", "Сумма платежа", "Категория"]
        let rows = try BankImport.parseStatement([
            ["Выписка"],
            header,
            ["05.11.2026", "09:30", "Списание", "SHOP", "1 234,50", "магазин"],
            ["Итого", "", "", "", "1234,50", ""],
            ["32-01-2026", "10:00:00", "Списание", "LATE", "5", "магазин"],
        ])
        #expect(rows.count == 2)
        #expect(rows[0].line == 3)
        #expect(rows[0].amount == 1234.5)
        #expect(rows[0].localDate == "05.11.2026 09:30:00")
        #expect(rows[1].line == 5)
        // Out-of-range days roll over, as JS's Date constructor does.
        let parts = Calendar.current.dateComponents([.month, .day], from: rows[1].date)
        #expect([parts.month, parts.day] == [2, 1])
    }
}

@Suite("suggestions")
struct SuggestionTests {
    @Test func matchTheSharedExpectedFixture() throws {
        let expected = try JSONDecoder().decode([ExpectedDraft].self, from: Data(contentsOf: expectedURL))
        let actual = try fixtureDrafts()
        #expect(actual.count == expected.count)
        for (a, e) in zip(actual, expected) {
            #expect(a.row.line == e.line)
            #expect(a.row.localDate == e.localDate)
            #expect(a.row.credit == e.credit)
            #expect(a.row.amount == e.amount)
            #expect(a.row.importID == e.importID)
            #expect(a.include == e.include)
            #expect(a.kind.rawValue == e.kind)
            #expect(a.category.rawValue == e.category)
            #expect(a.title == e.title)
            #expect(a.reason == e.reason)
            #expect(a.needsAttention == e.needsAttention)
            #expect(a.waitsForCashSource == e.waitsForCashSource)
        }
    }

    @Test func pickedCashSourceTurnsCashDepositsOn() throws {
        let cash = try #require(try fixtureDrafts(hasCashSource: true).first { $0.waitsForCashSource })
        #expect(cash.include)
        #expect(cash.reason == nil)
    }

    @Test func rowsAlreadyImportedAreSwitchedOff() throws {
        let first = try fixtureDrafts()
        let again = try fixtureDrafts(existing: Set(first.map(\.row.importID)))
        #expect(again.allSatisfy {
            !$0.include && ($0.reason == BankImport.Reason.duplicate || $0.reason == BankImport.Reason.notCompleted)
        })
    }
}

@Suite("import review")
struct ImportReviewTests {
    private func review(hasCashSource: Bool = false, existing: Set<String> = []) throws -> ImportReview {
        ImportReview(rows: try fixtureRows(), existingImportIDs: existing, hasCashSource: hasCashSource)
    }

    @Test func cashSourceSwitchesUntouchedDepositsOnAndOff() throws {
        var state = try review()
        let line = try #require(state.drafts.first { $0.waitsForCashSource }).id
        func deposit() -> ImportDraft { state.drafts.first { $0.id == line }! }
        let offCount = state.importCount

        state.setHasCashSource(true)
        #expect(deposit().include)
        #expect(deposit().reason == nil)
        #expect(!deposit().needsAttention)
        #expect(state.importCount > offCount)

        state.setHasCashSource(false)
        #expect(!deposit().include)
        #expect(deposit().reason == BankImport.Reason.cashSource)
        #expect(deposit().needsAttention)
        #expect(state.importCount == offCount)
    }

    @Test func aDepositTheUserSwitchedOffStaysOff() throws {
        var state = try review(hasCashSource: true)
        let line = try #require(state.drafts.first { $0.waitsForCashSource }).id
        state.setInclude(line: line, false)
        state.setHasCashSource(false)
        state.setHasCashSource(true)
        #expect(state.drafts.first { $0.id == line }?.include == false)
    }

    @Test func countMatchesWhatGetsBuilt() throws {
        var state = try review(hasCashSource: true)
        let line = try #require(state.drafts.first { $0.waitsForCashSource }).id
        state.setInclude(line: line, true)     // touched, so "no source" leaves include alone
        state.setHasCashSource(false)
        let built = BankImport.buildTransactions(state.drafts, accountID: UUID())
        #expect(state.importCount == built.count)
    }

    @Test func editingACategoryClearsAttention() throws {
        var state = try review()
        let row = try #require(state.drafts.first { $0.reason == BankImport.Reason.uncategorised })
        state.setCategory(line: row.id, .shopping)
        let edited = try #require(state.drafts.first { $0.id == row.id })
        #expect(edited.category == .shopping)
        #expect(!edited.needsAttention)
        #expect(edited.reason == nil)
    }

    @Test func duplicatesAreLocked() throws {
        let ids = Set(try fixtureRows().map(\.importID))
        let state = try review(existing: ids)
        #expect(state.drafts.allSatisfy { state.isLocked($0) && state.isToggleDisabled($0) })
        #expect(state.importCount == 0)
    }
}

@Suite("building transactions")
@MainActor
struct BuildTransactionsTests {
    @Test func createsExpensesIncomeAndCashTransfers() throws {
        let card = UUID(), cash = UUID()
        let drafts = try fixtureDrafts(hasCashSource: true)
        let txs = BankImport.buildTransactions(drafts, accountID: card, cashSourceID: cash)
        #expect(txs.count == drafts.filter(\.include).count)

        let deposit = try #require(txs.first { $0.title == "Cash deposit" })
        #expect(deposit.kind == .transfer)
        #expect(deposit.category == Fintrack.Category.transfer)
        #expect(deposit.fromAccountID == cash)
        #expect(deposit.toAccountID == card)
        #expect(deposit.accountID == nil)
        #expect(deposit.amount == 8_000_000)

        let taxi = try #require(txs.first { $0.category == Fintrack.Category.taxi })
        #expect(taxi.kind == .expense)
        #expect(taxi.accountID == card)
        #expect(taxi.currency == .uzs)
        #expect(taxi.title == "Yandex Go")

        #expect(txs.allSatisfy { $0.importID != nil && $0.note.isEmpty })
    }

    @Test func skipsCashDepositsWithoutASourceAccount() throws {
        let txs = BankImport.buildTransactions(try fixtureDrafts(hasCashSource: true), accountID: UUID())
        #expect(!txs.contains { $0.kind == .transfer })
    }

    @Test func importIDSurvivesAStoreRoundTripAndBlocksReimport() throws {
        let url = makeTempDataURL()
        let store = AppStore(dataURL: url)
        let account = store.createAccount(named: "Card", currency: .uzs)
        let drafts = try fixtureDrafts()
        let txs = BankImport.buildTransactions(drafts, accountID: account.id)
        store.importTransactions(txs)
        #expect(store.transactions.count == txs.count)
        #expect(store.transactions.first!.date >= store.transactions.last!.date)

        let reloaded = AppStore(dataURL: url)
        #expect(reloaded.existingImportIDs == Set(txs.compactMap(\.importID)))
        let again = BankImport.suggest(try fixtureRows(), existingImportIDs: reloaded.existingImportIDs, hasCashSource: false)
        let reimported = BankImport.buildTransactions(again, accountID: account.id)
        #expect(reimported.isEmpty)
    }

    @Test func aTransactionWithoutImportIDOmitsTheKey() throws {
        let encoded = try JSONEncoder().encode(tx(.expense, 10))
        #expect(!String(decoding: encoded, as: UTF8.self).contains("importID"))
        let withID = Transaction(title: "x", amount: 1, currency: .uzs, category: .other, kind: .expense, date: wholeSecondNow(), importID: "abc")
        #expect(String(decoding: try JSONEncoder().encode(withID), as: UTF8.self).contains("\"importID\":\"abc\""))
    }
}
