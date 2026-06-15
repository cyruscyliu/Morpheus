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
kernel_inputs_state_file="${output_dir}/.morpheus-kernel-inputs.json"

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

compute_kernel_inputs_fingerprint() {
  local file

  {
    if [ -n "${config_fragment_file}" ] && [ -f "${config_fragment_file}" ]; then
      printf '%s\n' "${config_fragment_file}"
    fi
    if [ -n "${patch_dir}" ] && [ -d "${patch_dir}/linux" ]; then
      for file in "${patch_dir}"/linux/*; do
        [ -f "${file}" ] && printf '%s\n' "${file}"
      done | sort
    fi
  } | while IFS= read -r file; do
    [ -n "${file}" ] || continue
    printf '%s\n' "${file}"
    sha256sum "${file}"
  done | sha256sum | awk '{print $1}'
}

ensure_cache_patch_bridge() {
  local bridge_dir

  [ -n "${patch_dir}" ] || return 0
  [ -d "${patch_dir}" ] || return 0

  bridge_dir="$(cd "${output_dir}/../../.." && pwd)/patches"
  [ "${bridge_dir}" != "${patch_dir}" ] || return 0

  if [ -L "${bridge_dir}" ]; then
    local current_target
    current_target="$(readlink "${bridge_dir}")"
    [ "${current_target}" = "${patch_dir}" ] && return 0
    rm "${bridge_dir}"
  elif [ -e "${bridge_dir}" ]; then
    rm -rf "${bridge_dir}"
  fi

  ln -s "${patch_dir}" "${bridge_dir}"
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

verify_kernel_config_fragment() {
  local kernel_config="$1"
  local kernel_fragment="$2"
  local missing=0
  local symbol

  [ -f "${kernel_config}" ] || return 0
  [ -f "${kernel_fragment}" ] || return 0

  while IFS= read -r line; do
    case "${line}" in
      CONFIG_PVPANIC*=*|CONFIG_PANIC_ON_OOPS=*|CONFIG_PANIC_TIMEOUT=*|CONFIG_KASAN*=*|CONFIG_EFI=*|CONFIG_EXPERT=*|CONFIG_RELOCATABLE=*|CONFIG_RANDOMIZE_BASE=*|CONFIG_PCI=*|CONFIG_VIRTIO_PCI=*|CONFIG_DRM=*|CONFIG_FB=*|CONFIG_SCSI=*|CONFIG_ATA=*|CONFIG_ETHERNET=*|CONFIG_WLAN=*|CONFIG_WIRELESS=*|"# CONFIG_KASAN"*" is not set"|"# CONFIG_EFI"*" is not set"|"# CONFIG_RELOCATABLE"*" is not set"|"# CONFIG_RANDOMIZE_BASE"*" is not set"|"# CONFIG_PCI"*" is not set"|"# CONFIG_VIRTIO_PCI"*" is not set"|"# CONFIG_DRM"*" is not set"|"# CONFIG_FB"*" is not set"|"# CONFIG_SCSI"*" is not set"|"# CONFIG_ATA"*" is not set"|"# CONFIG_ETHERNET"*" is not set"|"# CONFIG_WLAN"*" is not set"|"# CONFIG_WIRELESS"*" is not set")
        if [[ "${line}" == "# CONFIG_"*" is not set" ]]; then
          symbol="${line#"# "}"
          symbol="${symbol%" is not set"}"
          if ! grep -Eq "^(${symbol}=|# ${symbol} is not set$)" "${kernel_config}"; then
            continue
          fi
        fi
        if ! grep -Fxq "${line}" "${kernel_config}"; then
          printf '[buildroot] kernel config did not keep requested symbol: %s\n' "${line}" >&2
          missing=1
        fi
        ;;
      *)
        ;;
    esac
  done < "${kernel_fragment}"

  [ "${missing}" -eq 0 ]
}

kernel_config_matches_fragment() {
  local kernel_config="$1"
  local kernel_fragment="$2"
  local symbol

  [ -f "${kernel_config}" ] || return 1
  [ -f "${kernel_fragment}" ] || return 0

  while IFS= read -r line; do
    case "${line}" in
      CONFIG_PVPANIC*=*|CONFIG_PANIC_ON_OOPS=*|CONFIG_PANIC_TIMEOUT=*|CONFIG_KASAN*=*|CONFIG_EFI=*|CONFIG_EXPERT=*|CONFIG_RELOCATABLE=*|CONFIG_RANDOMIZE_BASE=*|CONFIG_PCI=*|CONFIG_VIRTIO_PCI=*|CONFIG_DRM=*|CONFIG_FB=*|CONFIG_SCSI=*|CONFIG_ATA=*|CONFIG_ETHERNET=*|CONFIG_WLAN=*|CONFIG_WIRELESS=*|"# CONFIG_KASAN"*" is not set"|"# CONFIG_EFI"*" is not set"|"# CONFIG_RELOCATABLE"*" is not set"|"# CONFIG_RANDOMIZE_BASE"*" is not set"|"# CONFIG_PCI"*" is not set"|"# CONFIG_VIRTIO_PCI"*" is not set"|"# CONFIG_DRM"*" is not set"|"# CONFIG_FB"*" is not set"|"# CONFIG_SCSI"*" is not set"|"# CONFIG_ATA"*" is not set"|"# CONFIG_ETHERNET"*" is not set"|"# CONFIG_WLAN"*" is not set"|"# CONFIG_WIRELESS"*" is not set")
        if [[ "${line}" == "# CONFIG_"*" is not set" ]]; then
          symbol="${line#"# "}"
          symbol="${symbol%" is not set"}"
          grep -Eq "^${symbol}=" "${kernel_config}" && return 1
          continue
        fi
        grep -Fxq "${line}" "${kernel_config}" || return 1
        ;;
      *)
        ;;
    esac
  done < "${kernel_fragment}"

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
  for hash_file in "${patch_dir}"/*.hash; do
    [ -f "${hash_file}" ] || continue
    rel_path="${hash_file#${patch_dir}/}"
    target_path="${source_dir}/${rel_path}"
    mkdir -p "$(dirname "${target_path}")"
    cp "${hash_file}" "${target_path}"
  done
fi

mkdir -p "${output_dir}"
ensure_cache_patch_bridge

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

resolved_kernel_fragment="${output_dir}/../../../patches/linux/kernel.fragment"
current_linux_config="$(linux_config_path || true)"
if [ "${reuse_build_dir}" = "true" ] \
  && [ -n "${current_linux_config}" ] \
  && ! kernel_config_matches_fragment "${current_linux_config}" "${resolved_kernel_fragment}"; then
  printf '[buildroot] reused linux config is stale; cleaning reused linux build tree\n'
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
  make_args=(-j4)
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

current_linux_config="$(linux_config_path || true)"
if [ -n "${current_linux_config}" ]; then
  verify_kernel_config_fragment "${current_linux_config}" "${resolved_kernel_fragment}"
fi

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
