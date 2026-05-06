#!/usr/bin/env bash
set -euo pipefail

source_dir="${MORPHEUS_SEL4_PATH:-${MORPHEUS_SEL4_SOURCE:?}}"
result_file="${MORPHEUS_SEL4_RESULT_FILE:-${MORPHEUS_SCRIPT_RESULT_FILE:?}}"

if [ ! -d "${source_dir}" ]; then
  echo "missing source directory: ${source_dir}" >&2
  exit 1
fi

version=""
if [ -f "${source_dir}/VERSION" ]; then
  version="$(tr -d '\n' < "${source_dir}/VERSION")"
fi

cat > "${result_file}" <<EOF
{"details":{"source":"${source_dir}","version":"${version}"}}
EOF
