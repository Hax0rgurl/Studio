#!/usr/bin/env bash
# Agentic Movie Studio macOS installer
set -euo pipefail

REPO="Hax0rgurl/Studio"
DEST="/Applications"
APP="$DEST/Agentic Movie Studio.app"
OLD_APP="$DEST/Studio.app"

if [ ! -w "$DEST" ]; then
  echo "Agentic Movie Studio installs in /Applications. Run this installer from an administrator account." >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) pattern='aarch64.*\.app\.tar\.gz$' ;;
  x86_64) pattern='x64.*\.app\.tar\.gz$' ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

download_url="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | sed -n 's/.*"browser_download_url": "\([^"]*\)".*/\1/p' \
  | grep -E "$pattern" \
  | head -n 1)"

if [ -z "$download_url" ]; then
  echo "No compatible Agentic Movie Studio release was found for $(uname -m)." >&2
  exit 1
fi

archive="$tmp_dir/agentic-movie-studio.app.tar.gz"
echo "Downloading Agentic Movie Studio for $(uname -m)…"
curl -fL --progress-bar "$download_url" -o "$archive"

echo "Installing Agentic Movie Studio in /Applications…"
rm -rf "$APP"
tar -xzf "$archive" -C "$DEST"
if [ ! -d "$APP" ]; then
  echo "The release archive did not contain Agentic Movie Studio.app." >&2
  exit 1
fi
rm -rf "$OLD_APP"
xattr -cr "$APP" 2>/dev/null || true

echo "Agentic Movie Studio is installed."
open "$APP"
