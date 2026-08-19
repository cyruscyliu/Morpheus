#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_LINUX_SOURCE:?}"
output_dir="${MORPHEUS_LINUX_OUTPUT:?}"
defconfig="${MORPHEUS_LINUX_DEFCONFIG:-}"
make_arg_file="${MORPHEUS_LINUX_MAKE_ARG_FILE:-}"
config_fragment_file="${MORPHEUS_LINUX_CONFIG_FRAGMENT_FILE:-}"
result_file="${MORPHEUS_LINUX_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_LINUX_SEED_DIR:-}"
archive_url="${MORPHEUS_LINUX_ARCHIVE_URL:-}"
git_url="${MORPHEUS_LINUX_GIT_URL:-}"
git_ref="${MORPHEUS_LINUX_GIT_REF:-}"
fetch_submodules="${MORPHEUS_LINUX_FETCH_SUBMODULES:-false}"
build_version="${MORPHEUS_LINUX_BUILD_VERSION:-}"
reuse_build_dir="${MORPHEUS_LINUX_REUSE_BUILD_DIR:-false}"
build_inputs_state_file="${output_dir}/.morpheus-build-inputs.json"

compute_build_inputs_fingerprint() {
  local include_defconfig="${1:-true}"
  local patch_state_file="${source_dir}/.morpheus-patches.json"

  {
    if [ "${include_defconfig}" = "true" ]; then
      printf 'defconfig=%s\n' "${defconfig}"
    fi
    if [ -f "${patch_state_file}" ]; then
      printf '%s\n' "${patch_state_file}"
      sha256sum "${patch_state_file}"
    fi
    if [ -n "${config_fragment_file}" ] && [ -f "${config_fragment_file}" ]; then
      printf '%s\n' "${config_fragment_file}"
      sha256sum "${config_fragment_file}"
    fi
    printf 'build_script=%s\n' "${BASH_SOURCE[0]}"
    sha256sum "${BASH_SOURCE[0]}"
  } | sha256sum | awk '{print $1}'
}

if [ ! -f "${source_dir}/Makefile" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${git_url}" ] || [ -n "${git_ref}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing Linux source tree: ${source_dir}" >&2
  exit 1
fi

mkdir -p "${output_dir}"

build_inputs_fingerprint="$(compute_build_inputs_fingerprint true)"
legacy_build_inputs_fingerprint="$(compute_build_inputs_fingerprint false)"
previous_build_inputs_fingerprint=""
if [ -f "${build_inputs_state_file}" ]; then
  previous_build_inputs_fingerprint="$(
    node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(data.fingerprint || "");
} catch {
  process.stdout.write("");
}
' "${build_inputs_state_file}"
  )"
fi

build_inputs_compatible="false"
if [ "${previous_build_inputs_fingerprint}" = "${build_inputs_fingerprint}" ] \
  || [ "${previous_build_inputs_fingerprint}" = "${legacy_build_inputs_fingerprint}" ]; then
  build_inputs_compatible="true"
fi

kernel_image="${output_dir}/arch/arm64/boot/Image"
vmlinux_path="${output_dir}/vmlinux"

if [ "${reuse_build_dir}" = "true" ] \
  && [ "${build_inputs_compatible}" = "true" ] \
  && [ -s "${kernel_image}" ] \
  && [ -s "${vmlinux_path}" ]; then
  cat > "${build_inputs_state_file}" <<EOF
{
  "fingerprint": "${build_inputs_fingerprint}"
}
EOF
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true},"artifacts":[{"path":"output-dir","location":"${output_dir}"},{"path":"images/Image","location":"${kernel_image}"},{"path":"build/vmlinux","location":"${vmlinux_path}"}]}
EOF
  exit 0
fi

if [ -n "${defconfig}" ]; then
  make -C "${source_dir}" "O=${output_dir}" ARCH=arm64 "${defconfig}"
fi

if [ -n "${config_fragment_file}" ] && [ -s "${config_fragment_file}" ]; then
  cat "${config_fragment_file}" >> "${output_dir}/.config"
fi

make -C "${source_dir}" "O=${output_dir}" ARCH=arm64 olddefconfig

cat > "${build_inputs_state_file}" <<EOF
{
  "fingerprint": "${build_inputs_fingerprint}"
}
EOF

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
  nproc_value="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"
  for i in "${!make_args[@]}"; do
    make_args[$i]="${make_args[$i]//\$(nproc)/${nproc_value}}"
  done
else
  make_args=(-j"$(morpheus_default_jobs)")
fi

make -C "${source_dir}" "O=${output_dir}" ARCH=arm64 "${make_args[@]}" Image

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false},"artifacts":[{"path":"output-dir","location":"${output_dir}"},{"path":"images/Image","location":"${kernel_image}"},{"path":"build/vmlinux","location":"${vmlinux_path}"}]}
EOF
