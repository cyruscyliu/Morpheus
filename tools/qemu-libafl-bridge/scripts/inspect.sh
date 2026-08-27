#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE:?missing bridge source}"
build_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_DIR:?missing bridge build directory}"
install_dir="${MORPHEUS_QEMU_LIBAFL_BRIDGE_INSTALL_DIR:?missing bridge install directory}"
result_file="${MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?missing result file}}"
bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"
build_lib="${build_dir}/libqemu-system-aarch64.so"
linkinfo="${build_dir}/linkinfo.json"
bundle="${build_dir}/qemu-bundle/usr/local/share/qemu"

[ -d "${source_dir}" ] || {
  echo "missing bridge source directory: ${source_dir}" >&2
  exit 1
}
[ -f "${bridge_lib}" ] || [ -f "${build_lib}" ] || {
  echo "missing LibAFL QEMU bridge library: ${bridge_lib}" >&2
  exit 1
}
[ -f "${linkinfo}" ] || {
  echo "missing LibAFL QEMU bridge linkinfo: ${linkinfo}" >&2
  exit 1
}
[ -d "${bundle}" ] || {
  echo "missing LibAFL QEMU bridge data bundle: ${bundle}" >&2
  exit 1
}

library_path="${bridge_lib}"
[ -f "${library_path}" ] || library_path="${build_lib}"
library_version="$(file -b "${library_path}" 2>/dev/null || true)"
cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","library":"${library_path}","library_type":"${library_version}","linkinfo":"${linkinfo}","data_dir":"${bundle}"},"artifacts":[{"path":"qemu-bridge-lib","location":"${library_path}"},{"path":"qemu-bridge-data-dir","location":"${bundle}"},{"path":"qemu-bridge-linkinfo","location":"${linkinfo}"}]}
EOF
