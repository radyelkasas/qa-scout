#!/bin/bash
# One-time (idempotent) setup: installs playwright-core next to the skill and finds a Chromium build.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
if [ ! -d node_modules/playwright-core ]; then
  echo "Installing playwright-core…"
  npm install --no-audit --no-fund --silent >/dev/null 2>&1 || npm install --no-audit --no-fund
fi
node "$DIR/scripts/find-browser.js"
