#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_SEL4_PATH:-${MORPHEUS_SEL4_SOURCE:?}}"
seed_dir="${MORPHEUS_SEL4_SEED_DIR:-}"
archive_url="${MORPHEUS_SEL4_ARCHIVE_URL:-}"
downloads_dir="${MORPHEUS_SEL4_DOWNLOADS_DIR:-}"
result_file="${MORPHEUS_SEL4_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_version="${MORPHEUS_SEL4_BUILD_VERSION:-}"

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${source_dir}/VERSION" ]; then
  printf '[sel4] reuse source %s version=%s\n' "${source_dir}" "$(tr -d '\n' < "${source_dir}/VERSION")"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  printf '[sel4] seeded source %s from %s version=%s\n' "${source_dir}" "${seed_dir}" "$(tr -d '\n' < "${source_dir}/VERSION")"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"seed_dir":"${seed_dir}","build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
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
  printf '[sel4] fetched source %s from %s version=%s\n' "${source_dir}" "${archive_path}" "$(tr -d '\n' < "${source_dir}/VERSION")"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"archive":"${archive_path}","build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_SEL4_SEED_DIR or MORPHEUS_SEL4_ARCHIVE_URL when the source tree is missing" >&2
exit 1
