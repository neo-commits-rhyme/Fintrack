// Renders the Fintrack app icon at every required size into AppIcon.iconset.
// Usage: swift scripts/icongen.swift <output-iconset-dir>
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    let scale = size / 1024.0
    // HIG-style margin: artwork occupies the centered ~82% of the canvas.
    let inset = 100.0 * scale
    let rect = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = 185.0 * scale
    let shape = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)

    // Deep blue → indigo, echoing the in-app mark.
    let gradient = NSGradient(
        starting: NSColor(calibratedRed: 0.05, green: 0.32, blue: 0.85, alpha: 1),
        ending: NSColor(calibratedRed: 0.32, green: 0.18, blue: 0.72, alpha: 1)
    )
    gradient?.draw(in: shape, angle: -60)

    // Soft top-edge highlight for a glassy feel.
    let highlight = NSBezierPath(roundedRect: rect.insetBy(dx: 14 * scale, dy: 14 * scale),
                                 xRadius: radius - 14 * scale, yRadius: radius - 14 * scale)
    NSGradient(
        starting: NSColor(calibratedWhite: 1, alpha: 0.28),
        ending: NSColor(calibratedWhite: 1, alpha: 0.0)
    )?.draw(in: highlight, angle: -90)

    // Centered credit-card glyph.
    let config = NSImage.SymbolConfiguration(pointSize: 430 * scale, weight: .medium)
    if let symbol = NSImage(systemSymbolName: "creditcard.fill", accessibilityDescription: nil)?
        .withSymbolConfiguration(config) {
        let tinted = NSImage(size: symbol.size)
        tinted.lockFocus()
        symbol.draw(at: .zero, from: .zero, operation: .sourceOver, fraction: 1)
        NSColor.white.set()
        NSRect(origin: .zero, size: symbol.size).fill(using: .sourceAtop)
        tinted.unlockFocus()

        let glyphRect = NSRect(
            x: (size - tinted.size.width) / 2,
            y: (size - tinted.size.height) / 2,
            width: tinted.size.width,
            height: tinted.size.height
        )
        tinted.draw(in: glyphRect, from: .zero, operation: .sourceOver, fraction: 0.97)
    }

    image.unlockFocus()
    return image
}

func writePNG(_ image: NSImage, pixels: Int, name: String) {
    guard let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff) else { fatalError("rep failed for \(name)") }
    rep.size = image.size
    guard let resized = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    ) else { fatalError("bitmap alloc failed") }
    resized.size = NSSize(width: pixels, height: pixels)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: resized)
    NSGraphicsContext.current?.imageInterpolation = .high
    image.draw(in: NSRect(x: 0, y: 0, width: pixels, height: pixels))
    NSGraphicsContext.restoreGraphicsState()
    guard let png = resized.representation(using: .png, properties: [:]) else { fatalError("png failed") }
    try! png.write(to: URL(fileURLWithPath: "\(outDir)/\(name).png"))
}

let master = drawIcon(size: 1024)
let entries: [(Int, String)] = [
    (16, "icon_16x16"), (32, "icon_16x16@2x"),
    (32, "icon_32x32"), (64, "icon_32x32@2x"),
    (128, "icon_128x128"), (256, "icon_128x128@2x"),
    (256, "icon_256x256"), (512, "icon_256x256@2x"),
    (512, "icon_512x512"), (1024, "icon_512x512@2x"),
]
for (px, name) in entries { writePNG(master, pixels: px, name: name) }
print("iconset written to \(outDir)")
