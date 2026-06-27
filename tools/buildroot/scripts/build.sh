#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_BUILDROOT_SOURCE:?}"
output_dir="${MORPHEUS_BUILDROOT_OUTPUT:?}"
defconfig="${MORPHEUS_BUILDROOT_DEFCONFIG:-}"
make_arg_file="${MORPHEUS_BUILDROOT_MAKE_ARG_FILE:-}"
config_fragment_file="${MORPHEUS_BUILDROOT_CONFIG_FRAGMENT_FILE:-}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
seed_dir="${MORPHEUS_BUILDROOT_SEED_DIR:-}"
archive_url="${MORPHEUS_BUILDROOT_ARCHIVE_URL:-}"
build_version="${MORPHEUS_BUILDROOT_BUILD_VERSION:-}"
reuse_build_dir="${MORPHEUS_BUILDROOT_REUSE_BUILD_DIR:-false}"
kernel_inputs_state_file="${output_dir}/.morpheus-kernel-inputs.json"
tmp_dir="${MORPHEUS_BUILDROOT_TMPDIR:-${output_dir}/tmp}"

export PATH="${PATH}:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "${tmp_dir}"
export TMPDIR="${tmp_dir}"

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

compute_kernel_inputs_fingerprint() {
  {
    if [ -n "${config_fragment_file}" ] && [ -f "${config_fragment_file}" ]; then
      printf '%s\n' "${config_fragment_file}"
      sha256sum "${config_fragment_file}"
    fi
  } | sha256sum | awk '{print $1}'
}

linux_build_dir_present() {
  [ -d "${output_dir}/build" ] || return 1
  find "${output_dir}/build" -mindepth 1 -maxdepth 1 \
    -type d -name 'linux-[0-9]*' -print -quit | grep -q .
}

linux_config_path() {
  [ -d "${output_dir}/build" ] || return 0
  find "${output_dir}/build" -mindepth 2 -maxdepth 2 \
    -type f -path '*/linux-[0-9]*/.config' | sort | head -n 1
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

make -C "${source_dir}" "O=${output_dir}" olddefconfig

kernel_inputs_fingerprint="$(compute_kernel_inputs_fingerprint)"
previous_kernel_inputs_fingerprint=""
if [ -f "${kernel_inputs_state_file}" ]; then
  previous_kernel_inputs_fingerprint="$(
    node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.stdout.write(data.fingerprint || "");
} catch {
  process.stdout.write("");
}
' "${kernel_inputs_state_file}"
  )"
fi
if [ "${reuse_build_dir}" = "true" ] \
  && [ "${previous_kernel_inputs_fingerprint}" != "${kernel_inputs_fingerprint}" ] \
  && linux_build_dir_present; then
  printf '[buildroot] kernel inputs changed; cleaning reused linux build tree\n'
  make -C "${source_dir}" "O=${output_dir}" linux-dirclean
fi

cat > "${kernel_inputs_state_file}" <<EOF
{
  "fingerprint": "${kernel_inputs_fingerprint}"
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

if [ "${reuse_build_dir}" = "true" ] \
  && [ "${previous_kernel_inputs_fingerprint}" = "${kernel_inputs_fingerprint}" ] \
  && [ -f "${output_dir}/images/Image" ] \
  && [ -f "${output_dir}/images/rootfs.cpio.gz" ]; then
  if make -C "${source_dir}" "O=${output_dir}" -q >/dev/null 2>&1; then
    vmlinux_path=""
    for candidate in "${output_dir}"/build/linux-*/vmlinux; do
      [ -f "${candidate}" ] || continue
      vmlinux_path="${candidate}"
      break
    done
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
vmlinux_path=""
for candidate in "${output_dir}"/build/linux-*/vmlinux; do
  [ -f "${candidate}" ] || continue
  vmlinux_path="${candidate}"
  break
done
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
