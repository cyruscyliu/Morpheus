#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${REPO_ROOT}"
pnpm install

# Keep local browser tooling ready when Playwright is available.
if pnpm exec playwright --version >/dev/null 2>&1; then
  pnpm exec playwright install chromium
fi
