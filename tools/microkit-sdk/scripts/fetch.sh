#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_MICROKIT_SDK_PATH:-${MORPHEUS_MICROKIT_SDK_SOURCE:?}}"
seed_dir="${MORPHEUS_MICROKIT_SDK_SEED_DIR:-}"
archive_url="${MORPHEUS_MICROKIT_SDK_ARCHIVE_URL:-${MORPHEUS_MICROKIT_SDK_MICROKIT_ARCHIVE_URL:-}}"
downloads_dir="${MORPHEUS_MICROKIT_SDK_DOWNLOADS_DIR:-}"
result_file="${MORPHEUS_MICROKIT_SDK_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
build_version="${MORPHEUS_MICROKIT_SDK_BUILD_VERSION:-}"
state_file="${source_dir}/.morpheus-fetch.json"

mkdir -p "$(dirname "${source_dir}")"

mode="empty"
input_fingerprint=""
if [ -n "${seed_dir}" ]; then
  mode="seed"
  input_fingerprint="$(morpheus_hash_tree "${seed_dir}")"
elif [ -n "${archive_url}" ]; then
  mode="archive"
  input_fingerprint="$(printf '%s\n%s\n' "${archive_url}" "${build_version}" | sha256sum | awk '{print $1}')"
fi

if [ -f "${source_dir}/VERSION" ] \
  && morpheus_state_matches "${state_file}" "mode" "${mode}" \
  && morpheus_state_matches "${state_file}" "input_fingerprint" "${input_fingerprint}"; then
  printf '[microkit-sdk] reuse source %s version=%s\n' "${source_dir}" "$(tr -d '\n' < "${source_dir}/VERSION")"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

if [ -n "${seed_dir}" ]; then
  rm -rf "${source_dir}"
  cp -R "${seed_dir}" "${source_dir}"
  morpheus_write_state_json \
    "${state_file}" \
    "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "mode" "seed" \
    "input_fingerprint" "${input_fingerprint}" \
    "seed_dir" "${seed_dir}" \
    "build_version" "${build_version}" \
    "archive_url" "${archive_url}"
  printf '[microkit-sdk] seeded source %s from %s version=%s\n' "${source_dir}" "${seed_dir}" "$(tr -d '\n' < "${source_dir}/VERSION")"
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
  morpheus_write_state_json \
    "${state_file}" \
    "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "mode" "archive" \
    "input_fingerprint" "${input_fingerprint}" \
    "archive_url" "${archive_url}" \
    "build_version" "${build_version}"
  printf '[microkit-sdk] fetched source %s from %s version=%s\n' "${source_dir}" "${archive_path}" "$(tr -d '\n' < "${source_dir}/VERSION")"
  cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"archive":"${archive_path}","build_version":"${build_version}","version":"$(tr -d '\n' < "${source_dir}/VERSION")"}}
EOF
  exit 0
fi

echo "fetch requires MORPHEUS_MICROKIT_SDK_SEED_DIR or archive URL when the source tree is missing" >&2
exit 1
