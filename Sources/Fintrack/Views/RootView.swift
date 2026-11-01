import SwiftUI

enum AppSection: String, CaseIterable, Identifiable {
    case dashboard
    case transactions
    case accounts
    case budgets
    case goals
    case converter
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .transactions: "Transactions"
        case .accounts: "Accounts"
        case .budgets: "Budgets"
        case .goals: "Goals"
        case .converter: "Converter"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "square.grid.2x2.fill"
        case .transactions: "list.bullet.rectangle.portrait.fill"
        case .accounts: "creditcard.fill"
        case .budgets: "chart.pie.fill"
        case .goals: "target"
        case .converter: "arrow.left.arrow.right.circle.fill"
        case .settings: "gearshape.fill"
        }
    }
}

struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        @Bindable var store = store
        ZStack {
            // Second mesh INSIDE the content view: with fullSizeContentView the
            // content extends under the title bar, so this fills the strip the
            // window background can't reach in full screen. Identical phase to
            // the window-level mesh (time-derived points), so they overlay
            // seamlessly.
            FTBackground()
            navigationSplitView
        }
        // Full screen has no title bar and no toolbar (Tahoe would pin a glass
        // bar) — draw our own always-visible traffic lights, Telegram-style.
        .overlay(alignment: .topLeading) {
            if store.isFullscreen {
                FullscreenTrafficLights()
                    .padding(.leading, 10)
                    .padding(.top, 2)
            }
        }
        .background(WindowConfigurator(colorScheme: colorScheme))
    }

    private var navigationSplitView: some View {
        @Bindable var store = store
        return NavigationSplitView {
            List(selection: $store.activeSection) {
                Section {
                    ForEach(AppSection.allCases.filter { $0 != .settings }) { s in
                        Label(s.title, systemImage: s.icon).tag(s)
                    }
                } header: {
                    appMark
                        .padding(.bottom, 10)
                }

                Section {
                    Label(AppSection.settings.title, systemImage: AppSection.settings.icon)
                        .tag(AppSection.settings)
                }
            }
            .navigationSplitViewColumnWidth(min: 210, ideal: 230, max: 280)
            // The sidebar's scroll pocket also paints a darkened strip when
            // full screen removes the toolbar — hide it there too.
            .scrollEdgeEffectHidden(store.isFullscreen, for: .top)
        } detail: {
            // Minute-tick keeps "this month" totals, budget resets and
            // Today/Yesterday labels honest across midnight and month rollover.
            TimelineView(.everyMinute) { _ in
                detail
            }
            .navigationTitle("")
            // Let the toolbar's Liquid Glass float directly over the mesh —
            // no opaque title-bar strip.
            .toolbarBackground(.hidden, for: .windowToolbar)
            // Full screen: no window toolbar at all — Tahoe would pin it as a
            // permanent bar. FullscreenChrome adds always-visible traffic
            // lights instead (the Telegram look).
            .toolbar(store.isFullscreen ? .hidden : .automatic, for: .windowToolbar)
            // In full screen the detail scroll view projects its top scroll
            // pocket into the pinned toolbar overlay — a charcoal band AppKit
            // re-shows every frame, so it can only be disabled at the source.
            .scrollEdgeEffectHidden(store.isFullscreen, for: .top)
        }
        // One ambient mesh for the whole window — it runs edge to edge, so the
        // floating glass sidebar and toolbar refract it (Liquid Glass HIG).
        .containerBackground(for: .window) {
            FTBackground()
        }
        // Applied at the split-view level too: in full screen the title-bar
        // strip spans BOTH columns and would otherwise draw an opaque gray bar.
        .toolbarBackground(.hidden, for: .windowToolbar)
        // App-wide accent: emerald in dark, Action Blue in light — sidebar
        // selection, buttons and pickers all follow.
        .tint(FT.accent)
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEnterFullScreenNotification)) { _ in
            store.isFullscreen = true
            FullscreenChrome.start()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { _ in
            store.isFullscreen = false
            FullscreenChrome.stop()
        }
        .alert(
            "Couldn't save your data",
            isPresented: Binding(
                get: { store.saveError != nil },
                set: { if !$0 { store.clearSaveError() } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.saveError ?? "")
        }
        .alert(
            "Problem reading your data",
            isPresented: Binding(
                get: { store.loadError != nil },
                set: { if !$0 { store.clearLoadError() } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.loadError ?? "")
        }
    }

    private var appMark: some View {
        HStack(spacing: 10) {
            Image(systemName: "creditcard.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(
                    LinearGradient(
                        colors: [FT.accent, FT.accentDeep],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: .rect(cornerRadius: 9)
                )
            VStack(alignment: .leading, spacing: 0) {
                Text("Fintrack")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)
                Text("Personal finance")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        // Constant clearance for the traffic lights over the sidebar's
        // top-left corner: windowed they're always there, full screen they
        // slide into this same gap on reveal — so they never cross the mark
        // (matches Notes / To Do).
        .padding(.top, 34)
    }

    @ViewBuilder
    private var detail: some View {
        switch store.activeSection {
        case .dashboard: DashboardView()
        case .transactions: TransactionsView()
        case .accounts: AccountsView()
        case .budgets: BudgetsView()
        case .goals: GoalsView()
        case .converter: ConverterView()
        case .settings: SettingsView()
        }
    }
}

/// Working traffic lights for full screen, drawn by us: the system's own are
/// tied to chrome that Tahoe either pins as a glass bar or hides entirely.
/// Red closes, green exits full screen; minimize is disabled in full screen,
/// so its light is shown dimmed — exactly like the native reveal bar does.
private struct FullscreenTrafficLights: View {
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            light(.init(red: 1.00, green: 0.37, blue: 0.34), symbol: "xmark", label: "Close window") {
                NSApp.windows.first { $0.styleMask.contains(.fullScreen) }?.performClose(nil)
            }
            light(Color(white: 0.42), symbol: nil, label: "Minimize (unavailable in full screen)", action: nil)
            light(.init(red: 0.20, green: 0.78, blue: 0.35), symbol: "arrow.down.right.and.arrow.up.left", label: "Exit full screen") {
                NSApp.windows.first { $0.styleMask.contains(.fullScreen) }?.toggleFullScreen(nil)
            }
        }
        .onHover { hovering = $0 }
    }

    private func light(_ color: Color, symbol: String?, label: String, action: (() -> Void)? = nil) -> some View {
        Button { action?() } label: {
            ZStack {
                Circle()
                    .fill(color)
                    .overlay(Circle().strokeBorder(.black.opacity(0.2), lineWidth: 0.5))
                    .frame(width: 12, height: 12)
                if hovering, let symbol {
                    Image(systemName: symbol)
                        .font(.system(size: 6, weight: .black))
                        .foregroundStyle(.black.opacity(0.55))
                }
            }
            .frame(width: 16, height: 16)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .accessibilityLabel(label)
    }
}
