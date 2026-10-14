#!/bin/bash
# QA Scout installer — by Rady Elkasas (https://radyelkasas.com/)
# Usage: ./install.sh [--project <path>] [--copy]
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST_ROOT="$HOME/.claude/skills"; MODE=link
while [ $# -gt 0 ]; do
  case "$1" in
    --project) DEST_ROOT="$(cd "$2" && pwd)/.claude/skills"; shift 2;;
    --copy) MODE=copy; shift;;
    *) echo "Unknown option $1"; exit 1;;
  esac
done
DEST="$DEST_ROOT/qa-scout"
mkdir -p "$DEST_ROOT"
( cd "$SRC" && npm install --no-audit --no-fund --silent )
if [ -e "$DEST" ] || [ -L "$DEST" ]; then echo "Replacing existing $DEST"; rm -rf "$DEST"; fi
if [ "$MODE" = link ]; then ln -s "$SRC" "$DEST"; else mkdir -p "$DEST" && cp -R "$SRC/." "$DEST/" && rm -f "$DEST/.last-config.json"; fi
node "$SRC/scripts/find-browser.js" || echo "→ Install a browser: npx playwright@1.56.1 install chromium (or set QA_BROWSER)"
echo "✔ QA Scout installed at $DEST ($MODE). In Claude Code say: \"run QA Scout\" or /qa-scout"
