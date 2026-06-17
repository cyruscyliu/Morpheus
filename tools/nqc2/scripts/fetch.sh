#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/../../_shared/scripts/state.sh"

source_dir="${MORPHEUS_NQC2_SOURCE:?}"
seed_dir="${MORPHEUS_NQC2_SEED_DIR:-}"
build_version="${MORPHEUS_NQC2_BUILD_VERSION:-dev}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
version_file="${source_dir}/VERSION"
state_file="${source_dir}/.morpheus-fetch.json"

mkdir -p "$(dirname "${source_dir}")"

mode="seed"
input_fingerprint="$(printf '%s\n' "${build_version}" | sha256sum | awk '{print $1}')"
if [ -n "${seed_dir}" ] && [ -d "${seed_dir}" ]; then
  input_fingerprint="$(
    {
      printf '%s\n' "${build_version}"
      morpheus_hash_tree "${seed_dir}"
    } | sha256sum | awk '{print $1}'
  )"
fi

if [ -f "${version_file}" ] \
  && morpheus_state_matches "${state_file}" "mode" "${mode}" \
  && morpheus_state_matches "${state_file}" "input_fingerprint" "${input_fingerprint}"; then
  printf '[nqc2] reuse source %s version=%s\n' "${source_dir}" "$(tr -d '\n' < "${version_file}")"
  cat > "${result_file}" <<EOF
{"details":{"reused":true,"fetched_source":false,"build_version":"${build_version}","version":"$(tr -d '\n' < "${version_file}")"}}
EOF
  exit 0
fi

rm -rf "${source_dir}"
mkdir -p "${source_dir}"

if [ -n "${seed_dir}" ] && [ -d "${seed_dir}" ]; then
  cp -R "${seed_dir}/." "${source_dir}/"
fi

printf '%s\n' "${build_version}" > "${version_file}"
morpheus_write_state_json \
  "${state_file}" \
  "fetchedAt" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "mode" "${mode}" \
  "input_fingerprint" "${input_fingerprint}" \
  "seed_dir" "${seed_dir}" \
  "build_version" "${build_version}"
printf '[nqc2] prepared source %s version=%s\n' "${source_dir}" "${build_version}"

cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"build_version":"${build_version}","version":"${build_version}"}}
EOF
