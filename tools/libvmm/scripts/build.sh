#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_LIBVMM_SOURCE:?}"
example="${MORPHEUS_LIBVMM_EXAMPLE:-virtio}"
microkit_sdk="${MORPHEUS_LIBVMM_MICROKIT_SDK:?}"
board="${MORPHEUS_LIBVMM_BOARD:-qemu_virt_aarch64}"
toolchain_bin_dir="${MORPHEUS_LIBVMM_TOOLCHAIN_BIN_DIR:-}"
result_file="${MORPHEUS_LIBVMM_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_LIBVMM_SEED_DIR:-}"
git_url="${MORPHEUS_LIBVMM_GIT_URL:-}"
build_version="${MORPHEUS_LIBVMM_BUILD_VERSION:-}"
example_dir="${source_dir}/examples/${example}"
runtime_contract="${source_dir}/runtime-contract.json"
version_file="${source_dir}/VERSION"
version=""
reuse_build_dir="${MORPHEUS_LIBVMM_REUSE_BUILD_DIR:-false}"

if [ ! -d "${source_dir}" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${git_url}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -d "${example_dir}" ]; then
  echo "missing example directory: ${example_dir}" >&2
  exit 1
fi

if [ -n "${toolchain_bin_dir}" ]; then
  export PATH="${PATH}:${toolchain_bin_dir}"
fi

if [ -d "/usr/lib/llvm-19/bin" ]; then
  export PATH="${PATH}:/usr/lib/llvm-19/bin"
fi

export MICROKIT_SDK="${microkit_sdk}"
export MICROKIT_BOARD="${board}"

if [ -f "${version_file}" ]; then
  version="$(tr -d '\n' < "${version_file}")"
elif [ -d "${source_dir}/.git" ]; then
  version="$(git -C "${source_dir}" rev-parse HEAD)"
else
  version="${build_version}"
fi

if [ "${reuse_build_dir}" = "true" ] && [ -f "${runtime_contract}" ] && make -C "${example_dir}" -q all >/dev/null 2>&1; then
  cat > "${result_file}" <<EOF
{"details":{"built":true,"example":"${example}","microkit_sdk":"${microkit_sdk}","runtime_contract":"${runtime_contract}","reused":true}}
EOF
  exit 0
fi

make -C "${example_dir}" -j4 all

cat > "${runtime_contract}" <<EOF
{
  "schemaVersion": 1,
  "kind": "libvmm-runtime-contract",
  "provider": "libvmm",
  "version": "${version}",
  "example": "${example}",
  "exampleDir": "${example_dir}",
  "defaultAction": "qemu",
  "actions": {
    "qemu": {
      "command": "make",
      "args": ["qemu"],
      "cwd": "${example_dir}",
      "requiredInputs": ["libvmm-dir", "microkit-sdk", "board", "kernel", "initrd", "qemu"],
      "optionalInputs": ["microkit-config", "toolchain-bin-dir"],
      "outputs": ["manifest", "log-file", "pid", "monitor-sock", "console-log"]
    }
  },
  "defaults": {
    "board": "qemu_virt_aarch64",
    "microkitConfig": "debug"
  }
}
EOF

cat > "${result_file}" <<EOF
{"details":{"built":true,"example":"${example}","microkit_sdk":"${microkit_sdk}","runtime_contract":"${runtime_contract}","reused":false}}
EOF
