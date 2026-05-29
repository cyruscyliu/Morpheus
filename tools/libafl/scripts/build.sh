#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
patch_dir="${MORPHEUS_LIBAFL_PATCH_DIR:-}"
cargo_arg_file="${MORPHEUS_LIBAFL_CARGO_ARG_FILE:-}"
reuse_build_dir="${MORPHEUS_LIBAFL_REUSE_BUILD_DIR:-false}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
guest_target="aarch64-unknown-linux-gnu"
stub_bin="${install_dir}/bin/libafl_nesting_stub"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
bridge_dir="${build_dir}/qemu-libafl-bridge"
bridge_build_dir="${bridge_dir}/build"
bridge_lib="${bridge_build_dir}/libqemu-system-aarch64.so"
installed_bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"
stub_c_src="${source_dir}/crates/libafl_nesting/c_src/libafl_nesting_stub.c"

mkdir -p "$(dirname "${result_file}")"
mkdir -p "${build_dir}" "${install_dir}/bin" "${install_dir}/lib"

if [ -n "${patch_dir}" ]; then
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
if [ ! -f "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" ]; then
  echo "missing qemu_nesting example: ${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" >&2
  exit 1
fi
if [ ! -f "${stub_c_src}" ]; then
  echo "missing guest stub source: ${stub_c_src}" >&2
  exit 1
fi
if ! command -v aarch64-linux-gnu-gcc >/dev/null 2>&1; then
  echo "missing aarch64-linux-gnu-gcc; run tools/libafl/scripts/install-dependencies.sh" >&2
  exit 1
fi
if [ ! -f "/usr/lib/x86_64-linux-gnu/libglib-2.0.so" ]; then
  echo "missing /usr/lib/x86_64-linux-gnu/libglib-2.0.so; run tools/libafl/scripts/install-dependencies.sh" >&2
  exit 1
fi
if ! rustup target list --installed | grep -qx "${guest_target}"; then
  echo "missing rust target ${guest_target}; run 'rustup target add ${guest_target}'" >&2
  exit 1
fi

if ! command -v llvm-config >/dev/null 2>&1; then
  if command -v llvm-config-19 >/dev/null 2>&1; then
    export LLVM_CONFIG="llvm-config-19"
  else
    echo "missing llvm-config; install llvm or provide LLVM_CONFIG" >&2
    exit 1
  fi
fi

qemu_build_rs="${source_dir}/crates/libafl_qemu/libafl_qemu_build/src/build.rs"
if [ -f "${qemu_build_rs}" ]; then
  sed -i \
    -e 's#// \\.arg#// .arg#g' \
    -e 's#// .arg(\"--disable-gtk\")#.arg(\"--disable-gtk\")#' \
    -e 's#// .arg(\"--disable-guest-agent\")#.arg(\"--disable-guest-agent\")#' \
    -e 's#// .arg(\"--disable-guest-agent-msi\")#.arg(\"--disable-guest-agent-msi\")#' \
    "${qemu_build_rs}"
fi

rm -rf "${bridge_build_dir}"

cargo_args=()
if [ -n "${cargo_arg_file}" ] && [ -s "${cargo_arg_file}" ]; then
  mapfile -t cargo_args < "${cargo_arg_file}"
fi

bridge_cargo_args=(
  --manifest-path "${source_dir}/Cargo.toml"
  --target-dir "${build_dir}/target-host"
  -p libafl_nesting
  --features qemu-bridge-aarch64
)

fuzzer_cargo_args=(
  --manifest-path "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml"
  --target-dir "${build_dir}/target-fuzzer"
  --no-default-features
  --features std,aarch64
)

build_guest_stub() {
  local vharness_root="${build_dir}/target-host/debug/libvharness"
  local vharness_include="${vharness_root}/include"
  local vharness_src="${vharness_root}/src/api/lqemu"
  local vharness_calls="${vharness_src}/arch/aarch64/calls.c"

  if [ ! -d "${vharness_include}" ] || [ ! -d "${vharness_src}" ] || [ ! -f "${vharness_calls}" ]; then
    echo "missing vendored libvharness sources under ${vharness_root}" >&2
    exit 1
  fi

  aarch64-linux-gnu-gcc \
    -O2 \
    -static \
    -no-pie \
    -DLQEMU_SUPPORT_STDIO \
    -I "${vharness_include}" \
    -I "${vharness_include}/api/lqemu" \
    -I "${vharness_include}/compiler/gcc" \
    -I "${vharness_include}/platform/generic" \
    -I "${vharness_include}/arch/aarch64" \
    "${stub_c_src}" \
    "${vharness_calls}" \
    "${vharness_src}/lqemu.c" \
    "${vharness_src}/vharness_api.c" \
    -o "${stub_bin}"
}

if [ "${reuse_build_dir}" = "true" ] && [ -x "${stub_bin}" ]; then
  LIBAFL_QEMU_CLONE_DIR="${bridge_dir}" \
  cargo build "${bridge_cargo_args[@]}" --lib "${cargo_args[@]}"
  LIBAFL_QEMU_DIR="${bridge_dir}" \
  cargo build "${fuzzer_cargo_args[@]}"
  build_guest_stub
  cp "${build_dir}/target-fuzzer/debug/qemu_nesting" "${fuzzer_bin}"
  if [ -f "${bridge_lib}" ]; then
    cp "${bridge_lib}" "${installed_bridge_lib}"
  fi
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

LIBAFL_QEMU_CLONE_DIR="${bridge_dir}" \
cargo build "${bridge_cargo_args[@]}" --lib "${cargo_args[@]}"
LIBAFL_QEMU_DIR="${bridge_dir}" \
cargo build "${fuzzer_cargo_args[@]}"
build_guest_stub
cp "${build_dir}/target-fuzzer/debug/qemu_nesting" "${fuzzer_bin}"
if [ -f "${bridge_lib}" ]; then
  cp "${bridge_lib}" "${installed_bridge_lib}"
fi

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","stub":"${stub_bin}","fuzzer":"${fuzzer_bin}","qemu_bridge_dir":"${bridge_dir}","qemu_bridge_lib":"${installed_bridge_lib}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
