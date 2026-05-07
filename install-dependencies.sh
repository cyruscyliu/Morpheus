#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

run_step() {
  local label="$1"
  shift
  echo "==> ${label}"
  "$@"
}

run_step "pnpm" \
  npm install -g pnpm@10.8.1

while IFS= read -r installer; do
  [ -n "${installer}" ] || continue
  tool_dir="$(cd "$(dirname "${installer}")/.." && pwd)"
  tool_name="$(basename "${tool_dir}")"
  run_step "${tool_name} dependencies" "${installer}" "${tool_dir}"
done <<EOF
$(find "${ROOT_DIR}/tools" -maxdepth 3 -type f -name 'install-dependencies.sh' | sort)
EOF
