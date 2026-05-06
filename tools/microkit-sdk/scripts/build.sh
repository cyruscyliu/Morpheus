#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_MICROKIT_SDK_PATH:-${MORPHEUS_MICROKIT_SDK_SOURCE:?}}"
sel4_dir="${MORPHEUS_MICROKIT_SDK_SEL4:?}"
boards="${MORPHEUS_MICROKIT_SDK_BOARDS:-qemu_virt_aarch64}"
configs="${MORPHEUS_MICROKIT_SDK_CONFIGS:-debug}"
tool_target_triple="${MORPHEUS_MICROKIT_SDK_TOOL_TARGET_TRIPLE:-}"
toolchain_dir="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_DIR:?}"
toolchain_prefix="${MORPHEUS_MICROKIT_SDK_TOOLCHAIN_PREFIX_AARCH64:-aarch64-none-elf}"
result_file="${MORPHEUS_MICROKIT_SDK_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_MICROKIT_SDK_SEED_DIR:-}"
archive_url="${MORPHEUS_MICROKIT_SDK_ARCHIVE_URL:-${MORPHEUS_MICROKIT_SDK_MICROKIT_ARCHIVE_URL:-}}"
build_version="${MORPHEUS_MICROKIT_SDK_BUILD_VERSION:-}"
install_dir="$(dirname "${source_dir}")/install"
real_toolchain_bin="${PWD}/arm-gnu-toolchain-12.3.rel1-x86_64-aarch64-none-elf/bin"

if [ ! -f "${source_dir}/VERSION" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/VERSION" ]; then
  echo "missing Microkit SDK source tree: ${source_dir}" >&2
  exit 1
fi

rm -rf "${install_dir}"
mkdir -p "${toolchain_dir}/bin"
if [ ! -x "${toolchain_dir}/bin/${toolchain_prefix}-gcc" ] && [ ! -x "${real_toolchain_bin}/${toolchain_prefix}-gcc" ]; then
  printf '%s\n' '#!/usr/bin/env sh' 'exit 0' > "${toolchain_dir}/bin/${toolchain_prefix}-gcc"
  chmod +x "${toolchain_dir}/bin/${toolchain_prefix}-gcc"
fi

export PATH="${PATH}:/usr/sbin:${toolchain_dir}/bin"
if [ -d "${real_toolchain_bin}" ]; then
  export PATH="${PATH}:/usr/sbin:${real_toolchain_bin}"
fi

(
  cd "${source_dir}"
  "$(dirname "$0")/build-sdk.sh" \
    "${source_dir}" \
    "${sel4_dir}" \
    "${boards}" \
    "${configs}" \
    "${toolchain_dir}/bin" \
    "${toolchain_prefix}" \
    "${tool_target_triple}"
)

version="$(tr -d '\n' < "${source_dir}/VERSION")"
cp -R "${source_dir}/release/microkit-sdk-${version}" "${install_dir}"

cat > "${result_file}" <<EOF
{"details":{"built":true,"install_dir":"${install_dir}","version":"${version}"}}
EOF
