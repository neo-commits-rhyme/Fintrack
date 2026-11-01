// Renders the Fintrack app icon (black tile, neon card) at every required size into AppIcon.iconset.
// Usage: swift scripts/icongen.swift <output-iconset-dir>
import AppKit

let outDir = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "AppIcon.iconset"
try? FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)

/// The mark: a plain black tile with a solid neon card; the stripe and chip
/// are cut out as negative space. Same construction as web/public/icon.svg
/// (256-unit design grid), scaled into the HIG tile.
let neon = NSColor(srgbRed: 0x3C / 255.0, green: 0xFF / 255.0, blue: 0xA0 / 255.0, alpha: 1)

func drawIcon(size: CGFloat) -> NSImage {
    let image = NSImage(size: NSSize(width: size, height: size))
    image.lockFocus()

    let scale = size / 1024.0
    // HIG-style margin: artwork occupies the centered ~82% of the canvas.
    let inset = 100.0 * scale
    let tile = NSRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let radius = 185.0 * scale
    NSColor.black.setFill()
    NSBezierPath(roundedRect: tile, xRadius: radius, yRadius: radius).fill()

    // Map the 256-unit design grid onto the tile. AppKit's origin is
    // bottom-left, so design y becomes (256 - y - height).
    let u = tile.width / 256.0
    func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
        NSRect(x: tile.minX + x * u, y: tile.minY + (256 - y - h) * u, width: w * u, height: h * u)
    }
    let card = NSBezierPath()
    card.windingRule = .evenOdd
    card.appendRoundedRect(r(52, 78, 152, 100), xRadius: 14 * u, yRadius: 14 * u)
    card.appendRect(r(52, 104, 152, 16))   // magnetic stripe
    card.appendRect(r(72, 140, 40, 10))    // chip
    neon.setFill()
    card.fill()

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
