import SwiftUI
import AppKit

/// Full-screen chrome, the Telegram way: traffic lights are ALWAYS visible,
/// floating bare over the content at the standard top-left spot; the menu bar
/// simply slides over them on reveal. No bars, no strips, no fading chrome.
///
/// How: in full screen the window toolbar is removed entirely (RootView) —
/// otherwise Tahoe pins it as a permanent 52px glass bar that cannot be
/// restyled. That also removes the system traffic lights, so RootView draws
/// its own working set (system NSThemeWidget buttons render blank when hosted
/// outside real chrome — verified). The titlebar overlay AppKit still summons
/// on reveal is suppressed here: its frame view is hidden (survives the
/// system's reveal animation, unlike window alpha) plus alpha zeroed.
///
/// The menu-bar strip above the window (39px on notched Macs) is composited by
/// the system on full-screen spaces and cannot be painted by ANY app window;
/// the dark mesh's top row is near-black so it blends into it.
enum FullscreenChrome {
    private final class WeakView {
        weak var view: NSView?
        init(_ view: NSView) { self.view = view }
    }

    private static var timer: Timer?
    private static var hiddenViews: [WeakView] = []
    /// Identity set so a view AppKit keeps re-showing is tracked once, not
    /// appended 50 times a second.
    private static var hiddenIDs: Set<ObjectIdentifier> = []

    static func start() {
        timer?.invalidate()
        // 50Hz: the reveal overlay must be re-zeroed before it gets a visible
        // frame on screen.
        timer = Timer.scheduledTimer(withTimeInterval: 0.02, repeats: true) { _ in
            apply()
        }
        apply()
    }

    static func stop() {
        timer?.invalidate()
        timer = nil
        for box in hiddenViews { box.view?.isHidden = false }
        hiddenViews.removeAll()
        hiddenIDs.removeAll()
        for window in NSApp.windows
        where String(describing: type(of: window)).contains("NSToolbarFullScreenWindow") {
            window.alphaValue = 1
            window.contentView?.superview?.isHidden = false
        }
    }

    private static func apply() {
        for window in NSApp.windows {
            if String(describing: type(of: window)).contains("NSToolbarFullScreenWindow") {
                // Vestigial reveal overlay (toolbar is gone) — never show it.
                // isHidden on the frame view survives the system's reveal
                // animation; window alpha alone gets re-animated (gray flash).
                if window.alphaValue != 0 { window.alphaValue = 0 }
                if window.contentView?.superview?.isHidden == false {
                    window.contentView?.superview?.isHidden = true
                }
            } else if let root = window.contentView?.superview {
                hideScrollBackdrops(in: root)
            }
        }
    }

    private static func hideScrollBackdrops(in view: NSView) {
        let isScrollView = view is NSScrollView
            || String(describing: type(of: view)).contains("ScrollView")
        for sub in view.subviews {
            let name = String(describing: type(of: sub))
            if isScrollView, sub.frame.height <= 96,
               name.contains("Backdrop") || name.contains("ScrollPocket") {
                if !sub.isHidden {
                    sub.isHidden = true
                    if hiddenIDs.insert(ObjectIdentifier(sub)).inserted {
                        hiddenViews.append(WeakView(sub))
                    }
                }
            } else {
                hideScrollBackdrops(in: sub)
            }
        }
    }
}

/// Makes the window titlebar transparent, lets content run full-size under it,
/// and paints the window background the scheme's base color so the titlebar
/// strip matches the app in BOTH windowed and full-screen modes (no opaque
/// bar, no white/black band). `colorScheme` comes from SwiftUI so updateNSView
/// re-runs on a light/dark switch.
struct WindowConfigurator: NSViewRepresentable {
    var colorScheme: ColorScheme

    /// Owns the notification tokens so they are removed with the view, and
    /// only ever touches the window this view lives in (never sheets/alerts).
    final class Coordinator {
        weak var view: NSView?
        var tokens: [NSObjectProtocol] = []
        deinit { tokens.forEach(NotificationCenter.default.removeObserver) }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        context.coordinator.view = view
        DispatchQueue.main.async { Self.configure(view.window) }
        for name: NSNotification.Name in [
            NSWindow.didBecomeKeyNotification,
            NSWindow.didEnterFullScreenNotification,
            NSWindow.didExitFullScreenNotification,
        ] {
            let token = NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak coordinator = context.coordinator] note in
                guard let window = coordinator?.view?.window, (note.object as? NSWindow) === window else { return }
                Self.configure(window)
            }
            context.coordinator.tokens.append(token)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // `colorScheme` is read from SwiftUI so this re-runs on a light/dark switch.
        _ = colorScheme
        Self.configure(nsView.window)
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.tokens.forEach(NotificationCenter.default.removeObserver)
        coordinator.tokens.removeAll()
    }

    private static func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        // The mesh/parchment doesn't reach the titlebar strip, so the window's
        // own background shows there — paint it the scheme base so it blends.
        // Read the window's live appearance rather than a captured scheme.
        let isDark = window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        window.backgroundColor = isDark
            ? NSColor(srgbRed: 0.03, green: 0.04, blue: 0.05, alpha: 1)
            : NSColor(srgbRed: 0.961, green: 0.961, blue: 0.969, alpha: 1)
    }
}

@main
struct FintrackApp: App {
    @State private var store = AppStore()

    init() {
        // Running from `swift run` has no app bundle — promote to a regular
        // foreground app so the window activates and appears in the Dock.
        DispatchQueue.main.async {
            NSApp.setActivationPolicy(.regular)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    var body: some Scene {
        // Single-window app: keeps ⌘N free for "Add Transaction" and avoids
        // multiple windows mirroring one shared navigation state.
        Window("Fintrack", id: "main") {
            RootView()
                .environment(store)
                .frame(minWidth: 1080, minHeight: 700)
        }
        .windowBackgroundDragBehavior(.enabled)
        .defaultSize(width: 1280, height: 820)
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Transaction") {
                    store.activeSection = .transactions
                    store.newTransactionRequested = true
                }
                .keyboardShortcut("n", modifiers: .command)
            }
            CommandMenu("Go") {
                ForEach(Array(AppSection.allCases.enumerated()), id: \.element) { index, section in
                    Button(section.title) { store.activeSection = section }
                        .keyboardShortcut(KeyEquivalent(Character("\(index + 1)")), modifiers: .command)
                }
            }
        }
    }
}
