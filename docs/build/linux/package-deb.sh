#!/usr/bin/env bash
# Build a Debian package from a Flutter Linux release bundle.
#
# Usage:
#   package-deb.sh <version> <bundle-dir> <output-dir> [amd64|arm64]
#
# Example:
#   package-deb.sh 0.1.0 \
#     apps/mobile/build/linux/x64/release/bundle \
#     apps/mobile/build/artifacts amd64
#
# Requires: dpkg-deb, bash, coreutils. rsvg-convert is optional (app icon).
# This script only packages an existing bundle; it never builds Flutter and
# never reads signing keys.

set -euo pipefail

VERSION="${1:?usage: package-deb.sh <version> <bundle-dir> <output-dir> [arch]}"
BUNDLE_DIR="${2:?usage: package-deb.sh <version> <bundle-dir> <output-dir> [arch]}"
OUT_DIR="${3:?usage: package-deb.sh <version> <bundle-dir> <output-dir> [arch]}"
ARCH="${4:-amd64}"

case "$ARCH" in
  amd64|arm64) ;;
  *)
    echo "unsupported architecture: $ARCH (expected amd64 or arm64)" >&2
    exit 2
    ;;
esac

if ! command -v dpkg-deb >/dev/null 2>&1; then
  echo "dpkg-deb not found; run this script on Debian/Ubuntu" >&2
  exit 1
fi

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "bundle directory not found: $BUNDLE_DIR" >&2
  exit 1
fi

if [ ! -x "$BUNDLE_DIR/kedaya" ]; then
  echo "missing Flutter executable: $BUNDLE_DIR/kedaya" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
# Debian sorts 0.1.0~rc1 before 0.1.0, which is the intended semver meaning.
DEB_VERSION="${VERSION//-/\~}"

PKG_ROOT="$(mktemp -d)"
trap 'rm -rf "$PKG_ROOT"' EXIT

install -d \
  "$PKG_ROOT/DEBIAN" \
  "$PKG_ROOT/usr/bin" \
  "$PKG_ROOT/usr/lib/kedaya" \
  "$PKG_ROOT/usr/share/applications" \
  "$PKG_ROOT/usr/share/icons/hicolor/256x256/apps"

cp -a "$BUNDLE_DIR/." "$PKG_ROOT/usr/lib/kedaya/"

cat > "$PKG_ROOT/usr/bin/kedaya" <<'EOF'
#!/bin/sh
exec /usr/lib/kedaya/kedaya "$@"
EOF
chmod 0755 "$PKG_ROOT/usr/bin/kedaya"

cat > "$PKG_ROOT/usr/share/applications/kedaya.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Kedaya
Comment=Kedaya campus service client
Exec=kedaya
Icon=kedaya
Terminal=false
Categories=Utility;
EOF
chmod 0644 "$PKG_ROOT/usr/share/applications/kedaya.desktop"

if command -v rsvg-convert >/dev/null 2>&1 \
  && [ -f "$REPO_ROOT/assets/brand/kedaya-mascot.svg" ]; then
  if rsvg-convert -w 256 -h 256 \
    "$REPO_ROOT/assets/brand/kedaya-mascot.svg" \
    -o "$PKG_ROOT/usr/share/icons/hicolor/256x256/apps/kedaya.png"; then
    chmod 0644 "$PKG_ROOT/usr/share/icons/hicolor/256x256/apps/kedaya.png"
  else
    echo "warning: rsvg-convert failed; building the deb without an icon" >&2
    rm -f "$PKG_ROOT/usr/share/icons/hicolor/256x256/apps/kedaya.png"
  fi
fi

INSTALLED_SIZE="$(du -sk "$PKG_ROOT/usr" | cut -f1)"

cat > "$PKG_ROOT/DEBIAN/control" <<EOF
Package: kedaya
Version: $DEB_VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Kedaya <dev@kedaya.local>
Installed-Size: $INSTALLED_SIZE
Depends: libgtk-3-0 | libgtk-3-0t64, libsecret-1-0 | libsecret-1-0t64, libgstreamer1.0-0, libgstreamer-plugins-base1.0-0
Description: Kedaya campus service client
 A Flutter desktop client for the Kedaya campus service platform.
EOF
chmod 0644 "$PKG_ROOT/DEBIAN/control"

mkdir -p "$OUT_DIR"
dpkg-deb --build --root-owner-group "$PKG_ROOT" \
  "$OUT_DIR/kedaya_${DEB_VERSION}_${ARCH}.deb"
