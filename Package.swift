// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Fintrack",
    platforms: [.macOS(.v26)],
    targets: [
        .executableTarget(
            name: "Fintrack",
            path: "Sources/Fintrack",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
