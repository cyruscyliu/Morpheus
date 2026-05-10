#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_NVIRSH_SOURCE:?}"
profile_name="${MORPHEUS_NVIRSH_BUILD_VERSION:-default}"
build_dir_key="${MORPHEUS_NVIRSH_BUILD_DIR_KEY:-${profile_name}}"
result_file="${MORPHEUS_NVIRSH_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
profile_dir="${script_dir}/../profiles/${profile_name}"
profile_file="${source_dir}/profile.json"
source_profile_file="${source_dir}/profile.json"
log_file="${MORPHEUS_SCRIPT_LOG_FILE:-/dev/null}"

mkdir -p "${source_dir}"

if [ ! -f "${profile_file}" ] && [ -f "${profile_dir}/profile.json" ]; then
  cp -a "${profile_dir}/." "${source_dir}/"
fi

if [ ! -f "${profile_file}" ]; then
  echo "missing nvirsh profile source: ${source_dir}" >&2
  exit 1
fi

reused="false"
if [ -f "${source_profile_file}" ] && cmp -s "${profile_file}" "${source_profile_file}"; then
  reused="true"
fi

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","profile":"${profile_name}","build_dir_key":"${build_dir_key}","reused":${reused}}}
EOF

printf '[nvirsh] fetched profile %s into %s\n' "${profile_name}" "${source_dir}" >> "${log_file}"
