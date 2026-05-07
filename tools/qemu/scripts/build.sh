#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_QEMU_SOURCE:?}"
build_dir="${MORPHEUS_QEMU_BUILD_DIR:?}"
install_dir="${MORPHEUS_QEMU_INSTALL_DIR:?}"
target_list_file="${MORPHEUS_QEMU_TARGET_LIST_FILE:-}"
configure_arg_file="${MORPHEUS_QEMU_CONFIGURE_ARG_FILE:-}"
jobs="${MORPHEUS_QEMU_JOBS:-4}"
result_file="${MORPHEUS_QEMU_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
archive_url="${MORPHEUS_QEMU_ARCHIVE_URL:-}"
seed_dir="${MORPHEUS_QEMU_SEED_DIR:-}"
build_version="${MORPHEUS_QEMU_BUILD_VERSION:-}"
artifact_path="${install_dir}/bin/qemu-system-aarch64"
reuse_build_dir="${MORPHEUS_QEMU_REUSE_BUILD_DIR:-false}"
needs_rebuild="true"

if [ ! -x "${source_dir}/configure" ]; then
  if [ -n "${seed_dir}" ] || [ -n "${archive_url}" ] || [ -n "${build_version}" ]; then
    "$(dirname "$0")/fetch.sh"
  fi
fi

if [ ! -x "${source_dir}/configure" ]; then
  echo "missing executable configure script: ${source_dir}/configure" >&2
  exit 1
fi

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "python3 venv support is missing; run tools/qemu/scripts/install-dependencies.sh" >&2
  exit 1
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

mkdir -p "${build_dir}" "${install_dir}"

cd "${build_dir}"

target_args=()
if [ -n "${target_list_file}" ] && [ -s "${target_list_file}" ]; then
  mapfile -t target_list < "${target_list_file}"
  target_csv="$(IFS=,; echo "${target_list[*]}")"
  target_args=("--target-list=${target_csv}")
fi

configure_args=()
if [ -n "${configure_arg_file}" ] && [ -s "${configure_arg_file}" ]; then
  mapfile -t configure_args < "${configure_arg_file}"
fi

if [ ! -f "${build_dir}/build.ninja" ]; then
  "${source_dir}/configure" \
    "--prefix=${install_dir}" \
    "${target_args[@]}" \
    "${configure_args[@]}"
fi

make "-j${jobs}"
make install

cat > "${result_file}" <<EOF
{"details":{"configured":true,"built":true,"installed":true,"source":"${source_dir}"}}
EOF
