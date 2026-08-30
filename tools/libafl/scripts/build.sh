#!/usr/bin/env bash
set -euo pipefail

repo_root="${MORPHEUS_REPO_ROOT:?missing MORPHEUS_REPO_ROOT}"
source "${repo_root}/tools/_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_LIBAFL_SOURCE:?}"
build_dir="${MORPHEUS_LIBAFL_BUILD_DIR:?}"
install_dir="${MORPHEUS_LIBAFL_INSTALL_DIR:?}"
cargo_arg_file="${MORPHEUS_LIBAFL_CARGO_ARG_FILE:-}"
reuse_build_dir="${MORPHEUS_LIBAFL_REUSE_BUILD_DIR:-false}"
result_file="${MORPHEUS_LIBAFL_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
tmp_root="${build_dir}/tmp"
guest_target="aarch64-unknown-linux-gnu"
stub_bin="${install_dir}/bin/libafl_nesting_stub"
stub_fingerprint_file="${install_dir}/.libafl_nesting_stub.fingerprint"
device_backend_src="${source_dir}/crates/libafl_nesting/c_src/libafl_device_backend.c"
device_backend_bin="${install_dir}/bin/libafl_device_backend"
device_backend_fingerprint_file="${install_dir}/.libafl_device_backend.fingerprint"
fuzzer_bin="${install_dir}/bin/qemu_nesting"
bridge_dir="${build_dir}/qemu-libafl-bridge"
bridge_source_override="${MORPHEUS_LIBAFL_QEMU_BRIDGE_SOURCE:-${MORPHEUS_LIBAFL_QEMU_BRIDGE_DIR:-${MORPHEUS_LIBAFL_QEMU_BRIDGE:-}}}"
if [ -z "${bridge_source_override}" ]; then
  echo "missing external LibAFL QEMU bridge source; pass --qemu-bridge-source" >&2
  exit 1
fi
if [[ "${bridge_source_override}" != /* ]]; then
  bridge_source_override="${repo_root}/${bridge_source_override#./}"
fi
bridge_storage_dir="${bridge_source_override}"
bridge_build_dir="${bridge_storage_dir}/build"
bridge_lib_override="${MORPHEUS_LIBAFL_QEMU_BRIDGE_LIBRARY:-}"
bridge_data_dir_override="${MORPHEUS_LIBAFL_QEMU_BRIDGE_DATA_DIR:-}"
if [ -n "${bridge_lib_override}" ] && [[ "${bridge_lib_override}" != /* ]]; then
  bridge_lib_override="${repo_root}/${bridge_lib_override#./}"
fi
if [ -n "${bridge_data_dir_override}" ] && [[ "${bridge_data_dir_override}" != /* ]]; then
  bridge_data_dir_override="${repo_root}/${bridge_data_dir_override#./}"
fi
bridge_lib="${bridge_lib_override:-${bridge_build_dir}/libqemu-system-aarch64.so}"
installed_bridge_lib="${install_dir}/lib/libqemu-system-aarch64.so"
bridge_config_fingerprint_file="${install_dir}/.qemu_bridge.config"
bridge_config_version="virtfs-9p-cow-v2"
stub_c_src="${source_dir}/crates/libafl_nesting/c_src/libafl_nesting_stub.c"
crate_src_dir="${source_dir}/crates/libafl_nesting"
fuzzer_src_dir="${source_dir}/fuzzers/full_system/qemu_nesting"
fuzzer_fingerprint_file="${install_dir}/.qemu_nesting.sources.fingerprint"
host_target_dir="${MORPHEUS_LIBAFL_HOST_TARGET_DIR:-${tmp_root}/target-host}"
fuzzer_target_dir="${MORPHEUS_LIBAFL_FUZZER_TARGET_DIR:-${tmp_root}/target-fuzzer}"
libvharness_url="${MORPHEUS_LIBAFL_LIBVHARNESS_URL:-https://github.com/rmalmain/libvharness.git}"
libvharness_commit="${MORPHEUS_LIBAFL_LIBVHARNESS_COMMIT:-9a316966ce7aa4bd9f733491511e6ac4be6dd980}"

[ -d "${HOME}/.cargo/bin" ] && export PATH="${HOME}/.cargo/bin:${PATH}"
[ -n "${CARGO_BUILD_JOBS:-}" ] || export CARGO_BUILD_JOBS="$(morpheus_default_jobs)"
export RUSTFLAGS="${RUSTFLAGS:-} -A deprecated"
export RUSTFLAGS="${RUSTFLAGS:-}"

mkdir -p "${tmp_root}"

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

link_bridge_dir() {
  if [ -L "${bridge_dir}" ]; then
    if [ "$(readlink -f "${bridge_dir}")" = "$(readlink -f "${bridge_storage_dir}")" ]; then
      return 0
    fi
    rm -f "${bridge_dir}"
  elif [ -e "${bridge_dir}" ]; then
    echo "bridge link path is occupied by a non-symlink: ${bridge_dir}" >&2
    exit 1
  fi
  ln -s "${bridge_storage_dir}" "${bridge_dir}"
}

[ -d "${bridge_storage_dir}" ] || {
  echo "missing external LibAFL QEMU bridge source: ${bridge_storage_dir}" >&2
  exit 1
}
link_bridge_dir

[ -f "${source_dir}/Cargo.toml" ] || { echo "missing source Cargo.toml: ${source_dir}/Cargo.toml" >&2; exit 1; }
[ -d "${crate_src_dir}" ] || { echo "missing libafl_nesting crate: ${crate_src_dir}" >&2; exit 1; }
[ -f "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" ] || { echo "missing qemu_nesting example: ${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" >&2; exit 1; }
[ -f "${stub_c_src}" ] || { echo "missing guest stub source: ${stub_c_src}" >&2; exit 1; }
[ -f "${device_backend_src}" ] || { echo "missing seed device backend source: ${device_backend_src}" >&2; exit 1; }
validate_external_bridge() {
  [ -x "${bridge_storage_dir}/configure" ] || {
    echo "external LibAFL QEMU bridge is missing configure: ${bridge_storage_dir}" >&2
    exit 1
  }
  [ -x "${bridge_storage_dir}/linker_interceptor.py" ] || {
    echo "external LibAFL QEMU bridge is missing linker_interceptor.py: ${bridge_storage_dir}" >&2
    exit 1
  }
  [ -x "${bridge_storage_dir}/linker_interceptor++.py" ] || {
    echo "external LibAFL QEMU bridge is missing linker_interceptor++.py: ${bridge_storage_dir}" >&2
    exit 1
  }
  [ -f "${bridge_lib}" ] || {
    echo "external LibAFL QEMU bridge is missing its configured library: ${bridge_lib}" >&2
    exit 1
  }
  [ -f "${bridge_build_dir}/linkinfo.json" ] || {
    echo "external LibAFL QEMU bridge is missing linkinfo.json: ${bridge_build_dir}" >&2
    exit 1
  }
  source_bridge_lib="${bridge_build_dir}/libqemu-system-aarch64.so"
  [ -f "${source_bridge_lib}" ] || {
    echo "external LibAFL QEMU bridge is missing its source build library: ${source_bridge_lib}" >&2
    exit 1
  }
  cmp -s "${bridge_lib}" "${source_bridge_lib}" || {
    echo "configured bridge library differs from the library in the configured bridge source" >&2
    echo "  configured: ${bridge_lib}" >&2
    echo "  source:     ${source_bridge_lib}" >&2
    exit 1
  }
  [ -d "${bridge_data_dir_override:-${bridge_build_dir}/qemu-bundle/usr/local/share/qemu}" ] || {
    echo "external LibAFL QEMU bridge is missing its configured data dir: ${bridge_data_dir_override:-${bridge_build_dir}/qemu-bundle/usr/local/share/qemu}" >&2
    exit 1
  }
}
validate_external_bridge

mkdir -p "${install_dir}/bin" "${install_dir}/lib"

stub_fingerprint() {
  {
    printf '%s\n' "${libvharness_commit}"
    sha256sum "${stub_c_src}" | awk '{print $1}'
  } | sha256sum | awk '{print $1}'
}
record_stub_fingerprint() { stub_fingerprint > "${stub_fingerprint_file}"; }
stub_current() {
  [ -x "${stub_bin}" ] \
    && [ -f "${stub_fingerprint_file}" ] \
    && [ "$(cat "${stub_fingerprint_file}")" = "$(stub_fingerprint)" ]
}
fuzzer_fingerprint() {
  {
    printf 'qemu-bridge-config=%s\n' "${bridge_config_fingerprint}"
    find "${fuzzer_src_dir}" "${crate_src_dir}" -type f \
      \( -name '*.rs' -o -name 'Cargo.toml' -o -name 'build.rs' \) -print0 \
      | sort -z \
      | xargs -0 sha256sum
  } | sha256sum | awk '{print $1}'
}
record_fuzzer_fingerprint() { fuzzer_fingerprint > "${fuzzer_fingerprint_file}"; }
fuzzer_current() {
  [ -x "${fuzzer_bin}" ] \
    && [ -f "${fuzzer_fingerprint_file}" ] \
    && [ "$(cat "${fuzzer_fingerprint_file}")" = "$(fuzzer_fingerprint)" ]
}
validate_fuzzer_binary() {
  [ -x "${fuzzer_bin}" ] || {
    echo "qemu_nesting build did not produce an executable: ${fuzzer_bin}" >&2
    exit 1
  }
  command -v readelf >/dev/null 2>&1 || {
    echo "readelf is required to validate the external QEMU bridge link" >&2
    exit 1
  }
  local dynamic_section
  dynamic_section="$(readelf -d "${fuzzer_bin}" 2>/dev/null || true)"
  grep -Fq 'Shared library: [libqemu-system-aarch64.so]' <<<"${dynamic_section}" || {
    echo "qemu_nesting is not linked to the configured shared QEMU bridge" >&2
    exit 1
  }
  local expected_dir
  expected_dir="$(dirname "$(readlink -f "${bridge_lib}")")"
  grep -E 'RPATH|RUNPATH' <<<"${dynamic_section}" | grep -Fq "${expected_dir}" || {
    echo "qemu_nesting has no runtime search path for configured bridge ${expected_dir}" >&2
    exit 1
  }

  # RUNPATH is only a declaration.  Resolve the binary through the system
  # loader as it will be run by the workflow, with inherited overrides
  # removed, and verify that the resolved object is the configured bridge.
  local loader_output resolved_bridge expected_bridge
  loader_output="$(
    env -u LD_LIBRARY_PATH -u LD_PRELOAD \
      LD_TRACE_LOADED_OBJECTS=1 "${fuzzer_bin}" 2>&1 || true
  )"
  resolved_bridge="$(awk '
    $1 == "libqemu-system-aarch64.so" {
      print ($3 == "not" ? "" : $3)
      exit
    }
  ' <<<"${loader_output}")"
  [ -n "${resolved_bridge}" ] || {
    echo "qemu_nesting cannot resolve libqemu-system-aarch64.so through its runtime search path" >&2
    printf '%s\n' "${loader_output}" >&2
    exit 1
  }
  expected_bridge="$(readlink -f "${bridge_lib}")"
  resolved_bridge="$(readlink -f "${resolved_bridge}")"
  [ "${resolved_bridge}" = "${expected_bridge}" ] || {
    echo "qemu_nesting resolves a different QEMU bridge library" >&2
    echo "  configured: ${expected_bridge}" >&2
    echo "  resolved:   ${resolved_bridge}" >&2
    exit 1
  }
  cmp -s "${resolved_bridge}" "${expected_bridge}" || {
    echo "resolved QEMU bridge library differs from the configured library" >&2
    echo "  configured: ${expected_bridge}" >&2
    echo "  resolved:   ${resolved_bridge}" >&2
    exit 1
  }
}
bridge_current() {
  [ -f "${installed_bridge_lib}" ] \
    && [ -f "${bridge_config_fingerprint_file}" ] \
    && [ "$(cat "${bridge_config_fingerprint_file}")" = "${bridge_config_fingerprint}" ]
}
record_bridge_config() {
  printf '%s\n' "${bridge_config_fingerprint}" > "${bridge_config_fingerprint_file}"
}
install_bridge() {
  [ -f "${bridge_lib}" ] || {
    echo "missing built LibAFL QEMU bridge library: ${bridge_lib}" >&2
    exit 1
  }
  cp "${bridge_lib}" "${installed_bridge_lib}"
  record_bridge_config
}
bridge_external_fingerprint() {
  validate_external_bridge
  {
    printf 'external-source=%s\n' "$(readlink -f "${bridge_storage_dir}")"
    printf 'external-library=%s\n' "$(readlink -f "${bridge_lib}")"
    printf 'external-data-dir=%s\n' "${bridge_data_dir_override:-default}"
    if [ -f "${bridge_storage_dir}/QEMU_REVISION" ]; then
      printf 'qemu-revision='
      cat "${bridge_storage_dir}/QEMU_REVISION"
      printf '\n'
    fi
    sha256sum "${bridge_lib}" "${bridge_build_dir}/linkinfo.json"
  } | sha256sum | awk '{print $1}'
}
prepare_bridge_source() {
  validate_external_bridge
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

device_backend_fingerprint() {
  {
    printf '%s\n' "seed-device-backend-v1"
    sha256sum "${device_backend_src}" | awk '{print $1}'
  } | sha256sum | awk '{print $1}'
}
device_backend_current() {
  [ -x "${device_backend_bin}" ] \
    && [ -f "${device_backend_fingerprint_file}" ] \
    && [ "$(cat "${device_backend_fingerprint_file}")" = "$(device_backend_fingerprint)" ]
}
build_device_backend() {
  aarch64-linux-gnu-gcc \
    -O2 -static -no-pie \
    "${device_backend_src}" \
    -o "${device_backend_bin}"
  device_backend_fingerprint > "${device_backend_fingerprint_file}"
}
if ! device_backend_current; then
  build_device_backend
fi

bridge_config_fingerprint="$({
  printf '%s\n' "${bridge_config_version}"
  printf 'external=true\n'
  bridge_external_fingerprint
} | sha256sum | awk '{print $1}')"

# Cargo's QEMU build script keys its cache by the bridge path, not by the
# contents behind that path.  A rebased bridge can therefore leave an older
# QEMU build-script output (and an older QEMU object) in a reused target dir.
# Include the bridge fingerprint in the fuzzer fingerprint and discard both
# target dirs before the first build that observes a changed bridge.  This is
# deliberately done before the reuse branches below, so a stale binary cannot
# be accepted merely because its Rust sources are unchanged.
if [ ! -f "${fuzzer_fingerprint_file}" ] \
  || [ "$(cat "${fuzzer_fingerprint_file}")" != "$(fuzzer_fingerprint)" ]; then
  rm -rf "${host_target_dir}" "${fuzzer_target_dir}"
  refresh_cargo_target_dir "${host_target_dir}"
  refresh_cargo_target_dir "${fuzzer_target_dir}"
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

# The overlay is copied from this repository with preserved timestamps. Cargo
# can otherwise reuse an older libafl_nesting rmeta after the overlay content
# changes, while recompiling qemu_nesting against that stale API. Clean only
# the two overlay packages whenever this script has decided to rebuild them.
build_bridge_crate() {
  cargo clean \
    --manifest-path "${source_dir}/Cargo.toml" \
    --target-dir "${host_target_dir}" \
    -p libafl_nesting
  LIBAFL_QEMU_DIR="${bridge_storage_dir}" \
    LIBAFL_QEMU_NO_BUILD=1 \
    LIBAFL_QEMU_EXTERNAL_BUILD=1 \
    cargo build "${bridge_cargo_args[@]}" --lib "${cargo_args[@]}"
}

build_fuzzer() {
  cargo clean \
    --manifest-path "${source_dir}/fuzzers/full_system/qemu_nesting/Cargo.toml" \
    --target-dir "${fuzzer_target_dir}" \
    -p libafl_nesting \
    -p qemu_nesting
  LIBAFL_QEMU_DIR="${bridge_storage_dir}" \
    LIBAFL_QEMU_LIBRARY="${bridge_lib}" \
    LIBAFL_QEMU_NO_BUILD=1 \
    LIBAFL_QEMU_EXTERNAL_BUILD=1 \
    cargo build "${fuzzer_cargo_args[@]}" "${cargo_args[@]}"
}

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

if [ "${reuse_build_dir}" = "true" ] && stub_current && fuzzer_current && bridge_current; then
  validate_fuzzer_binary
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"device-backend","location":"${device_backend_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && bridge_current && [ -d "${bridge_storage_dir}" ] && [ -d "${host_target_dir}/debug/libvharness/include" ] && [ -d "${host_target_dir}/debug/libvharness/src/api/lqemu" ] && [ -f "${host_target_dir}/debug/libvharness/src/api/lqemu/arch/aarch64/calls.c" ]; then
  fuzzer_rebuilt=false
  stub_rebuilt=false
  if ! fuzzer_current; then
    prepare_bridge_source
    build_fuzzer
    cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
    validate_fuzzer_binary
    record_fuzzer_fingerprint
    fuzzer_rebuilt=true
  fi
  if ! stub_current; then
    build_guest_stub
    record_stub_fingerprint
    stub_rebuilt=true
  fi
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"fuzzer_rebuilt":${fuzzer_rebuilt},"stub_rebuilt":${stub_rebuilt},"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"device-backend","location":"${device_backend_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && stub_current && bridge_current && [ -d "${bridge_storage_dir}" ]; then
  prepare_bridge_source
  build_fuzzer
  cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
  validate_fuzzer_binary
  record_fuzzer_fingerprint
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"fuzzer_rebuilt":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"device-backend","location":"${device_backend_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

if [ "${reuse_build_dir}" = "true" ] && [ -x "${stub_bin}" ]; then
  prepare_bridge_source
  build_bridge_crate
  link_bridge_dir
  build_fuzzer
  build_guest_stub
  record_stub_fingerprint
  cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
  validate_fuzzer_binary
  record_fuzzer_fingerprint
  install_bridge
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"device-backend","location":"${device_backend_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
  exit 0
fi

prepare_bridge_source
build_bridge_crate
link_bridge_dir
build_fuzzer
build_guest_stub
record_stub_fingerprint
cp "${fuzzer_target_dir}/debug/qemu_nesting" "${fuzzer_bin}"
validate_fuzzer_binary
record_fuzzer_fingerprint
install_bridge

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false,"source":"${source_dir}","build_dir":"${build_dir}","install_dir":"${install_dir}","stub":"${stub_bin}","device_backend":"${device_backend_bin}","fuzzer":"${fuzzer_bin}","qemu_bridge_dir":"${bridge_dir}","qemu_bridge_lib":"${installed_bridge_lib}"},"artifacts":[{"path":"guest-stub-binary","location":"${stub_bin}"},{"path":"device-backend","location":"${device_backend_bin}"},{"path":"qemu-nesting-fuzzer","location":"${fuzzer_bin}"},{"path":"qemu-bridge-dir","location":"${bridge_dir}"},{"path":"qemu-bridge-lib","location":"${installed_bridge_lib}"}]}
EOF
