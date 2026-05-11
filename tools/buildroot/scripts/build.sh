#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_BUILDROOT_SOURCE:?}"
output_dir="${MORPHEUS_BUILDROOT_OUTPUT:?}"
defconfig="${MORPHEUS_BUILDROOT_DEFCONFIG:-}"
patch_dir="${MORPHEUS_BUILDROOT_PATCH_DIR:-}"
make_arg_file="${MORPHEUS_BUILDROOT_MAKE_ARG_FILE:-}"
config_fragment_file="${MORPHEUS_BUILDROOT_CONFIG_FRAGMENT_FILE:-}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_BUILDROOT_SEED_DIR:-}"
archive_url="${MORPHEUS_BUILDROOT_ARCHIVE_URL:-}"
build_version="${MORPHEUS_BUILDROOT_BUILD_VERSION:-}"
patch_strategies="${MORPHEUS_BUILDROOT_PATCH_STRATEGIES:-${MORPHEUS_SCRIPT_PATCH_STRATEGIES:-source-tree}}"
reuse_build_dir="${MORPHEUS_BUILDROOT_REUSE_BUILD_DIR:-false}"

export PATH="${PATH}:/usr/sbin:/usr/bin:/sbin:/bin"

stale_host_fakeroot() {
  local fakeroot_bin="$1"
  local expected_host_dir="$2"
  [ -f "${fakeroot_bin}" ] || return 1
  local configured_prefix=""
  configured_prefix="$(sed -n 's/^FAKEROOT_PREFIX=//p' "${fakeroot_bin}" | head -n 1)"
  [ -n "${configured_prefix}" ] || return 1
  [ "${configured_prefix}" = "${expected_host_dir}" ] && return 1
  return 0
}

if [ ! -f "${source_dir}/Makefile" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -f "${source_dir}/Makefile" ]; then
  echo "missing buildroot source tree: ${source_dir}" >&2
  exit 1
fi

if ! command -v file >/dev/null 2>&1 && [ ! -x /usr/bin/file ]; then
  echo "missing host dependency: file; run tools/buildroot/scripts/install-dependencies.sh" >&2
  exit 1
fi

if [ -n "${patch_dir}" ]; then
  "$(dirname "$0")/patch.sh"
fi

if [ -n "${patch_dir}" ]; then
  while IFS= read -r hash_file; do
    [ -n "${hash_file}" ] || continue
    rel_path="${hash_file#${patch_dir}/}"
    target_path="${source_dir}/${rel_path}"
    mkdir -p "$(dirname "${target_path}")"
    cp "${hash_file}" "${target_path}"
  done <<EOF
$(find "${patch_dir}" -type f -name '*.hash' | sort)
EOF
fi

mkdir -p "${output_dir}"

host_dir="${output_dir}/host"
if stale_host_fakeroot "${host_dir}/bin/fakeroot" "${host_dir}"; then
  rm -rf "${output_dir}"
  mkdir -p "${output_dir}"
fi

if [ -n "${defconfig}" ]; then
  make -C "${source_dir}" "O=${output_dir}" "${defconfig}"
fi

if [ -n "${config_fragment_file}" ] && [ -s "${config_fragment_file}" ]; then
  cat "${config_fragment_file}" >> "${output_dir}/.config"
fi

if [ -n "${patch_dir}" ] && [[ ",${patch_strategies}," == *",buildroot-global-patch-dir,"* ]]; then
  printf 'BR2_GLOBAL_PATCH_DIR="%s"\n' "${patch_dir}" >> "${output_dir}/.config"
fi

if { [ -n "${config_fragment_file}" ] && [ -s "${config_fragment_file}" ]; } || { [ -n "${patch_dir}" ] && [[ ",${patch_strategies}," == *",buildroot-global-patch-dir,"* ]]; }; then
  make -C "${source_dir}" "O=${output_dir}" olddefconfig
fi

if [ -n "${patch_dir}" ] && [[ ",${patch_strategies}," == *",buildroot-global-patch-dir,"* ]]; then
  if grep -q '^BR2_GLOBAL_PATCH_DIR=' "${output_dir}/.config"; then
    sed -i "s|^BR2_GLOBAL_PATCH_DIR=.*|BR2_GLOBAL_PATCH_DIR=\"${patch_dir}\"|" "${output_dir}/.config"
  else
    printf 'BR2_GLOBAL_PATCH_DIR="%s"\n' "${patch_dir}" >> "${output_dir}/.config"
  fi
fi

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
  nproc_value="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"
  for i in "${!make_args[@]}"; do
    make_args[$i]="${make_args[$i]//\$(nproc)/${nproc_value}}"
  done
else
  make_args=(-j4)
fi

if [ "${reuse_build_dir}" = "true" ] && [ -f "${output_dir}/images/Image" ] && [ -f "${output_dir}/images/rootfs.cpio.gz" ]; then
  if make -C "${source_dir}" "O=${output_dir}" -q >/dev/null 2>&1; then
    vmlinux_path="$(find "${output_dir}/build" -type f -name vmlinux | sort | head -n 1 || true)"
    kernel_image="${output_dir}/images/Image"
    initrd_image="${output_dir}/images/rootfs.cpio.gz"
    artifacts_json="$(
      node -e '
const fs = require("fs");
const artifacts = [];
const add = (artifactPath, location) => {
  if (location && fs.existsSync(location)) {
    artifacts.push({ path: artifactPath, location });
  }
};
add("images/Image", process.argv[1]);
add("images/rootfs.cpio.gz", process.argv[2]);
add("build/vmlinux", process.argv[3]);
process.stdout.write(JSON.stringify(artifacts));
' "${kernel_image}" "${initrd_image}" "${vmlinux_path}"
    )"
    cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true},"artifacts":${artifacts_json}}
EOF
    exit 0
  fi
fi

make -C "${source_dir}" "O=${output_dir}" "${make_args[@]}"

# Buildroot keeps the symbol-rich kernel ELF under output/build/.
# We discover it dynamically so the tool contract does not hardcode a
# kernel-version-specific path.
vmlinux_path="$(find "${output_dir}/build" -type f -name vmlinux | sort | head -n 1 || true)"
kernel_image="${output_dir}/images/Image"
initrd_image="${output_dir}/images/rootfs.cpio.gz"

artifacts_json="$(
  node -e '
const fs = require("fs");
const artifacts = [];
const add = (artifactPath, location) => {
  if (location && fs.existsSync(location)) {
    artifacts.push({ path: artifactPath, location });
  }
};
add("images/Image", process.argv[1]);
add("images/rootfs.cpio.gz", process.argv[2]);
add("build/vmlinux", process.argv[3]);
process.stdout.write(JSON.stringify(artifacts));
' "${kernel_image}" "${initrd_image}" "${vmlinux_path}"
)"

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false},"artifacts":${artifacts_json}}
EOF
