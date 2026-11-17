#!/bin/sh
# Wrap the SwiftPM binary in a menu-bar app bundle. Does not flash anything.
set -eu
cd "$(dirname "$0")/.."
swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
APP="连接状态.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_DIR/MoteScreen" "$APP/Contents/MacOS/MoteScreen"
cp Support/Info.plist "$APP/Contents/Info.plist"
cp ../../hooks/mote-screen-hook "$APP/Contents/Resources/mote-screen-hook"
chmod +x "$APP/Contents/Resources/mote-screen-hook" "$APP/Contents/MacOS/MoteScreen"
echo "built $(pwd)/$APP"
