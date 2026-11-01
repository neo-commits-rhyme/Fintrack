import SwiftUI

// MARK: - GlassCard

/// The standard Fintrack surface: content on Liquid Glass with a rounded-rect shape.
struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat = FT.cardRadius
    var tint: Color? = nil
    var padding: CGFloat = FT.cardPadding
    @ViewBuilder var content: Content

    init(
        cornerRadius: CGFloat = FT.cardRadius,
        tint: Color? = nil,
        padding: CGFloat = FT.cardPadding,
        @ViewBuilder content: () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.tint = tint
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassCard(cornerRadius: cornerRadius, tint: tint)
    }
}

// MARK: - Screen scaffold

/// Wraps a screen: atmospheric background + scroll + page padding + large title row.
struct FTScreen<Content: View, Trailing: View>: View {
    var title: String
    var subtitle: String?
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    init(
        _ title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() },
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.trailing = trailing()
        self.content = content()
    }

    @Environment(AppStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: FT.gridSpacing) {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title)
                            .font(FT.displayFont)
                            .kerning(-0.4)
                        if let subtitle {
                            Text(subtitle)
                                .font(FT.bodyFont)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    // Screen actions live IN the content — always visible,
                    // never trapped in the full-screen hover bar.
                    trailing
                }
                .padding(.bottom, 8)

                content
            }
            .pageContent()
            // In full screen the reveal-bar zone overlaps the window top —
            // give the header clearance so the title and actions never start
            // hidden beneath it.
            .padding(.top, store.isFullscreen ? 56 : 0)
        }
        // Content scrolls under the bar zone; the soft edge keeps it legible.
        // The mesh backdrop is installed once at window level in RootView.
        .scrollEdgeEffectStyle(.soft, for: .top)
        .scrollEdgeEffectHidden(store.isFullscreen, for: .top)
    }
}

// MARK: - Section header

struct SectionHeader: View {
    var title: String
    var subtitle: String?

    init(_ title: String, subtitle: String? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(title)
                .font(FT.taglineFont)
                .kerning(-0.2)
            if let subtitle {
                Text(subtitle)
                    .font(FT.captionFont)
                    .foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.top, 12)
    }
}

// MARK: - Stat tile

/// Compact metric card: icon chip, caption title, big monospaced-digit value.
struct StatTile: View {
    var title: String
    var value: String
    var icon: String
    var tint: Color
    var caption: String? = nil

    var body: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 26, height: 26)
                        .background(tint.opacity(0.14), in: .circle)
                    Text(title)
                        .font(FT.captionFont)
                        .foregroundStyle(.secondary)
                }
                Text(value)
                    .font(.system(size: 24, weight: .semibold))
                    .monospacedDigit()
                    .kerning(-0.3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let caption {
                    Text(caption)
                        .font(.system(size: 12))
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }
}

// MARK: - Progress

/// Thin capsule progress bar. Turns `FT.expense`-colored when over 100%.
struct GlassProgressBar: View {
    var fraction: Double
    var tint: Color

    var body: some View {
        GeometryReader { geo in
            let clamped = min(1, max(0, fraction))
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(.quaternary)
                Capsule()
                    .fill((fraction > 1 ? FT.expense : tint).gradient)
                    // Nothing spent reads as nothing, not as a dot of progress.
                    .frame(width: clamped > 0 ? max(8, geo.size.width * clamped) : 0)
            }
        }
        .frame(height: 8)
        .animation(.snappy, value: fraction)
    }
}

/// Circular goal ring with a percent label in the middle.
struct GoalRing: View {
    var fraction: Double
    var tint: Color
    var lineWidth: CGFloat = 9
    var size: CGFloat = 74

    var body: some View {
        let clamped = min(1, max(0, fraction))
        ZStack {
            Circle()
                .stroke(.quaternary, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(
                    AngularGradient(
                        gradient: Gradient(colors: [tint.opacity(0.6), tint]),
                        center: .center,
                        startAngle: .degrees(-90),
                        endAngle: .degrees(-90 + 360 * clamped)
                    ),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            // Floor, not round: 99.9% must not read "100%" before the goal is done.
            Text("\(Int((clamped * 100).rounded(.down)))%")
                .font(.system(size: size * 0.22, weight: .semibold))
                .monospacedDigit()
        }
        .frame(width: size, height: size)
        .animation(.snappy, value: fraction)
    }
}

// MARK: - Category badge

/// Rounded icon chip in the category's tint.
struct CategoryBadge: View {
    var category: Category
    var size: CGFloat = 38

    var body: some View {
        Image(systemName: category.icon)
            .font(.system(size: size * 0.42, weight: .medium))
            .foregroundStyle(category.tint)
            .frame(width: size, height: size)
            .background(category.tint.opacity(0.14), in: .rect(cornerRadius: size * 0.32))
    }
}

// MARK: - Glass segmented picker

/// Liquid Glass segmented control: the selected pill is real glass and MORPHS
/// fluidly between options (glassEffectID + matchedGeometry inside one container).
struct GlassSegmentedPicker<T: Hashable>: View {
    var options: [T]
    var title: (T) -> String
    @Binding var selection: T
    @Namespace private var namespace

    var body: some View {
        GlassEffectContainer(spacing: 24) {
            HStack(spacing: 4) {
                ForEach(options, id: \.self) { option in
                    let isSelected = option == selection
                    Button {
                        withAnimation(.snappy(duration: 0.32)) {
                            selection = option
                        }
                    } label: {
                        // The selected label IS the glass — text rides on the
                        // pill so the container can morph it between options.
                        let label = Text(title(option))
                            .font(.system(size: 13, weight: isSelected ? .semibold : .regular))
                            .foregroundStyle(isSelected ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                            .contentShape(.capsule)
                        if isSelected {
                            label
                                .glassEffect(.regular.tint(FT.accent).interactive(), in: .capsule)
                                .glassEffectID("selection", in: namespace)
                        } else {
                            label
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isSelected ? [.isSelected] : [])
                }
            }
        }
    }
}

// MARK: - Currency picker

/// Flag + code menu picker used everywhere a currency is chosen.
struct CurrencyPicker: View {
    var label: String = "Currency"
    @Binding var selection: CurrencyCode

    var body: some View {
        Picker(label, selection: $selection) {
            ForEach(CurrencyCode.allCases) { code in
                Text("\(code.flag) \(code.rawValue)").tag(code)
            }
        }
        .pickerStyle(.menu)
    }
}

// MARK: - Empty state

struct EmptyStateView: View {
    var icon: String
    var title: String
    var message: String

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.system(size: 17, weight: .semibold))
            Text(message)
                .font(FT.captionFont)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 44)
    }
}

// MARK: - Sheet scaffold

/// Consistent chrome for every add/edit sheet: title, form content, Cancel/Save.
struct FTSheet<Content: View>: View {
    var title: String
    var saveTitle: String = "Save"
    var canSave: Bool
    var onSave: () -> Void
    @ViewBuilder var content: Content
    @Environment(\.dismiss) private var dismiss

    init(
        title: String,
        saveTitle: String = "Save",
        canSave: Bool,
        onSave: @escaping () -> Void,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.saveTitle = saveTitle
        self.canSave = canSave
        self.onSave = onSave
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            Text(title)
                .font(.system(size: 20, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.top, 22)
                .padding(.bottom, 12)

            Form { content }
                .formStyle(.grouped)
                .scrollContentBackground(.hidden)

            HStack {
                Button("Cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                Button(saveTitle) {
                    // A numeric field only pushes its value on commit. End the
                    // edit first, then save on the next turn so the binding has
                    // caught up — otherwise Return/Save could store the old amount.
                    NSApp.keyWindow?.makeFirstResponder(nil)
                    DispatchQueue.main.async {
                        onSave()
                        dismiss()
                    }
                }
                .buttonStyle(.glassProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!canSave)
            }
            .padding(20)
        }
        .frame(minWidth: 420, minHeight: 380)
    }
}
