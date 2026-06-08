#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"
USER_HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"
export PATH="${PATH}:${USER_HOME}/.cargo/bin"
NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
if [ -n "${NPM_PREFIX}" ]; then
  export PATH="${PATH}:${NPM_PREFIX}/bin"
fi

if command -v apt-get >/dev/null 2>&1; then
  sudo dpkg --configure -a || true
  sudo apt-get -y --fix-broken install || true
  sudo apt-get update
  sudo apt-get install -y \
    cmake \
    ninja-build \
    lcov \
    libxml2-utils \
    graphviz \
    dwarfdump
fi

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
  case "${installer}" in
    */scripts/install-dependencies.sh)
      component_dir="$(cd "$(dirname "${installer}")/.." && pwd)"
      ;;
    *)
      component_dir="$(cd "$(dirname "${installer}")" && pwd)"
      ;;
  esac
  component_name="$(basename "${component_dir}")"
  run_step "${component_name} dependencies" "${installer}" "${component_dir}"
done <<EOF
$(find "${ROOT_DIR}/tools" "${ROOT_DIR}/apps" -maxdepth 3 -type f -name 'install-dependencies.sh' | sort)
EOF
