#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:-}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:-}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
bridge_dir="${build_dir}/qemu-libafl-bridge"
bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"
stub_bin="${install_dir}/bin/libafl_nesting_stub"

mkdir -p "$(dirname "${result_file}")"

version=""
if [ -d "${source_dir}/.git" ]; then
  version="$(git -C "${source_dir}" rev-parse HEAD)"
fi

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","version":"${version}"},"artifacts":[{"path":"crate-dir","location":"${source_dir}/crates/libafl_nesting"},{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${bridge_lib}"}]}
EOF
