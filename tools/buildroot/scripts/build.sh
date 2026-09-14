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
build_inputs_state_file="${output_dir}/.morpheus-build-inputs.json"
tmp_dir="${MORPHEUS_BUILDROOT_TMPDIR:-${output_dir}/tmp}"

export PATH="${PATH}:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "${tmp_dir}"
export TMPDIR="${tmp_dir}"

make_args=()
if [ -n "${make_arg_file}" ] && [ -s "${make_arg_file}" ]; then
  mapfile -t make_args < "${make_arg_file}"
  nproc_value="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 1)"
  for i in "${!make_args[@]}"; do
    make_args[$i]="${make_args[$i]//\$(nproc)/${nproc_value}}"
  done
  if ! morpheus_has_jobs_arg "${make_args[@]}"; then
    make_args+=("-j$(morpheus_default_jobs)")
  fi
else
  make_args=(-j"$(morpheus_default_jobs)")
fi

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

compute_build_inputs_fingerprint() {
  local include_defconfig="${1:-true}"
  local patch_state_file="${source_dir}/.morpheus-patches.json"
  local global_patch_tree=""

  global_patch_tree="$(global_patch_tree_fingerprint)"

  {
    if [ "${include_defconfig}" = "true" ]; then
      printf 'defconfig=%s\n' "${defconfig}"
    fi
    if [ -n "${make_arg_file}" ] && [ -f "${make_arg_file}" ]; then
      printf '%s\n' "${make_arg_file}"
      sha256sum "${make_arg_file}"
    fi
    if [ -f "${patch_state_file}" ]; then
      printf '%s\n' "${patch_state_file}"
      sha256sum "${patch_state_file}"
    fi
    if [ -n "${global_patch_tree}" ]; then
      printf 'global_patch_tree=%s\n' "${global_patch_tree}"
    fi
    if [ -n "${config_fragment_file}" ] && [ -f "${config_fragment_file}" ]; then
      printf '%s\n' "${config_fragment_file}"
      sha256sum "${config_fragment_file}"
    fi
  } | sha256sum | awk '{print $1}'
}

global_patch_tree_fingerprint() {
  local configured_roots=""
  local fragment_roots=""
  local patch_root=""
  local patch_file=""

  if [ -f "${output_dir}/.config" ]; then
    configured_roots="$(
      sed -n 's/^BR2_GLOBAL_PATCH_DIR="\(.*\)"$/\1/p' \
      "${output_dir}/.config"
    )"
  fi
  if [ -n "${config_fragment_file}" ] && [ -f "${config_fragment_file}" ]; then
    fragment_roots="$(
      sed -n 's/^BR2_GLOBAL_PATCH_DIR="\(.*\)"$/\1/p' \
        "${config_fragment_file}"
    )"
    if [ -n "${fragment_roots}" ]; then
      configured_roots="${fragment_roots}"
    fi
  fi
  [ -n "${configured_roots}" ] || return 0

  {
    for patch_root in ${configured_roots}; do
      case "${patch_root}" in
        /*) ;;
        *) continue ;;
      esac
      [ -d "${patch_root}" ] || continue
      while IFS= read -r patch_file; do
        [ -n "${patch_file}" ] || continue
        printf '%s\n' "${patch_file}"
        if [ -L "${patch_file}" ]; then
          printf 'link=%s\n' "$(readlink "${patch_file}")"
        else
          sha256sum "${patch_file}"
        fi
      done < <(
        find "${patch_root}" \( -type f -o -type l \) -print \
          | LC_ALL=C sort
      )
    done
  } | sha256sum | awk '{print $1}'
}

linux_build_dir_present() {
  [ -d "${output_dir}/build" ] || return 1
  find "${output_dir}/build" -mindepth 1 -maxdepth 1 \
    -type d -name 'linux-[0-9]*' -print -quit | grep -q .
}

qemu_build_dir_present() {
  [ -d "${output_dir}/build" ] || return 1
  find "${output_dir}/build" -mindepth 1 -maxdepth 1 \
    \( -type d -name 'qemu-*' -o -type d -name 'host-qemu-*' \) \
    -print -quit | grep -q .
}

qemu_dirclean_targets() {
  local package_dir
  local target
  local -A seen_targets=()

  while IFS= read -r package_dir; do
    case "${package_dir}" in
      host-qemu-cca-*) target="host-qemu-cca-dirclean" ;;
      host-qemu-*) target="host-qemu-dirclean" ;;
      qemu-cca-*) target="qemu-cca-dirclean" ;;
      qemu-*) target="qemu-dirclean" ;;
      *) continue ;;
    esac
    if [ -z "${seen_targets[${target}]+x}" ]; then
      printf '%s\n' "${target}"
      seen_targets[${target}]=1
    fi
  done < <(
    find "${output_dir}/build" -mindepth 1 -maxdepth 1 \
      \( -type d -name 'qemu-*' -o -type d -name 'host-qemu-*' \) \
      -printf '%f\n' | LC_ALL=C sort
  )
}

guest_toolchain_artifacts_json() {
  local guest_plugin_header=""
  if [ -d "${output_dir}/build" ]; then
    guest_plugin_header="$({
      find "${output_dir}/build" -type f \
        -path '*/include/plugins/qemu-plugin.h' -print -quit
    } 2>/dev/null || true)"
  fi
  node - "${output_dir}" "${guest_plugin_header}" <<'NODE'
const fs = require("fs");
const path = require("path");

const outputDir = process.argv[2];
const discoveredPluginHeader = process.argv[3];
const candidates = [
  ["guest-qemu-plugin-header", discoveredPluginHeader],
  ["guest-cross-compile", path.join(outputDir, "host", "bin", "aarch64-buildroot-linux-gnu-gcc")],
  ["guest-sysroot", path.join(outputDir, "host", "aarch64-buildroot-linux-gnu", "sysroot")],
];
const seen = new Set();
const artifacts = [];
for (const [artifactPath, location] of candidates) {
  if (seen.has(artifactPath) || !fs.existsSync(location)) {
    continue;
  }
  seen.add(artifactPath);
  artifacts.push({ path: artifactPath, location });
}
process.stdout.write(JSON.stringify(artifacts));
NODE
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

vmlinux_path=""
for candidate in "${output_dir}"/build/linux-*/vmlinux; do
  [ -f "${candidate}" ] || continue
  vmlinux_path="${candidate}"
  break
done

if [ "${reuse_build_dir}" = "true" ] \
  && [ "${build_inputs_compatible}" = "true" ] \
  && [ -s "${output_dir}/images/Image" ] \
  && [ -s "${output_dir}/images/rootfs.cpio.gz" ]; then
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
add("output-dir", process.argv[1]);
add("target-dir", process.argv[2]);
add("images-dir", process.argv[3]);
add("images/Image", process.argv[4]);
add("images/rootfs.cpio.gz", process.argv[5]);
add("build/vmlinux", process.argv[6]);
add("target/usr/bin/qemu-system-aarch64", process.argv[7]);
add("target/usr/share/qemu", process.argv[8]);
const toolchainArtifacts = JSON.parse(process.argv[9]);
for (const artifact of toolchainArtifacts) {
  if (artifact && artifact.path && artifact.location && fs.existsSync(artifact.location)) {
    artifacts.push(artifact);
  }
}
process.stdout.write(JSON.stringify(artifacts));
' \
    "${output_dir}" \
    "${output_dir}/target" \
    "${output_dir}/images" \
    "${kernel_image}" \
    "${initrd_image}" \
    "${vmlinux_path}" \
    "${output_dir}/target/usr/bin/qemu-system-aarch64" \
    "${output_dir}/target/usr/share/qemu" \
    "$(guest_toolchain_artifacts_json)"
  )"
  cat > "${build_inputs_state_file}" <<EOF
{
  "fingerprint": "${build_inputs_fingerprint}"
}
EOF
  cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":true},"artifacts":${artifacts_json}}
EOF
  exit 0
fi

if [ -n "${defconfig}" ]; then
  make -C "${source_dir}" "O=${output_dir}" "${make_args[@]}" "${defconfig}"
fi

if [ -n "${config_fragment_file}" ] && [ -s "${config_fragment_file}" ]; then
  cat "${config_fragment_file}" >> "${output_dir}/.config"
fi

make -C "${source_dir}" "O=${output_dir}" "${make_args[@]}" olddefconfig
if [ "${reuse_build_dir}" = "true" ] \
  && [ "${build_inputs_compatible}" != "true" ] \
  && linux_build_dir_present; then
  printf '[buildroot] prepared build inputs changed; cleaning reused linux build tree\n'
  make -C "${source_dir}" "O=${output_dir}" "${make_args[@]}" linux-dirclean
fi
if [ "${reuse_build_dir}" = "true" ] \
  && [ "${build_inputs_compatible}" != "true" ] \
  && qemu_build_dir_present; then
  mapfile -t qemu_clean_targets < <(qemu_dirclean_targets)
  # Buildroot applies BR2_GLOBAL_PATCH_DIR at package patch time. Reusing a
  # previously patched qemu package would therefore retain removed profile
  # patches even after the effective patch set changed.
  for qemu_clean_target in "${qemu_clean_targets[@]}"; do
    printf '[buildroot] prepared build inputs changed; cleaning reused qemu build tree target=%s\n' \
      "${qemu_clean_target}"
    make -C "${source_dir}" "O=${output_dir}" "${make_args[@]}" "${qemu_clean_target}"
  done
fi

cat > "${build_inputs_state_file}" <<EOF
{
  "fingerprint": "${build_inputs_fingerprint}"
}
EOF

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
add("output-dir", process.argv[1]);
add("target-dir", process.argv[2]);
add("images-dir", process.argv[3]);
add("images/Image", process.argv[4]);
add("images/rootfs.cpio.gz", process.argv[5]);
add("build/vmlinux", process.argv[6]);
add("target/usr/bin/qemu-system-aarch64", process.argv[7]);
add("target/usr/share/qemu", process.argv[8]);
const toolchainArtifacts = JSON.parse(process.argv[9]);
for (const artifact of toolchainArtifacts) {
  if (artifact && artifact.path && artifact.location && fs.existsSync(artifact.location)) {
    artifacts.push(artifact);
  }
}
process.stdout.write(JSON.stringify(artifacts));
' \
  "${output_dir}" \
  "${output_dir}/target" \
  "${output_dir}/images" \
  "${kernel_image}" \
  "${initrd_image}" \
  "${vmlinux_path}" \
  "${output_dir}/target/usr/bin/qemu-system-aarch64" \
  "${output_dir}/target/usr/share/qemu" \
  "$(guest_toolchain_artifacts_json)"
)"

cat > "${result_file}" <<EOF
{"details":{"built":true,"reused":false},"artifacts":${artifacts_json}}
EOF
