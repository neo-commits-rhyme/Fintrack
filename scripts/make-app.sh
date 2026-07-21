#!/bin/zsh
# Builds Fintrack.app from the Swift package.
# Usage: ./scripts/make-app.sh  (run from the Fintrack package root)
set -euo pipefail

APP_NAME="Fintrack"
BUNDLE_ID="com.fintrack.app"
VERSION="1.0"
DIST="dist"
APP="$DIST/$APP_NAME.app"

echo "▸ release build"
swift build -c release

echo "▸ icon"
ICONSET="$DIST/AppIcon.iconset"
rm -rf "$DIST"
mkdir -p "$ICONSET"
swift scripts/icongen.swift "$ICONSET"
iconutil -c icns "$ICONSET" -o "$DIST/AppIcon.icns"

echo "▸ bundle"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp ".build/release/$APP_NAME" "$APP/Contents/MacOS/$APP_NAME"
cp "$DIST/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "▸ accent color asset"
xcrun actool "Assets.xcassets" \
    --compile "$APP/Contents/Resources" \
    --platform macosx \
    --minimum-deployment-target 26.0 \
    --output-partial-info-plist "$DIST/assets-info.plist" > /dev/null

cat > "$APP/Contents/Info.plist" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>            <string>$APP_NAME</string>
    <key>CFBundleIdentifier</key>            <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>                  <string>$APP_NAME</string>
    <key>CFBundleDisplayName</key>           <string>$APP_NAME</string>
    <key>CFBundlePackageType</key>           <string>APPL</string>
    <key>CFBundleShortVersionString</key>    <string>$VERSION</string>
    <key>CFBundleVersion</key>               <string>1</string>
    <key>CFBundleIconFile</key>              <string>AppIcon</string>
    <key>NSAccentColorName</key>             <string>AccentColor</string>
    <key>LSMinimumSystemVersion</key>        <string>26.0</string>
    <key>LSApplicationCategoryType</key>     <string>public.app-category.finance</string>
    <key>NSHighResolutionCapable</key>       <true/>
    <key>NSPrincipalClass</key>              <string>NSApplication</string>
    <key>NSHumanReadableCopyright</key>      <string>Local-only personal finance.</string>
</dict>
</plist>
PLIST

echo "▸ codesign (ad-hoc)"
codesign --force -s - "$APP"

rm -rf "$ICONSET" "$DIST/AppIcon.icns"
echo "✓ $APP"
