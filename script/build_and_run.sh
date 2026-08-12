#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Agentic Movie Studio"
EXECUTABLE_NAME="agentic-movie-studio"
BUNDLE_ID="com.abandonedmuse.agenticmoviestudio"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAURI_DIR="$ROOT_DIR/src-tauri"
DIST_DIR="$ROOT_DIR/dist"
PROJECT_APP="$DIST_DIR/$APP_NAME.app"
INSTALLED_APP="/Applications/$APP_NAME.app"
LEGACY_APP="/Applications/Studio.app"

if command -v cargo >/dev/null 2>&1; then
  CARGO_BIN="$(command -v cargo)"
elif [ -x "/Users/muse/.cargo/bin/cargo" ]; then
  CARGO_BIN="/Users/muse/.cargo/bin/cargo"
else
  echo "Rust Cargo was not found." >&2
  exit 1
fi

APP_VERSION="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$TAURI_DIR/tauri.conf.json" | head -n 1)"
if [ -z "$APP_VERSION" ]; then
  echo "Could not read the app version from src-tauri/tauri.conf.json." >&2
  exit 1
fi

stop_running_app() {
  /usr/bin/pkill -x "$EXECUTABLE_NAME" >/dev/null 2>&1 || true
}

build_bundle() {
  stop_running_app
  "$CARGO_BIN" build \
    --manifest-path "$TAURI_DIR/Cargo.toml" \
    --release \
    --locked \
    --offline

  /bin/mkdir -p "$DIST_DIR"
  local stage_dir
  stage_dir="$(/usr/bin/mktemp -d "$DIST_DIR/.agentic-movie-studio.XXXXXX")"
  trap '/bin/rm -rf "$stage_dir"' RETURN

  local stage_app="$stage_dir/$APP_NAME.app"
  local contents="$stage_app/Contents"
  /bin/mkdir -p "$contents/MacOS" "$contents/Resources"
  /usr/bin/ditto "$TAURI_DIR/target/release/$EXECUTABLE_NAME" "$contents/MacOS/$EXECUTABLE_NAME"
  /bin/chmod 755 "$contents/MacOS/$EXECUTABLE_NAME"
  /usr/bin/ditto "$TAURI_DIR/icons/icon.icns" "$contents/Resources/icon.icns"

  /bin/cat > "$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$EXECUTABLE_NAME</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$APP_VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeExtensions</key>
      <array>
        <string>ams</string>
        <string>studio</string>
        <string>scriptbreak</string>
      </array>
      <key>CFBundleTypeName</key>
      <string>Agentic Movie Studio Project</string>
      <key>CFBundleTypeRole</key>
      <string>Editor</string>
    </dict>
  </array>
</dict>
</plist>
PLIST

  /usr/bin/plutil -lint "$contents/Info.plist" >/dev/null
  /usr/bin/codesign --force --deep --sign - "$stage_app"
  /usr/bin/codesign --verify --deep --strict "$stage_app"

  if [ -e "$PROJECT_APP" ]; then
    /bin/rm -rf -- "$PROJECT_APP"
  fi
  /bin/mv "$stage_app" "$PROJECT_APP"
  /bin/rm -rf -- "$stage_dir"
  trap - RETURN
}

install_bundle() {
  if [ -w "/Applications" ]; then
    local install_stage
    install_stage="$(/usr/bin/mktemp -d "/Applications/.agentic-movie-studio.XXXXXX")"
    trap '/bin/rm -rf "$install_stage"' RETURN
    /usr/bin/ditto "$PROJECT_APP" "$install_stage/$APP_NAME.app"
    /usr/bin/codesign --verify --deep --strict "$install_stage/$APP_NAME.app"

    if [ -e "$INSTALLED_APP" ]; then
      /bin/rm -rf -- "$INSTALLED_APP"
    fi
    /bin/mv "$install_stage/$APP_NAME.app" "$INSTALLED_APP"
    /bin/rm -rf -- "$install_stage"
    trap - RETURN
  elif [ -d "$INSTALLED_APP" ] && [ -w "$INSTALLED_APP" ]; then
    # This account owns the existing bundle but cannot create a new top-level
    # item in /Applications. Replace its Contents atomically inside that exact
    # bundle so the app stays in /Applications and no rollback copy remains.
    local new_contents="$INSTALLED_APP/Contents.installing.$$"
    local old_contents="$INSTALLED_APP/Contents.replaced.$$"
    /usr/bin/ditto "$PROJECT_APP/Contents" "$new_contents"
    /bin/mv "$INSTALLED_APP/Contents" "$old_contents"
    if ! /bin/mv "$new_contents" "$INSTALLED_APP/Contents"; then
      /bin/mv "$old_contents" "$INSTALLED_APP/Contents"
      echo "Could not replace the installed app contents." >&2
      exit 1
    fi
    /bin/rm -rf -- "$old_contents"
  else
    echo "Agentic Movie Studio must be installed in /Applications, and the existing bundle is not writable." >&2
    exit 1
  fi

  if [ -e "$LEGACY_APP" ]; then
    if [ -w "/Applications" ]; then
      /bin/rm -rf -- "$LEGACY_APP"
    else
      echo "The legacy /Applications/Studio.app exists but cannot be removed by this account." >&2
      exit 1
    fi
  fi
  /usr/bin/xattr -cr "$INSTALLED_APP" 2>/dev/null || true
  /usr/bin/codesign --verify --deep --strict "$INSTALLED_APP"
}

launch_and_verify() {
  local app_bundle="$1"
  /usr/bin/open -n "$app_bundle"
  for _ in {1..20}; do
    if /usr/bin/pgrep -x "$EXECUTABLE_NAME" >/dev/null 2>&1; then
      return 0
    fi
    /bin/sleep 0.25
  done
  echo "$APP_NAME did not remain running after launch." >&2
  exit 1
}

case "$MODE" in
  run)
    build_bundle
    launch_and_verify "$PROJECT_APP"
    ;;
  --install|install)
    build_bundle
    install_bundle
    launch_and_verify "$INSTALLED_APP"
    ;;
  --verify|verify)
    build_bundle
    launch_and_verify "$PROJECT_APP"
    ;;
  --debug|debug)
    build_bundle
    lldb -- "$PROJECT_APP/Contents/MacOS/$EXECUTABLE_NAME"
    ;;
  --logs|logs)
    build_bundle
    launch_and_verify "$PROJECT_APP"
    /usr/bin/log stream --info --style compact --predicate "process == \"$EXECUTABLE_NAME\""
    ;;
  --telemetry|telemetry)
    build_bundle
    launch_and_verify "$PROJECT_APP"
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  *)
    echo "usage: $0 [run|--install|--verify|--debug|--logs|--telemetry]" >&2
    exit 2
    ;;
esac
