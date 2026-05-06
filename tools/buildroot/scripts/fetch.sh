#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_BUILDROOT_SOURCE:?}"
seed_dir="${MORPHEUS_BUILDROOT_SEED_DIR:-}"
archive_url="${MORPHEUS_BUILDROOT_ARCHIVE_URL:-}"
downloads_dir="${MORPHEUS_BUILDROOT_DOWNLOADS_DIR:-}"
result_file="${MORPHEUS_BUILDROOT_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_version="${MORPHEUS_BUILDROOT_BUILD_VERSION:-}"

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${source_dir}/Makefile" ]; then
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"seed_dir":"${seed_dir}","build_version":"${build_version}"}}
EOF
  exit 0
fi

if [ -n "${archive_url}" ]; then
  mkdir -p "${downloads_dir}"
  archive_name="$(basename "${archive_url}")"
  archive_path="${downloads_dir}/${archive_name}"
  if [ ! -f "${archive_path}" ]; then
    if [[ "${archive_url}" == file://* ]]; then
      cp "${archive_url#file://}" "${archive_path}"
    else
      curl -L "${archive_url}" -o "${archive_path}"
    fi
  fi
  extract_root="${downloads_dir}/.extract"
  rm -rf "${extract_root}"
  mkdir -p "${extract_root}"
  tar -xf "${archive_path}" -C "${extract_root}"
  first_dir="$(find "${extract_root}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "${first_dir}" ]; then
    echo "archive did not extract a source directory" >&2
    exit 1
  fi
  rm -rf "${source_dir}"
  mv "${first_dir}" "${source_dir}"
  rm -rf "${extract_root}"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"archive":"${archive_path}","build_version":"${build_version}"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_BUILDROOT_SEED_DIR or MORPHEUS_BUILDROOT_ARCHIVE_URL when the source tree is missing" >&2
exit 1
