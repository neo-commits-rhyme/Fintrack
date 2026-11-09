import Foundation
import Compression

/// Bank statement import: the card export ("Filtered_Cheques" sheet, Russian
/// headers) → suggested Fintrack transactions the user reviews before saving.
///
/// Port of web/src/core/xlsx.ts and web/src/core/bankImport.ts, which are the
/// spec for both apps: both test suites check
/// fixtures/bank-statement-sample.xlsx against
/// fixtures/bank-statement-sample.expected.json.

// MARK: - JavaScript semantics

/// The handful of JS behaviours the rules depend on, kept in one place so the
/// two apps can't drift (import ids are hashes: one different character and
/// every re-import stops being recognised).
enum JSCompat {
    /// JS `\s` / `String.prototype.trim` whitespace.
    static func isWhitespace(_ u: Unicode.Scalar) -> Bool {
        switch u.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    static func isDigit(_ byte: UInt8) -> Bool { byte >= 48 && byte <= 57 }

    /// `Number(text)`; nil stands for NaN.
    static func number(_ text: String) -> Double? {
        let scalars = text.unicodeScalars
        guard let first = scalars.firstIndex(where: { !isWhitespace($0) }),
              let last = scalars.lastIndex(where: { !isWhitespace($0) }) else { return 0 }
        let s = String(scalars[first...last])
        switch s {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        let bytes = Array(s.utf8)

        // Radix literals take no sign.
        if bytes.count > 2, bytes[0] == 48 {
            let radix: Int?
            switch bytes[1] {
            case 120, 88: radix = 16
            case 111, 79: radix = 8
            case 98, 66: radix = 2
            default: radix = nil
            }
            if let radix {
                var value = 0.0
                for b in bytes[2...] {
                    guard let digit = Character(Unicode.Scalar(b)).hexDigitValue, digit < radix else { return nil }
                    value = value * Double(radix) + Double(digit)
                }
                return value
            }
        }

        var i = 0
        var negative = false
        if i < bytes.count, bytes[i] == 43 || bytes[i] == 45 {
            negative = bytes[i] == 45
            i += 1
        }
        func digits() -> String {
            let start = i
            while i < bytes.count, isDigit(bytes[i]) { i += 1 }
            return String(decoding: bytes[start..<i], as: UTF8.self)
        }
        let whole = digits()
        var fraction = ""
        if i < bytes.count, bytes[i] == 46 {
            i += 1
            fraction = digits()
        }
        guard !whole.isEmpty || !fraction.isEmpty else { return nil }
        var exponent = "0"
        if i < bytes.count, bytes[i] == 101 || bytes[i] == 69 {
            i += 1
            var sign = ""
            if i < bytes.count, bytes[i] == 43 || bytes[i] == 45 {
                sign = bytes[i] == 45 ? "-" : ""
                i += 1
            }
            let e = digits()
            guard !e.isEmpty else { return nil }
            exponent = sign + e
        }
        guard i == bytes.count else { return nil }
        // Rebuilt in full so "5." and ".5" don't depend on Double's own parser.
        let normalized = "\(whole.isEmpty ? "0" : whole).\(fraction.isEmpty ? "0" : fraction)e\(exponent)"
        guard let magnitude = Double(normalized) else { return nil }
        return negative ? -magnitude : magnitude
    }

    /// `String(value)`: shortest round-trip digits in JS's layout ("35000",
    /// "1234.56", "1e+21", "1.5e-7").
    static func string(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        if value == 0 { return "0" }
        let sign = value < 0 ? "-" : ""

        // Swift's description already holds the shortest round-trip digits;
        // only its layout differs ("35000.0", "1e+16", "1.5e-07").
        let parts = abs(value).description.lowercased().split(separator: "e")
        let mantissa = parts[0].split(separator: ".", omittingEmptySubsequences: false)
        let whole = String(mantissa[0])
        let fraction = mantissa.count > 1 ? String(mantissa[1]) : ""
        var digits = Array(whole + fraction)
        var point = whole.count + (parts.count > 1 ? Int(parts[1]) ?? 0 : 0)
        while digits.first == "0" {
            digits.removeFirst()
            point -= 1
        }
        while digits.last == "0" { digits.removeLast() }

        let text = String(digits)
        let k = digits.count, n = point
        if k <= n && n <= 21 {
            return sign + text + String(repeating: "0", count: n - k)
        }
        if 0 < n && n <= 21 {
            return sign + String(digits[..<n]) + "." + String(digits[n...])
        }
        if -6 < n && n <= 0 {
            return sign + "0." + String(repeating: "0", count: -n) + text
        }
        let e = n - 1
        let exponent = "e\(e < 0 ? "-" : "+")\(abs(e))"
        return k == 1
            ? sign + text + exponent
            : sign + String(digits[0]) + "." + String(digits[1...]) + exponent
    }
}

// MARK: - .xlsx reader

struct XlsxError: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

/// Minimal, dependency-free .xlsx reader: enough to read a bank export.
/// Returns the first worksheet as rows of strings, with empty cells kept in
/// their column positions.
enum XlsxReader {
    private struct ZipEntry {
        var name: String
        var method: Int
        var compressedSize: Int
        var uncompressedSize: Int
        var localOffset: Int
    }

    /// Refuses anything that would inflate past this: a bank export is
    /// kilobytes, and the size comes straight from the file.
    private static let maxEntrySize = 200 * 1024 * 1024

    // Out-of-range reads give 0, which then fails the signature checks.
    private static func u16(_ b: [UInt8], _ o: Int) -> Int {
        guard o >= 0, o + 2 <= b.count else { return 0 }
        return Int(b[o]) | Int(b[o + 1]) << 8
    }

    private static func u32(_ b: [UInt8], _ o: Int) -> Int {
        guard o >= 0, o + 4 <= b.count else { return 0 }
        return Int(b[o]) | Int(b[o + 1]) << 8 | Int(b[o + 2]) << 16 | Int(b[o + 3]) << 24
    }

    private static func listZip(_ data: [UInt8]) throws -> [ZipEntry] {
        // End-of-central-directory record: scan back past an optional comment.
        var eocd = -1
        var i = data.count - 22
        let lowest = max(0, data.count - 22 - 65_535)
        while i >= lowest {
            if u32(data, i) == 0x0605_4B50 {
                eocd = i
                break
            }
            i -= 1
        }
        guard eocd >= 0 else { throw XlsxError("Not an .xlsx file (no zip directory found).") }

        let count = u16(data, eocd + 10)
        var p = u32(data, eocd + 16)
        var entries: [ZipEntry] = []
        for _ in 0..<count {
            guard u32(data, p) == 0x0201_4B50 else { throw XlsxError("Corrupt .xlsx file (bad zip entry).") }
            let nameLength = u16(data, p + 28), extraLength = u16(data, p + 30), commentLength = u16(data, p + 32)
            guard p + 46 + nameLength <= data.count else { throw XlsxError("Corrupt .xlsx file (bad zip entry).") }
            entries.append(ZipEntry(
                name: String(decoding: data[(p + 46)..<(p + 46 + nameLength)], as: UTF8.self),
                method: u16(data, p + 10),
                compressedSize: u32(data, p + 20),
                uncompressedSize: u32(data, p + 24),
                localOffset: u32(data, p + 42)
            ))
            p += 46 + nameLength + extraLength + commentLength
        }
        return entries
    }

    private static func readEntry(_ data: [UInt8], _ entry: ZipEntry) throws -> Data {
        let h = entry.localOffset
        guard u32(data, h) == 0x0403_4B50 else { throw XlsxError("Corrupt .xlsx file (bad local header).") }
        let start = h + 30 + u16(data, h + 26) + u16(data, h + 28)
        let end = start + entry.compressedSize
        guard end <= data.count else { throw XlsxError("Corrupt .xlsx file (truncated entry).") }
        if entry.method == 0 { return Data(data[start..<end]) }
        guard entry.method == 8 else { throw XlsxError("Unsupported compression in .xlsx (method \(entry.method)).") }
        guard entry.uncompressedSize <= maxEntrySize else { throw XlsxError("This .xlsx file is too large to read.") }
        guard entry.uncompressedSize > 0, end > start else { return Data() }

        let size = entry.uncompressedSize
        // COMPRESSION_ZLIB is raw DEFLATE, which is exactly what zip stores.
        var output = Data(count: size)
        let written = output.withUnsafeMutableBytes { (destination: UnsafeMutableRawBufferPointer) -> Int in
            data.withUnsafeBufferPointer { source in
                compression_decode_buffer(
                    destination.bindMemory(to: UInt8.self).baseAddress!, size,
                    source.baseAddress! + start, entry.compressedSize,
                    nil, COMPRESSION_ZLIB
                )
            }
        }
        guard written == size else { throw XlsxError("Corrupt .xlsx file (could not decompress).") }
        return output
    }

    static func columnIndex(_ ref: String) -> Int {
        var n = 0
        var seen = false
        for byte in ref.utf8 {
            guard byte >= 65, byte <= 90 else { break }
            seen = true
            n = n * 26 + Int(byte) - 64
        }
        return seen ? n - 1 : 0
    }

    /// `[A-Z]+\d+`, the only shape of `r` the column position is taken from.
    private static func isCellReference(_ ref: String) -> Bool {
        let bytes = Array(ref.utf8)
        let letters = bytes.prefix { $0 >= 65 && $0 <= 90 }.count
        return letters > 0 && letters < bytes.count && bytes[letters...].allSatisfy(JSCompat.isDigit)
    }

    private final class SharedStringsParser: NSObject, XMLParserDelegate {
        var strings: [String] = []
        private var current: String?
        private var inText = false

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
            if name == "si" { current = "" }
            else if name == "t", current != nil { inText = true }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            if inText { current?.append(string) }
        }

        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            if inText { current?.append(String(decoding: CDATABlock, as: UTF8.self)) }
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            if name == "t" { inText = false }
            else if name == "si", let finished = current {
                strings.append(finished)
                current = nil
            }
        }
    }

    private final class SheetParser: NSObject, XMLParserDelegate {
        let shared: [String]
        var rows: [[String]] = []
        private var row: [String]?
        private var inCell = false
        private var reference: String?
        private var type: String?
        private var cellValue: String?
        private var inlineText = ""
        private var inValue = false
        private var inText = false

        init(shared: [String]) { self.shared = shared }

        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
            switch name {
            case "row":
                row = []
            case "c" where row != nil:
                inCell = true
                reference = attributes["r"]
                type = attributes["t"]
                cellValue = nil
                inlineText = ""
            case "v" where inCell && cellValue == nil:
                // The first <v> wins.
                cellValue = ""
                inValue = true
            case "t" where inCell:
                inText = true
            default:
                break
            }
        }

        private func append(_ text: String) {
            if inValue { cellValue?.append(text) }
            else if inText { inlineText.append(text) }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) { append(string) }

        func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
            append(String(decoding: CDATABlock, as: UTF8.self))
        }

        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            switch name {
            case "v":
                inValue = false
            case "t":
                inText = false
            case "c" where inCell:
                inCell = false
                finishCell()
            case "row":
                if let finished = row { rows.append(finished) }
                row = nil
            default:
                break
            }
        }

        private func finishCell() {
            var value = ""
            if type == "s", let cellValue {
                if let index = JSCompat.number(cellValue), index >= 0, index == index.rounded(), index < Double(shared.count) {
                    value = shared[Int(index)]
                }
            } else if type == "inlineStr" {
                value = inlineText
            } else if let cellValue {
                value = cellValue
            }
            guard var cells = row else { return }
            let index: Int
            if let reference, XlsxReader.isCellReference(reference) {
                index = XlsxReader.columnIndex(reference)
            } else {
                index = cells.count
            }
            while cells.count < index { cells.append("") }
            if index == cells.count { cells.append(value) } else { cells[index] = value }
            row = cells
        }
    }

    private static func run(_ delegate: XMLParserDelegate, on xml: Data) throws {
        let parser = XMLParser(data: xml)
        parser.delegate = delegate
        parser.shouldResolveExternalEntities = false
        guard parser.parse() else { throw XlsxError("Corrupt .xlsx file (unreadable XML).") }
    }

    static func parseSharedStrings(_ xml: Data) throws -> [String] {
        let delegate = SharedStringsParser()
        try run(delegate, on: xml)
        return delegate.strings
    }

    static func parseSheet(_ xml: Data, shared: [String]) throws -> [[String]] {
        let delegate = SheetParser(shared: shared)
        try run(delegate, on: xml)
        return delegate.rows
    }

    /// Rows of the first worksheet.
    static func readRows(_ file: Data) throws -> [[String]] {
        let data = [UInt8](file)
        let entries = try listZip(data)

        let prefix = "xl/worksheets/sheet", suffix = ".xml"
        func sheetNumber(_ name: String) -> Int? {
            guard name.hasPrefix(prefix), name.hasSuffix(suffix),
                  name.utf8.count > prefix.utf8.count + suffix.utf8.count else { return nil }
            let middle = name.dropFirst(prefix.count).dropLast(suffix.count)
            guard middle.utf8.allSatisfy(JSCompat.isDigit) else { return nil }
            return Int(middle) ?? .max
        }
        let sheets = entries
            .compactMap { entry in sheetNumber(entry.name).map { (number: $0, entry: entry) } }
            .sorted { $0.number < $1.number }
        guard let first = sheets.first else { throw XlsxError("This file has no worksheet.") }

        let shared = try entries.first { $0.name == "xl/sharedStrings.xml" }
            .map { try parseSharedStrings(readEntry(data, $0)) } ?? []
        return try parseSheet(readEntry(data, first.entry), shared: shared)
    }
}

// MARK: - Statement model

struct StatementFormatError: LocalizedError {
    var message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct StatementRow: Hashable {
    /// 1-based spreadsheet row number, for messages.
    var line: Int
    /// Raw "dd-MM-yyyy HH:mm:ss" as printed by the bank (local time).
    var localDate: String
    var date: Date
    var credit: Bool
    var merchant: String
    var organization: String
    var amount: Double
    /// Bank's own category, lowercased.
    var bankCategory: String
    /// Recipient or sender name for person-to-person transfers, "" when none.
    var party: String
    var status: String
    /// Last four digits of the card, "" when absent.
    var cardLast4: String
    /// Stable id: the same bank row always gets the same id, so re-imports skip it.
    var importID: String
}

struct ImportDraft: Identifiable, Hashable {
    var row: StatementRow
    var include: Bool
    var kind: TransactionKind
    var category: Category
    var title: String
    /// Why the row is off by default or worth a look; nil when it's routine.
    var reason: String?
    /// Shown highlighted in the preview: the suggestion is a guess.
    var needsAttention = false
    /// Cash deposits wait for the user to pick where the cash came from.
    var waitsForCashSource = false

    var id: Int { row.line }
}

// MARK: - Rules

enum BankImport {
    private enum Header {
        static let date = "Дата платежа"
        static let time = "Время платежа"
        static let operation = "Тип операции"
        static let merchant = "Имя поставщика"
        static let organization = "Название организации поставщика"
        static let amount = "Сумма платежа"
        static let category = "Категория"
        static let party = "Получатель / Отправитель"
        static let card = "Номер карты"
        static let status = "Состояние чека"
        static let terminal = "Терминал"
    }

    enum Reason {
        static let notCompleted = "Not completed at the bank"
        static let duplicate = "Already imported"
        static let cashSource = "Pick where the cash came from to include this"
        static let unnamedTransfer = "No recipient shown — include it if it was a payment, not a move between your own cards"
        static let uncategorised = "The bank gave no useful category — pick one"
    }

    /// Cleans whitespace the bank pads cells with (tabs, newlines, NBSP).
    static func clean(_ text: String?) -> String {
        var out = String.UnicodeScalarView()
        var pendingSpace = false
        for scalar in (text ?? "").unicodeScalars {
            if JSCompat.isWhitespace(scalar) {
                pendingSpace = !out.isEmpty
                continue
            }
            if pendingSpace {
                out.append(" ")
                pendingSpace = false
            }
            out.append(scalar)
        }
        return String(out)
    }

    /// "Получатель:\n Name\t" → "Name".
    private static func partyName(_ text: String?) -> String {
        let c = clean(text)
        guard let colon = c.firstIndex(of: ":") else { return clean(c) }
        return clean(String(c[c.index(after: colon)...]))
    }

    /// FNV-1a, 64-bit, over UTF-8 — implemented identically in TypeScript.
    static func fnv1a64(_ text: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01B3
        }
        let hex = String(hash, radix: 16)
        return String(repeating: "0", count: 16 - hex.count) + hex
    }

    /// `^(\d{2})[-.](\d{2})[-.](\d{4})$` → day, month, year.
    private static func parseDay(_ text: String) -> (day: Int, month: Int, year: Int)? {
        let b = Array(text.utf8)
        guard b.count == 10, b[2] == 45 || b[2] == 46, b[5] == 45 || b[5] == 46,
              [0, 1, 3, 4, 6, 7, 8, 9].allSatisfy({ JSCompat.isDigit(b[$0]) }) else { return nil }
        func value(_ range: Range<Int>) -> Int { b[range].reduce(0) { $0 * 10 + Int($1) - 48 } }
        return (value(0..<2), value(3..<5), value(6..<10))
    }

    /// `^(\d{2}):(\d{2})(?::(\d{2}))?$` → hour, minute, optional second.
    private static func parseTime(_ text: String) -> (hour: String, minute: String, second: String?)? {
        let b = Array(text.utf8)
        guard b.count == 5 || b.count == 8, b[2] == 58,
              [0, 1, 3, 4].allSatisfy({ JSCompat.isDigit(b[$0]) }) else { return nil }
        func part(_ range: Range<Int>) -> String { String(decoding: b[range], as: UTF8.self) }
        if b.count == 8 {
            guard b[5] == 58, JSCompat.isDigit(b[6]), JSCompat.isDigit(b[7]) else { return nil }
            return (part(0..<2), part(3..<5), part(6..<8))
        }
        return (part(0..<2), part(3..<5), nil)
    }

    /// Finds the header row and turns every data row into a StatementRow.
    static func parseStatement(_ rows: [[String]]) throws -> [StatementRow] {
        guard let headerIndex = rows.firstIndex(where: { $0.contains { clean($0) == Header.amount } }) else {
            throw StatementFormatError("This doesn’t look like a bank statement: no “Сумма платежа” column.")
        }
        let header = rows[headerIndex].map { clean($0) }
        let required = [Header.date, Header.time, Header.operation, Header.merchant, Header.amount, Header.category]
        let missing = required.filter { !header.contains($0) }
        guard missing.isEmpty else {
            throw StatementFormatError("The statement is missing columns: \(missing.joined(separator: ", ")).")
        }

        // Gregorian whatever the system calendar is: the bank's dates are.
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current

        var out: [StatementRow] = []
        for (i, r) in rows[(headerIndex + 1)...].enumerated() {
            func get(_ name: String) -> String? {
                guard let column = header.firstIndex(of: name), column < r.count else { return nil }
                return r[column]
            }
            let dateText = clean(get(Header.date))
            let cleanedTime = clean(get(Header.time))
            let timeText = cleanedTime.isEmpty ? "00:00:00" : cleanedTime
            // Totals, blanks and footers fall out here.
            guard let day = parseDay(dateText), let time = parseTime(timeText) else { continue }
            let amountText = String(String.UnicodeScalarView(clean(get(Header.amount)).unicodeScalars.filter { !JSCompat.isWhitespace($0) }))
            let decimalText = amountText.firstIndex(of: ",").map { amountText.replacingCharacters(in: $0...$0, with: ".") } ?? amountText
            guard let amount = JSCompat.number(decimalText), amount.isFinite, amount > 0 else { continue }

            // Out-of-range parts roll over, as JS's Date constructor does.
            var parts = DateComponents()
            parts.year = day.year < 100 ? day.year + 1900 : day.year
            parts.month = day.month
            parts.day = day.day
            parts.hour = Int(time.hour)
            parts.minute = Int(time.minute)
            parts.second = Int(time.second ?? "0")
            guard let local = calendar.date(from: parts) else { continue }

            let operation = clean(get(Header.operation))
            let merchant = clean(get(Header.merchant))
            let card = clean(get(Header.card))
            let terminal = clean(get(Header.terminal))
            let localDate = "\(dateText) \(time.hour):\(time.minute):\(time.second ?? "00")"
            let cardBytes = Array(card.utf8)
            let last4 = cardBytes.count >= 4 && cardBytes.suffix(4).allSatisfy(JSCompat.isDigit)
                ? String(decoding: cardBytes.suffix(4), as: UTF8.self)
                : ""

            out.append(StatementRow(
                line: headerIndex + 2 + i,
                localDate: localDate,
                date: local,
                credit: operation.lowercased().hasPrefix("поступ"),
                merchant: merchant,
                organization: clean(get(Header.organization)),
                amount: amount,
                bankCategory: clean(get(Header.category)).lowercased(),
                party: partyName(get(Header.party)),
                status: clean(get(Header.status)),
                cardLast4: last4,
                importID: fnv1a64([localDate, operation, JSCompat.string(amount), merchant, terminal, card].joined(separator: "|"))
            ))
        }
        return out
    }

    /// Reads a picked file all the way to its rows. A readable statement with
    /// nothing in it is an error here: there would be nothing to review.
    static func readStatement(at url: URL) throws -> [StatementRow] {
        let rows = try parseStatement(XlsxReader.readRows(Data(contentsOf: url)))
        guard !rows.isEmpty else { throw StatementFormatError("This statement doesn’t contain any payments.") }
        return rows
    }

    private struct MerchantRule {
        var match: [String]
        var category: Category
        var title: String
    }

    /// Known merchants: checked before the bank's category, first match wins.
    private static let merchantRules: [MerchantRule] = [
        MerchantRule(match: ["YANDEX EATS", "YANDEXGO EATS"], category: .foodDelivery, title: "Yandex Eats"),
        MerchantRule(match: ["YANDEXGO", "YANDEX GO"], category: .taxi, title: "Yandex Go"),
        MerchantRule(match: ["KORZINKA", "ANGLESEY"], category: .groceries, title: "Korzinka"),
        MerchantRule(match: ["ATTO TOLOV"], category: .transport, title: "Metro & bus"),
        MerchantRule(match: ["PAYME PLUS"], category: .subscriptions, title: "Payme Plus"),
        MerchantRule(match: ["BEST COFFEE"], category: .eatingOut, title: "Best Coffee"),
        MerchantRule(match: ["EMPIRE GAMING"], category: .gaming, title: "Empire Gaming"),
    ]

    /// The bank's own categories (lowercased) → Fintrack categories.
    private static let bankCategories: [String: Category] = [
        "общепит": .eatingOut,
        "кафе и рестораны": .eatingOut,
        "такси": .taxi,
        "продукты": .groceries,
        "супермаркеты": .groceries,
        "транспорт": .transport,
        "магазин": .shopping,
        "одежда": .shopping,
        "для дома": .household,
        "игры": .gaming,
        "развлечения": .entertainment,
        "услуги": .subscriptions,
        "связь": .utilities,
        "коммунальные услуги": .utilities,
        "здоровье": .health,
        "аптеки": .health,
        "образование": .education,
        "путешествия": .travel,
    ]

    private static let legalTokens: Set<String> = [
        "OOO", "ООО", "LLC", "MCHJ", "XK", "YATT", "YTT", "IP", "ИП", "ЧП", "АО", "AO", "UB", "XK.",
    ]

    /// "OOO INTERNATIONAL FOODCHAIN" → "International Foodchain".
    static func cleanMerchantName(_ raw: String) -> String {
        let quotes: Set<Unicode.Scalar> = ["«", "»", "\"", "'", "“", "”"]
        var unquoted = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars { unquoted.append(quotes.contains(scalar) ? " " : scalar) }
        let words = clean(String(unquoted))
            .split(separator: " ")
            .map(String.init)
            .filter { !legalTokens.contains($0.uppercased()) }
        guard !words.isEmpty else { return clean(raw) }
        return words
            .map { word in
                word.utf8.contains(where: JSCompat.isDigit)
                    ? word.uppercased()
                    : word.prefix(1).uppercased() + word.dropFirst().lowercased()
            }
            .joined(separator: " ")
    }

    private static func merchantRule(for row: StatementRow) -> MerchantRule? {
        let haystack = "\(row.merchant) \(row.organization)".uppercased()
        return merchantRules.first { rule in rule.match.contains { haystack.contains($0) } }
    }

    /// One suggestion per row, in file order.
    static func suggest(_ rows: [StatementRow], existingImportIDs: Set<String>, hasCashSource: Bool) -> [ImportDraft] {
        rows.map { row in
            var draft: ImportDraft
            if row.credit {
                if row.bankCategory == "наличные" {
                    draft = ImportDraft(
                        row: row, include: hasCashSource, kind: .transfer, category: .transfer, title: "Cash deposit",
                        reason: hasCashSource ? nil : Reason.cashSource,
                        needsAttention: !hasCashSource, waitsForCashSource: true
                    )
                } else if row.bankCategory == "перевод" {
                    draft = ImportDraft(
                        row: row, include: true, kind: .income, category: .other,
                        title: row.party.isEmpty ? "Card transfer in" : row.party
                    )
                } else {
                    draft = ImportDraft(
                        row: row, include: true, kind: .income,
                        category: row.bankCategory.contains("зарплат") ? .salary : .other,
                        title: cleanMerchantName(row.merchant)
                    )
                }
            } else if row.bankCategory == "перевод" {
                draft = row.party.isEmpty
                    ? ImportDraft(
                        row: row, include: false, kind: .expense, category: .sentToPeople, title: "Card transfer out",
                        reason: Reason.unnamedTransfer, needsAttention: true
                    )
                    : ImportDraft(row: row, include: true, kind: .expense, category: .sentToPeople, title: row.party)
            } else {
                let rule = merchantRule(for: row)
                let category = rule?.category ?? bankCategories[row.bankCategory] ?? .other
                draft = ImportDraft(
                    row: row, include: true, kind: .expense, category: category,
                    title: rule?.title ?? cleanMerchantName(row.merchant),
                    reason: category == .other ? Reason.uncategorised : nil,
                    needsAttention: category == .other
                )
            }

            // Hard stops come last so they win over every suggestion above.
            let hardStop: String?
            if !row.status.isEmpty, row.status.lowercased() != "оплачен" {
                hardStop = Reason.notCompleted
            } else if existingImportIDs.contains(row.importID) {
                hardStop = Reason.duplicate
            } else {
                hardStop = nil
            }
            if let hardStop {
                draft.include = false
                draft.needsAttention = false
                draft.waitsForCashSource = false
                draft.reason = hardStop
            }
            return draft
        }
    }

    /// Included drafts → transactions ready for the store. Cash deposits are
    /// skipped without a source account.
    static func buildTransactions(_ drafts: [ImportDraft], accountID: UUID, cashSourceID: UUID? = nil) -> [Transaction] {
        drafts.compactMap { draft in
            guard draft.include else { return nil }
            if draft.kind == .transfer {
                guard let cashSourceID else { return nil }
                return Transaction(
                    title: draft.title, amount: draft.row.amount, currency: .uzs, category: .transfer, kind: .transfer,
                    date: draft.row.date, fromAccountID: cashSourceID, toAccountID: accountID, importID: draft.row.importID
                )
            }
            return Transaction(
                title: draft.title, amount: draft.row.amount, currency: .uzs, category: draft.category, kind: draft.kind,
                date: draft.row.date, accountID: accountID, importID: draft.row.importID
            )
        }
    }
}

// MARK: - Review state

/// The editable state behind the import sheet: the suggestions plus what the
/// user has changed. Separate from the view so the rules are testable.
struct ImportReview {
    private(set) var drafts: [ImportDraft]
    private(set) var hasCashSource: Bool
    /// Lines the user edited; a later cash-source change leaves them alone.
    private var touched: Set<Int> = []

    init(rows: [StatementRow], existingImportIDs: Set<String>, hasCashSource: Bool) {
        drafts = BankImport.suggest(rows, existingImportIDs: existingImportIDs, hasCashSource: hasCashSource)
        self.hasCashSource = hasCashSource
    }

    /// Rows the bank or an earlier import has settled.
    func isLocked(_ draft: ImportDraft) -> Bool {
        draft.reason == BankImport.Reason.duplicate || draft.reason == BankImport.Reason.notCompleted
    }

    /// A cash deposit can't be switched on until there is somewhere for the
    /// cash to have come from: buildTransactions would drop it anyway.
    func isToggleDisabled(_ draft: ImportDraft) -> Bool {
        isLocked(draft) || (draft.waitsForCashSource && !hasCashSource)
    }

    func willImport(_ draft: ImportDraft) -> Bool {
        draft.include && (draft.kind != .transfer || hasCashSource)
    }

    func displayReason(_ draft: ImportDraft) -> String? {
        draft.reason ?? (draft.waitsForCashSource && !hasCashSource ? BankImport.Reason.cashSource : nil)
    }

    var importCount: Int { drafts.filter(willImport).count }

    mutating func setInclude(line: Int, _ include: Bool) {
        guard let i = drafts.firstIndex(where: { $0.id == line }) else { return }
        drafts[i].include = include
        touched.insert(line)
    }

    mutating func setCategory(line: Int, _ category: Category) {
        guard let i = drafts.firstIndex(where: { $0.id == line }) else { return }
        drafts[i].category = category
        drafts[i].needsAttention = false
        if drafts[i].reason == BankImport.Reason.uncategorised { drafts[i].reason = nil }
        touched.insert(line)
    }

    mutating func setHasCashSource(_ hasSource: Bool) {
        hasCashSource = hasSource
        for i in drafts.indices where drafts[i].waitsForCashSource && !touched.contains(drafts[i].id) {
            drafts[i].include = hasSource
            drafts[i].needsAttention = !hasSource
            drafts[i].reason = hasSource ? nil : BankImport.Reason.cashSource
        }
    }
}
