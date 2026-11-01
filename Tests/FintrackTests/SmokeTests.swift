import Testing
import Foundation
@testable import Fintrack

/// Shared helper: a store backed by a throwaway directory so no test ever
/// touches ~/Library/Application Support/Fintrack.
@MainActor
func makeTempStore(seed: Bool = false) -> AppStore {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("fintrack-tests-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let store = AppStore(dataURL: dir.appendingPathComponent("fintrack.json"))
    if seed { store.resetToSampleData() }
    return store
}

@Suite struct SmokeTests {
    @Test @MainActor func freshStoreIsEmpty() {
        let store = makeTempStore()
        #expect(store.transactions.isEmpty)
        #expect(store.accounts.isEmpty)
        #expect(store.displayCurrency == .uzs)
        #expect(store.rates[.uzs] == 1)
    }
}
