#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/parallelism.sh"

source_dir="${MORPHEUS_QEMU_SOURCE:?}"
build_dir="${MORPHEUS_QEMU_BUILD_DIR:?}"
install_dir="${MORPHEUS_QEMU_INSTALL_DIR:?}"
target_list_file="${MORPHEUS_QEMU_TARGET_LIST_FILE:-}"
configure_arg_file="${MORPHEUS_QEMU_CONFIGURE_ARG_FILE:-}"
target_list_raw="${MORPHEUS_QEMU_TARGET_LIST:-}"
configure_arg_raw="${MORPHEUS_QEMU_CONFIGURE_ARG:-}"
jobs="${MORPHEUS_QEMU_JOBS:-$(morpheus_default_jobs)}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
archive_url="${MORPHEUS_QEMU_ARCHIVE_URL:-}"
seed_dir="${MORPHEUS_QEMU_SEED_DIR:-}"
build_version="${MORPHEUS_QEMU_BUILD_VERSION:-}"
artifact_path="${install_dir}/bin/qemu-system-aarch64"
reuse_build_dir="${MORPHEUS_QEMU_REUSE_BUILD_DIR:-false}"
needs_rebuild="true"
use_system_meson="${MORPHEUS_QEMU_USE_SYSTEM_MESON:-1}"
configure_signature_file="${build_dir}/.morpheus-configure-signature"

if [[ "${source_dir}" != /* ]]; then
  source_dir="$(pwd)/${source_dir#./}"
fi
if [[ "${build_dir}" != /* ]]; then
  build_dir="$(pwd)/${build_dir#./}"
fi
if [[ "${install_dir}" != /* ]]; then
  install_dir="$(pwd)/${install_dir#./}"
fi
if [[ "${result_file}" != /* ]]; then
  result_file="$(pwd)/${result_file#./}"
fi
configure_signature_file="${build_dir}/.morpheus-configure-signature"

emit_phase() {
  local phase="$1"
  printf '{"status":"stream","details":{"event":"tool.phase","phase":"%s"}}\n' "${phase}"
}

if command -v ulimit >/dev/null 2>&1; then
  ulimit -n 65535 >/dev/null 2>&1 || true
fi

convert_thin_archives() {
  local archive=""
  local backup=""
  local member=""
  local -a members=()

  while IFS= read -r archive; do
    if ! file "${archive}" | grep -q 'thin archive'; then
      continue
    fi

    members=()
    while IFS= read -r member; do
      members+=("${member}")
    done < <(ar t "${archive}")
    if [ "${#members[@]}" -eq 0 ]; then
      continue
    fi

    backup="${archive}.thin"
    rm -f "${backup}"
    mv "${archive}" "${backup}"
    if ! ar csrD "${archive}" "${members[@]}"; then
      rm -f "${archive}"
      mv "${backup}" "${archive}"
      return 1
    fi
    rm -f "${backup}"
  done < <(find . -type f \( -name '*.a' -o -name '*.fa' \) | sort)
}

stale_target_list_config() {
  local config_host_mak="$1"
  local expected_targets="$2"
  [ -f "${config_host_mak}" ] || return 1
  [ -n "${expected_targets}" ] || return 1
  local configured_targets=""
  configured_targets="$(sed -n 's/^TARGET_DIRS=//p' "${config_host_mak}" | head -n 1)"
  [ -n "${configured_targets}" ] || return 1
  [ "${configured_targets}" = "${expected_targets}" ] && return 1
  return 0
}

stale_meson_build_tree() {
  local build_root="$1"
  local candidate=""
  for candidate in \
    "${build_root}/build.ninja" \
    "${build_root}/build.ninja.stamp" \
    "${build_root}/config-host.mak"; do
    [ -f "${candidate}" ] || continue
    if grep -q '/pyvenv/bin/' "${candidate}"; then
      return 0
    fi
  done
  return 1
}

if [ ! -x "${source_dir}/configure" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -x "${source_dir}/configure" ]; then
  echo "missing executable configure script: ${source_dir}/configure" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required; run tools/qemu/scripts/install-dependencies.sh" >&2
  exit 1
fi

if ! command -v meson >/dev/null 2>&1; then
  echo "meson is required; run tools/qemu/scripts/install-dependencies.sh" >&2
  exit 1
fi

if [ -f "${build_dir}/build.ninja" ] && grep -q "/pyvenv/bin/" "${build_dir}/build.ninja"; then
  if [ ! -x "${build_dir}/pyvenv/bin/meson" ] || [ ! -x "${build_dir}/pyvenv/bin/python3" ]; then
    rm -rf "${build_dir}" "${install_dir}"
  fi
fi

if stale_meson_build_tree "${build_dir}"; then
  rm -rf "${build_dir}" "${install_dir}"
fi

mkdir -p "${build_dir}" "${install_dir}"

cd "${build_dir}"

target_args=()
if [ -n "${target_list_file}" ] && [ -s "${target_list_file}" ]; then
  mapfile -t target_list < "${target_list_file}"
elif [ -n "${target_list_raw}" ]; then
  mapfile -t target_list <<< "${target_list_raw}"
else
  target_list=()
fi
if [ "${#target_list[@]}" -gt 0 ]; then
  target_csv="$(IFS=,; echo "${target_list[*]}")"
  target_space="$(IFS=' '; echo "${target_list[*]}")"
  target_args=("--target-list=${target_csv}")
else
  target_space=""
fi

configure_args=()
if [ -n "${configure_arg_file}" ] && [ -s "${configure_arg_file}" ]; then
  mapfile -t configure_args < "${configure_arg_file}"
elif [ -n "${configure_arg_raw}" ]; then
  mapfile -t configure_args <<< "${configure_arg_raw}"
fi

configure_signature="$(
  {
    printf 'target_space=%s\n' "${target_space}"
    printf 'use_system_meson=%s\n' "${use_system_meson}"
    printf 'configure_args<<EOF\n'
    printf '%s\n' "${configure_args[@]}"
    printf 'EOF\n'
  } | sha256sum | awk '{print $1}'
)"

if stale_target_list_config "${build_dir}/config-host.mak" "${target_space}"; then
  cd /
  rm -rf "${build_dir}" "${install_dir}"
  mkdir -p "${build_dir}" "${install_dir}"
  cd "${build_dir}"
fi

if [ -f "${build_dir}/build.ninja" ] && \
   { [ ! -f "${configure_signature_file}" ] || \
     [ "$(cat "${configure_signature_file}")" != "${configure_signature}" ]; }; then
  cd /
  rm -rf "${build_dir}" "${install_dir}"
  mkdir -p "${build_dir}" "${install_dir}"
  cd "${build_dir}"
fi

if [ "${reuse_build_dir}" = "true" ] && [ -f "${artifact_path}" ] && [ -f "${build_dir}/build.ninja" ]; then
  needs_rebuild="false"
  if find "${source_dir}" -type f -newer "${artifact_path}" -print -quit | grep -q .; then
    needs_rebuild="true"
  fi
  if [ -n "${target_list_file}" ] && [ -f "${target_list_file}" ] && [ "${target_list_file}" -nt "${artifact_path}" ]; then
    needs_rebuild="true"
  fi
  if [ -n "${configure_arg_file}" ] && [ -f "${configure_arg_file}" ] && [ "${configure_arg_file}" -nt "${artifact_path}" ]; then
    needs_rebuild="true"
  fi
  if [ "${needs_rebuild}" = "false" ]; then
    cat > "${result_file}" <<EOF
{"details":{"configured":true,"built":true,"installed":true,"reused":true,"source":"${source_dir}"}}
EOF
    exit 0
  fi
fi

export MORPHEUS_QEMU_USE_SYSTEM_MESON="${use_system_meson}"

if [ ! -f "${build_dir}/build.ninja" ]; then
  emit_phase "configure"
  "${source_dir}/configure" \
    "--prefix=${install_dir}" \
    "${target_args[@]}" \
    "${configure_args[@]}"
  printf '%s\n' "${configure_signature}" > "${configure_signature_file}"
fi

if [ -f "${build_dir}/build.ninja" ]; then
  if ! command -v ninja >/dev/null 2>&1; then
    echo "ninja is required for QEMU builds that generate build.ninja" >&2
    exit 1
  fi
  emit_phase "build"
  if ! ninja "-j${jobs}"; then
    convert_thin_archives
    ninja "-j${jobs}"
  fi
  emit_phase "install"
  ninja install
elif [ -f "${build_dir}/Makefile" ]; then
  emit_phase "build"
  make "-j${jobs}"
  emit_phase "install"
  make install
else
  echo "QEMU configure did not generate build.ninja or Makefile in ${build_dir}" >&2
  exit 1
fi

cat > "${result_file}" <<EOF
{"details":{"configured":true,"built":true,"installed":true,"source":"${source_dir}"}}
EOF
