#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export DEBIAN_FRONTEND="${DEBIAN_FRONTEND:-noninteractive}"
USER_HOME="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}"
export PATH="${PATH}:${USER_HOME}/.cargo/bin"

pnpm_wrapper_dir=""
cleanup() {
  if [ -n "${pnpm_wrapper_dir}" ]; then
    rm -rf "${pnpm_wrapper_dir}"
  fi
}
trap cleanup EXIT

if command -v corepack >/dev/null 2>&1; then
  host_pnpm="$(command -v pnpm 2>/dev/null || true)"
  host_pnpm_dir=""
  if [ -n "${host_pnpm}" ]; then
    host_pnpm_dir="$(dirname "${host_pnpm}")"
  fi

  path_parts=()
  OLD_IFS="${IFS}"
  IFS=":"
  for path_entry in ${PATH}; do
    [ -n "${path_entry}" ] || continue
    if [ -n "${host_pnpm_dir}" ] && [ "${path_entry}" = "${host_pnpm_dir}" ]; then
      continue
    fi
    path_parts+=("${path_entry}")
  done
  IFS="${OLD_IFS}"

  pnpm_wrapper_dir="$(mktemp -d)"
  cat > "${pnpm_wrapper_dir}/pnpm" <<'EOF'
#!/usr/bin/env bash
exec corepack pnpm "$@"
EOF
  chmod +x "${pnpm_wrapper_dir}/pnpm"

  PATH="${pnpm_wrapper_dir}"
  for path_entry in "${path_parts[@]}"; do
    PATH="${PATH}:${path_entry}"
  done
  export PATH
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
