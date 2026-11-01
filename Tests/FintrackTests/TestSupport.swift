import Testing
import Foundation
@testable import Fintrack

/// A fresh fintrack.json URL inside its own throwaway directory (file not created).
func makeTempDataURL() -> URL {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("fintrack-tests-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("fintrack.json")
}

/// Whole-second "now" so values survive the ISO8601 (second precision) round trip.
func wholeSecondNow() -> Date {
    Date(timeIntervalSince1970: Date().timeIntervalSince1970.rounded(.down))
}

/// Middle of today (or N days ago) at noon — safely inside the day and, for
/// small offsets, inside the current month only when the test checks it.
func daysAgo(_ n: Int, hour: Int = 12) -> Date {
    let cal = Calendar.current
    let day = cal.date(byAdding: .day, value: -n, to: Date().startOfDay)!
    return cal.date(bySettingHour: hour, minute: 0, second: 0, of: day)!
}

func tx(
    _ kind: TransactionKind,
    _ amount: Double,
    _ currency: CurrencyCode = .uzs,
    category: Fintrack.Category? = nil,
    date: Date = Date(),
    account: UUID? = nil,
    from: UUID? = nil,
    to: UUID? = nil,
    title: String = "t"
) -> Transaction {
    let cat = category ?? {
        switch kind {
        case .income: return .salary
        case .expense: return .groceries
        case .transfer: return .transfer
        }
    }()
    return Transaction(
        title: title, amount: amount, currency: currency, category: cat, kind: kind,
        date: date, accountID: account, fromAccountID: from, toAccountID: to
    )
}

/// Approximate floating-point equality for money math.
func approx(_ a: Double, _ b: Double, tolerance: Double = 1e-6) -> Bool {
    abs(a - b) <= tolerance * max(1, abs(a), abs(b))
}
