#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
patch_dir="${MORPHEUS_LIBAFL_PATCH_DIR:-}"
cargo_arg_file="${MORPHEUS_LIBAFL_CARGO_ARG_FILE:-}"
reuse_build_dir="${MORPHEUS_LIBAFL_REUSE_BUILD_DIR:-false}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
stub_bin="${install_dir}/bin/libafl_nesting_stub"
bridge_dir="${build_dir}/qemu-libafl-bridge"
bridge_build_dir="${bridge_dir}/build"
bridge_lib="${bridge_build_dir}/libqemu-system-aarch64.so"
installed_bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"

mkdir -p "$(dirname "${result_file}")"
mkdir -p "${build_dir}" "${install_dir}/bin" "${install_dir}/lib"

if [ -n "${patch_dir}" ] && [ ! -d "${source_dir}/crates/libafl_nesting" ]; then
  "$(dirname "$0")/patch.sh"
fi

if [ ! -f "${source_dir}/Cargo.toml" ]; then
  echo "missing source Cargo.toml: ${source_dir}/Cargo.toml" >&2
  exit 1
fi
if [ ! -d "${source_dir}/crates/libafl_nesting" ]; then
  echo "missing libafl_nesting crate: ${source_dir}/crates/libafl_nesting" >&2
  exit 1
fi

cargo_args=()
if [ -n "${cargo_arg_file}" ] && [ -s "${cargo_arg_file}" ]; then
  mapfile -t cargo_args < "${cargo_arg_file}"
fi

common_cargo_args=(
  --manifest-path "${source_dir}/Cargo.toml"
  --target-dir "${build_dir}/target"
  -p libafl_nesting
  --features qemu-bridge-aarch64
)

if [ "${reuse_build_dir}" = "true" ] && [ -x "${stub_bin}" ]; then
  LIBAFL_QEMU_CLONE_DIR="${bridge_dir}" \
  cargo build "${common_cargo_args[@]}" --bin libafl_nesting_stub "${cargo_args[@]}"
  cp "${build_dir}/target/debug/libafl_nesting_stub" "${stub_bin}"
  if [ -f "${bridge_lib}" ]; then
    cp "${bridge_lib}" "${installed_bridge_lib}"
  fi
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"}}
EOF
  exit 0
fi

LIBAFL_QEMU_CLONE_DIR="${bridge_dir}" \
cargo build "${common_cargo_args[@]}" --bin libafl_nesting_stub "${cargo_args[@]}"
cp "${build_dir}/target/debug/libafl_nesting_stub" "${stub_bin}"
if [ -f "${bridge_lib}" ]; then
  cp "${bridge_lib}" "${installed_bridge_lib}"
fi

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","stub":"${stub_bin}","qemu_bridge_dir":"${bridge_dir}","qemu_bridge_lib":"${installed_bridge_lib}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
