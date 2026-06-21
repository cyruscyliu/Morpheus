#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../../../../../../tools/_shared/scripts/parallelism.sh"

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
bridge_storage_dir="${MORPHEUS_LIBAFL_BRIDGE_STORAGE_DIR:-/tmp/morpheus-libafl-qemu-libafl-bridge}"
bridge_build_dir="${bridge_storage_dir}/build"
bridge_lib="${bridge_build_dir}/libqemu-system-aarch64.so"
installed_bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"
stub_c_src="${source_dir}/crates/libafl_nesting/c_src/libafl_nesting_stub.c"
crate_src_dir="${source_dir}/crates/libafl_nesting"
fuzzer_src_dir="${source_dir}/fuzzers/full_system/qemu_nesting"
fuzzer_fingerprint_file="${install_dir}/.qemu_nesting.sources.fingerprint"
host_target_dir="${MORPHEUS_LIBAFL_HOST_TARGET_DIR:-/tmp/morpheus-libafl-target-host}"
fuzzer_target_dir="${MORPHEUS_LIBAFL_FUZZER_TARGET_DIR:-/tmp/morpheus-libafl-target-fuzzer}"
libvharness_url="${MORPHEUS_LIBAFL_LIBVHARNESS_URL:-https://github.com/rmalmain/libvharness.git}"
libvharness_commit="${MORPHEUS_LIBAFL_LIBVHARNESS_COMMIT:-9a316966ce7aa4bd9f733491511e6ac4be6dd980}"

[ -d "${HOME}/.cargo/bin" ] && export PATH="${HOME}/.cargo/bin:${PATH}"
[ -n "${CARGO_BUILD_JOBS:-}" ] || export CARGO_BUILD_JOBS="$(morpheus_default_jobs)"
export RUSTFLAGS="${RUSTFLAGS:-} -A deprecated"
export RUSTFLAGS="${RUSTFLAGS:-}"

rustc_fingerprint="$(rustc -vV)"
refresh_cargo_target_dir() {
  local target_dir="$1"
  local fingerprint_file="${target_dir}/.morpheus-rustc-fingerprint"
  if [ -d "${target_dir}" ] && { [ ! -f "${fingerprint_file}" ] || [ "$(cat "${fingerprint_file}")" != "${rustc_fingerprint}" ]; }; then
    rm -rf "${target_dir}"
  fi
  mkdir -p "${target_dir}"
  printf '%s\n' "${rustc_fingerprint}" > "${fingerprint_file}"
}

refresh_cargo_target_dir "${host_target_dir}"
refresh_cargo_target_dir "${fuzzer_target_dir}"

if [ ! -e "${bridge_dir}" ] && [ ! -L "${bridge_dir}" ]; then
  mkdir -p "${bridge_storage_dir}"
  ln -s "${bridge_storage_dir}" "${bridge_dir}"
elif [ -L "${bridge_dir}" ]; then
  mkdir -p "$(readlink "${bridge_dir}")"
fi

if [ -n "${patch_dir}" ]; then
  "$(dirname "$0")/patch.sh"
fi

[ -f "${source_dir}/Cargo.toml" ] || { echo "missing source Cargo.toml: ${source_dir}/Cargo.toml" >&2; exit 1; }
[ -d "${crate_src_dir}" ] || { echo "missing libafl_nesting crate: ${crate_src_dir}" >&2; exit 1; }
[ -f "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" ] || { echo "missing qemu_nesting example: ${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" >&2; exit 1; }
[ -f "${stub_c_src}" ] || { echo "missing guest stub source: ${stub_c_src}" >&2; exit 1; }

stub_current() { [ -x "${stub_bin}" ] && [ "${stub_bin}" -nt "${stub_c_src}" ]; }
fuzzer_fingerprint() {
  find "${fuzzer_src_dir}" -type f \( -name '*.rs' -o -name 'Cargo.toml' \) -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}'
}
record_fuzzer_fingerprint() { fuzzer_fingerprint > "${fuzzer_fingerprint_file}"; }
fuzzer_current() {
  [ -x "${fuzzer_bin}" ] \
    && [ -f "${fuzzer_fingerprint_file}" ] \
    && [ "$(cat "${fuzzer_fingerprint_file}")" = "$(fuzzer_fingerprint)" ]
}

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

cargo_args=()
if [ -n "${cargo_arg_file}" ] && [ -s "${cargo_arg_file}" ]; then
  mapfile -t cargo_args < "${cargo_arg_file}"
fi

bridge_cargo_args=(
  --manifest-path "${source_dir}/Cargo.toml"
  --target-dir "${host_target_dir}"
  --jobs "${CARGO_BUILD_JOBS}"
  -p libafl_nesting
  --features qemu-bridge-aarch64
)
fuzzer_cargo_args=(
  --manifest-path "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml"
  --target-dir "${fuzzer_target_dir}"
  --jobs "${CARGO_BUILD_JOBS}"
  --no-default-features
  --features std,aarch64
)

build_guest_stub() {
  local vharness_root="${host_target_dir}/debug/libvharness"
  local vharness_include="${vharness_root}/include"
  local vharness_src="${vharness_root}/src/api/lqemu"
  local vharness_calls="${vharness_src}/arch/aarch64/calls.c"
  local vharness_rev="${vharness_root}/QEMU_REVISION"
  if [ ! -d "${vharness_root}" ] || [ ! -f "${vharness_rev}" ] || [ "$(cat "${vharness_rev}" 2>/dev/null || true)" != "${libvharness_commit}" ]; then
    rm -rf "${vharness_root}"
    mkdir -p "${vharness_root}"
    git -C "${vharness_root}" init
    git -C "${vharness_root}" remote add origin "${libvharness_url}"
    git -C "${vharness_root}" fetch --depth 1 origin "${libvharness_commit}"
    git -C "${vharness_root}" checkout FETCH_HEAD
    printf '%s' "${libvharness_commit}" > "${vharness_rev}"
  fi
  if [ ! -d "${vharness_include}" ] || [ ! -d "${vharness_src}" ] || [ ! -f "${vharness_calls}" ]; then
    echo "missing vendored libvharness sources under ${vharness_root}" >&2
    exit 1
  fi
  aarch64-linux-gnu-gcc \
    -O2 -static -no-pie -DLQEMU_SUPPORT_STDIO \
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

if [ "${reuse_build_dir}" = "true" ] && [ -x "${fuzzer_bin}" ] && [ ! -f "${fuzzer_fingerprint_file}" ] && [ -f "${installed_bridge_lib}" ]; then
  record_fuzzer_fingerprint
fi

if [ "${reuse_build_dir}" = "true" ] && stub_current && fuzzer_current && [ -f "${installed_bridge_lib}" ]; then
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && [ -f "${installed_bridge_lib}" ] && [ -d "${bridge_storage_dir}" ] && [ -d "${host_target_dir}/debug/libvharness/include" ] && [ -d "${host_target_dir}/debug/libvharness/src/api/lqemu" ] && [ -f "${host_target_dir}/debug/libvharness/src/api/lqemu/arch/aarch64/calls.c" ]; then
  fuzzer_rebuilt=false
  stub_rebuilt=false
  if ! fuzzer_current; then
    LIBAFL_QEMU_DIR="${bridge_storage_dir}" cargo build "${fuzzer_cargo_args[@]}" "${cargo_args[@]}"
    cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
    record_fuzzer_fingerprint
    fuzzer_rebuilt=true
  fi
  if ! stub_current; then
    build_guest_stub
    stub_rebuilt=true
  fi
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"fuzzer_rebuilt":${fuzzer_rebuilt},"stub_rebuilt":${stub_rebuilt},"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && stub_current && [ -f "${installed_bridge_lib}" ] && [ -d "${bridge_storage_dir}" ]; then
  LIBAFL_QEMU_DIR="${bridge_storage_dir}" cargo build "${fuzzer_cargo_args[@]}" "${cargo_args[@]}"
  cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
  record_fuzzer_fingerprint
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"fuzzer_rebuilt":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && [ -x "${stub_bin}" ]; then
  rm -rf "${bridge_build_dir}"
  LIBAFL_QEMU_CLONE_DIR="${bridge_storage_dir}" cargo build "${bridge_cargo_args[@]}" --lib "${cargo_args[@]}"
  rm -rf "${bridge_dir}"
  ln -s "${bridge_storage_dir}" "${bridge_dir}"
  LIBAFL_QEMU_DIR="${bridge_storage_dir}" cargo build "${fuzzer_cargo_args[@]}" "${cargo_args[@]}"
  build_guest_stub
  cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
  record_fuzzer_fingerprint
  if [ -f "${bridge_lib}" ]; then
    cp "${bridge_lib}" "${installed_bridge_lib}"
  fi
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

rm -rf "${bridge_build_dir}"
LIBAFL_QEMU_CLONE_DIR="${bridge_storage_dir}" cargo build "${bridge_cargo_args[@]}" --lib "${cargo_args[@]}"
rm -rf "${bridge_dir}"
ln -s "${bridge_storage_dir}" "${bridge_dir}"
LIBAFL_QEMU_DIR="${bridge_storage_dir}" cargo build "${fuzzer_cargo_args[@]}" "${cargo_args[@]}"
build_guest_stub
cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
record_fuzzer_fingerprint
if [ -f "${bridge_lib}" ]; then
  cp "${bridge_lib}" "${installed_bridge_lib}"
fi

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","stub":"${stub_bin}","fuzzer":"${fuzzer_bin}","qemu_bridge_dir":"${bridge_dir}","qemu_bridge_lib":"${installed_bridge_lib}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
