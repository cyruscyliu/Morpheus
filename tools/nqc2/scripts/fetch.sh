#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NQC2_SOURCE:?}"
seed_dir="${MORPHEUS_NQC2_SEED_DIR:-}"
build_version="${MORPHEUS_NQC2_BUILD_VERSION:-dev}"
result_file="${MORPHEUS_NQC2_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
version_file="${source_dir}/VERSION"

mkdir -p "$(dirname "${source_dir}")"

if [ -f "${version_file}" ]; then
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

cat > "${result_file}" <<EOF
{"details":{"fetched_source":true,"build_version":"${build_version}","version":"${build_version}"}}
EOF
