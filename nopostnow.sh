#!/usr/bin/env sh
# NoPostNow launcher for Linux and macOS.
#
#   sh nopostnow.sh            open the control panel (sets up on first run)
#   sh nopostnow.sh start      run in the terminal, with no window
#   sh nopostnow.sh setup      change settings from the terminal
#   sh nopostnow.sh users ...  manage accounts (see: sh nopostnow.sh users)
#
# Needs Node.js 22.18 or newer. If it is missing, this script downloads an
# official copy into ./.runtime — nothing is installed system-wide.
set -eu

cd "$(dirname "$0")"

NODE_VERSION="v24.21.0"
RUNTIME=".runtime/node"

node_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null
}

if [ -x "$RUNTIME/bin/node" ] && node_ok "$RUNTIME/bin/node"; then
  PATH="$(pwd)/$RUNTIME/bin:$PATH"
elif command -v node >/dev/null 2>&1 && node_ok node; then
  :
else
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) echo "Unsupported system. Install Node.js 22.18+ from https://nodejs.org and run this again." >&2; exit 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) echo "Unsupported processor. Install Node.js 22.18+ from https://nodejs.org and run this again." >&2; exit 1 ;;
  esac
  file="node-$NODE_VERSION-$os-$arch.tar.gz"
  base="https://nodejs.org/dist/$NODE_VERSION"
  echo "Node.js 22.18+ was not found. Downloading $file from nodejs.org ..."
  mkdir -p .runtime
  curl -fsSL "$base/$file" -o ".runtime/$file"
  curl -fsSL "$base/SHASUMS256.txt" -o ".runtime/SHASUMS256.txt"
  want="$(grep " $file\$" .runtime/SHASUMS256.txt | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then
    got="$(sha256sum ".runtime/$file" | cut -d' ' -f1)"
  else
    got="$(shasum -a 256 ".runtime/$file" | cut -d' ' -f1)"
  fi
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    echo "The download did not match its published checksum. Nothing was installed." >&2
    rm -f ".runtime/$file"
    exit 1
  fi
  rm -rf "$RUNTIME"
  mkdir -p "$RUNTIME"
  tar -xzf ".runtime/$file" -C "$RUNTIME" --strip-components=1
  rm -f ".runtime/$file" .runtime/SHASUMS256.txt
  PATH="$(pwd)/$RUNTIME/bin:$PATH"
fi
export PATH

# Installed once, and again whenever an update changes what is needed.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies ..."
  npm ci --no-audit --no-fund
fi

case "${1:-}" in
  setup) shift; exec node scripts/setup.mjs "$@" ;;
  users) shift; exec node scripts/users.mjs "$@" ;;
  "" | start)
    # With a desktop, open the control panel. On a machine with no screen
    # (a server reached over SSH), use the terminal instead.
    if [ "${1:-}" != start ] && { [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || [ "$(uname -s)" = Darwin ]; }; then
      exec node scripts/panel.mjs
    fi
    if ! node scripts/configured.mjs; then
      node scripts/setup.mjs
    fi
    exec node scripts/start.mjs
    ;;
  panel) shift; exec node scripts/panel.mjs "$@" ;;
  *) echo "Usage: sh nopostnow.sh [panel | start | setup | users ...]" >&2; exit 1 ;;
esac
