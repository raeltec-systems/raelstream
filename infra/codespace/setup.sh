#!/usr/bin/env bash
# Runs once when the Codespace is created (docs/runbooks/codespaces.md).
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> Installing tools"
sudo apt-get update -qq && sudo apt-get install -y -qq qrencode >/dev/null || echo "(qrencode not installed: QR codes will be shown as text links)"
corepack enable
pnpm install --frozen-lockfile

echo "==> Building the control CLI and the supervisor bundle"
pnpm --filter @raelstream/control --filter @raelstream/supervisor build
