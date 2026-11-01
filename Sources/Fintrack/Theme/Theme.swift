import SwiftUI
import AppKit

/// Fintrack design tokens.
///
/// Layering follows Apple's Liquid Glass HIG: real `glassEffect` is reserved for
/// the floating control layer (toolbars, buttons, the converter cluster); content
/// cards sit on standard materials over an ambient mesh-gradient window background.
enum FT {

    /// The single interactive accent — adaptive: Apple Action Blue on the
    /// quiet light theme, emerald green on the dark glass theme.
    static let accent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            // Dark: the brand mint (oklch 0.82 0.16 165) — a different green from
            // income, so "interactive" and "money in" never share a colour.
            // Light: action blue snapped into sRGB (oklch 0.52 0.172 255).
            ? NSColor(srgbRed: 0.214, green: 0.894, blue: 0.667, alpha: 1)
            : NSColor(srgbRed: 0.0, green: 0.402, blue: 0.786, alpha: 1)
    })

    /// Companion tone for gradients (app mark): indigo in light, teal in dark.
    static let accentDeep = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.0, green: 0.516, blue: 0.474, alpha: 1)
            : NSColor(srgbRed: 0.366, green: 0.303, blue: 0.745, alpha: 1)
    })

    /// Income and expense are appearance-aware and measured: ≥ 4.5:1 on the
    /// card surface in both themes (light oklch 0.52/150 and 0.55/25; dark
    /// 0.87/145 and 0.84/30). Never used for interaction — that is `accent`.
    static let income = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.525, green: 0.946, blue: 0.547, alpha: 1)
            : NSColor(srgbRed: 0.0, green: 0.496, blue: 0.221, alpha: 1)
    })
    static let expense = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(srgbRed: 0.999, green: 0.711, blue: 0.662, alpha: 1)
            : NSColor(srgbRed: 0.817, green: 0.108, blue: 0.162, alpha: 1)
    })

    // MARK: Type scale (SF Pro via system font)

    /// 34pt / semibold, tight tracking — screen titles.
    static let displayFont = Font.system(size: 34, weight: .semibold)
    /// 44pt / semibold — the hero balance number.
    static let heroNumberFont = Font.system(size: 44, weight: .semibold)
    /// 21pt / semibold — section headers.
    static let taglineFont = Font.system(size: 21, weight: .semibold)
    /// 17pt / regular — body.
    static let bodyFont = Font.system(size: 17)
    /// 14pt — captions.
    static let captionFont = Font.system(size: 14)

    // MARK: Metrics

    static let cardRadius: CGFloat = 24
    static let smallRadius: CGFloat = 14
    static let cardPadding: CGFloat = 20
    static let gridSpacing: CGFloat = 16
    static let pagePadding: CGFloat = 28
}

// MARK: - Ambient background

/// Slowly drifting mesh gradient — the content-layer backdrop the glass controls
/// float above. Rich enough for glass to refract, calm enough to read over.
struct FTBackground: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Group {
            if scheme == .dark {
                TimelineView(.animation(minimumInterval: 1.0 / 20.0)) { context in
                    let t = context.date.timeIntervalSinceReferenceDate
                    MeshGradient(
                        width: 3,
                        height: 3,
                        points: Self.points(at: t),
                        colors: Self.darkColors
                    )
                }
            } else {
                // Light mode is Apple-Store quiet: flat parchment canvas,
                // white hairline cards — no gradients (per the Apple DESIGN.md).
                Color(red: 0.961, green: 0.961, blue: 0.969)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    /// 3×3 mesh; edge points pinned, interior points drift on slow sine paths.
    private static func points(at t: TimeInterval) -> [SIMD2<Float>] {
        let s = t / 14.0
        func drift(_ x: Double, _ y: Double, _ ax: Double, _ ay: Double, _ phase: Double) -> SIMD2<Float> {
            SIMD2<Float>(
                Float(x + ax * sin(s + phase)),
                Float(y + ay * cos(s * 0.8 + phase))
            )
        }
        return [
            .init(0, 0), .init(0.5, 0), .init(1, 0),
            drift(0, 0.55, 0, 0.08, 1.3),
            drift(0.55, 0.5, 0.16, 0.14, 0),
            drift(1, 0.45, 0, 0.09, 2.1),
            .init(0, 1), .init(0.5, 1), .init(1, 1),
        ]
    }

    private static let lightColors: [Color] = [
        Color(red: 0.90, green: 0.91, blue: 0.97), Color(red: 0.82, green: 0.88, blue: 0.99), Color(red: 0.80, green: 0.90, blue: 0.97),
        Color(red: 0.90, green: 0.85, blue: 0.98), Color(red: 0.85, green: 0.90, blue: 1.00), Color(red: 0.78, green: 0.90, blue: 0.96),
        Color(red: 0.93, green: 0.90, blue: 0.97), Color(red: 0.84, green: 0.89, blue: 0.99), Color(red: 0.82, green: 0.92, blue: 0.96),
    ]

    private static let darkColors: [Color] = [
        // Top row near-black so it blends with the macOS-reserved menu-bar
        // strip in full screen (which the app can't fill).
        Color(red: 0.02, green: 0.03, blue: 0.04), Color(red: 0.02, green: 0.04, blue: 0.05), Color(red: 0.02, green: 0.03, blue: 0.05),
        Color(red: 0.05, green: 0.20, blue: 0.14), Color(red: 0.08, green: 0.18, blue: 0.19), Color(red: 0.04, green: 0.16, blue: 0.21),
        Color(red: 0.06, green: 0.10, blue: 0.09), Color(red: 0.05, green: 0.14, blue: 0.15), Color(red: 0.04, green: 0.13, blue: 0.15),
    ]
}

// MARK: - Modifiers

/// Content-layer card surface: standard material with a scheme-adaptive rim.
/// Per the Liquid Glass HIG, content cards use materials — real `glassEffect`
/// is reserved for the floating control layer.
///
/// Dark mode: translucent thin material + white rim glow over the mesh.
/// Light mode: more opaque material + dark hairline + soft shadow, so cards
/// stay visible against the pale backdrop.
private struct GlassCardSurface: ViewModifier {
    @Environment(\.colorScheme) private var scheme
    var cornerRadius: CGFloat
    var tint: Color?

    func body(content: Content) -> some View {
        let isDark = scheme == .dark
        content
            .background {
                ZStack {
                    if let tint {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(tint.opacity(isDark ? 0.12 : 0.08))
                    }
                }
                .background(
                    // Dark: translucent material glowing over the mesh.
                    // Light: opaque white card, Apple-Store style.
                    isDark ? AnyShapeStyle(.thinMaterial) : AnyShapeStyle(Color.white),
                    in: .rect(cornerRadius: cornerRadius, style: .continuous)
                )
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        isDark
                            ? AnyShapeStyle(LinearGradient(
                                colors: [.white.opacity(0.22), .white.opacity(0.04)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ))
                            : AnyShapeStyle(Color.black.opacity(0.12)),
                        lineWidth: 1
                    )
                    .allowsHitTesting(false)
            }
    }
}

extension View {
    func glassCard(cornerRadius: CGFloat = FT.cardRadius, tint: Color? = nil) -> some View {
        modifier(GlassCardSurface(cornerRadius: cornerRadius, tint: tint))
    }

    /// Page chrome shared by every screen: padding + max content width.
    func pageContent() -> some View {
        padding(FT.pagePadding)
            .frame(maxWidth: 1120, alignment: .leading)
            .frame(maxWidth: .infinity)
    }
}
